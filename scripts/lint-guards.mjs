import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT_DIR = process.cwd();
const SOURCE_DIR = join(ROOT_DIR, "src");
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

/**
 * The only file allowed to spell IPC channel names as string literals. The
 * preload and the main process import them from there; the renderer never
 * sees them at all.
 */
const IPC_CHANNELS_FILE = "src/shared/ipc-channels.ts";
const IPC_LITERAL_ALLOWLIST = new Set([IPC_CHANNELS_FILE]);

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The exact channel strings declared in the registry.
 *
 * Matching the declared values rather than a `namespace:name` shape keeps the
 * rule from firing on everything else that happens to look like one, such as
 * the scope passed to `createLogger("auth:login-window")`. A channel that is
 * never declared here cannot be registered either: `typed-ipc.ts` types its
 * registration against the registry, so TypeScript rejects it first.
 */
function readDeclaredChannels() {
  const source = readFileSync(join(ROOT_DIR, IPC_CHANNELS_FILE), "utf8");
  const names = new Set();
  const literal = /"([a-z]+:[A-Za-z-]+)"/g;
  let match = literal.exec(source);
  while (match) {
    names.add(match[1]);
    match = literal.exec(source);
  }
  if (names.size === 0) {
    throw new Error(`lint-guards: no channels found in ${IPC_CHANNELS_FILE}`);
  }
  return [...names];
}

const IPC_CHANNEL_PATTERN = new RegExp(
  `["'](?:${readDeclaredChannels().map(escapeForRegExp).join("|")})["']`,
  "g",
);

/** Everything under src/renderer, which runs in the sandboxed web context. */
function isRendererFile(relPath) {
  return relPath.startsWith("src/renderer/");
}

/**
 * Tests name channels on purpose, to assert on the error a rejected call
 * produces. Holding them to the literal rule would only invite a workaround.
 */
function isNotTestFile(relPath) {
  return !relPath.includes("__tests__/");
}

const RULES = [
  {
    id: "no-default-export",
    pattern: /\bexport\s+default\b/g,
    message: "Default exports are not allowed.",
  },
  {
    id: "no-inline-style-prop",
    pattern: /\bstyle=\{\{/g,
    message: "Inline React styles are not allowed. Use Tailwind classes.",
  },
  {
    id: "no-ipc-channel-literal",
    pattern: IPC_CHANNEL_PATTERN,
    message:
      "IPC channel names must come from src/shared/ipc-channels.ts, not string literals.",
    exclude: IPC_LITERAL_ALLOWLIST,
    include: isNotTestFile,
  },
  {
    id: "no-renderer-ipc-channels-import",
    pattern: /from\s+["'][^"']*ipc-channels["']/g,
    message:
      "The renderer must not import IPC channel names. Use the typed bridge in src/renderer/ipc/bridge.ts.",
    include: isRendererFile,
  },
  {
    id: "no-renderer-ipc-renderer",
    pattern:
      /\bipcRenderer\b|\bwindow\.electron\b|\(window as any\)\.electron\b/g,
    message:
      "The renderer must not touch ipcRenderer or window.electron. Use the typed bridge in src/renderer/ipc/bridge.ts.",
    include: isRendererFile,
  },
];

function getFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getFiles(fullPath));
      continue;
    }
    if (!ALLOWED_EXTENSIONS.has(extname(fullPath))) continue;
    if (fullPath.endsWith(".d.ts")) continue;
    files.push(fullPath);
  }

  return files;
}

function lineNumberForOffset(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function run() {
  const files = getFiles(SOURCE_DIR);
  const violations = [];

  for (const file of files) {
    const relPath = relative(ROOT_DIR, file).split("\\").join("/");
    const content = readFileSync(file, "utf8");
    for (const rule of RULES) {
      if (rule.exclude?.has(relPath)) continue;
      if (rule.include && !rule.include(relPath)) continue;
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(content);
      while (match) {
        violations.push({
          file: relPath,
          line: lineNumberForOffset(content, match.index),
          ruleId: rule.id,
          message: rule.message,
        });
        match = rule.pattern.exec(content);
      }
    }
  }

  if (violations.length === 0) {
    console.log("lint-guards: no violations found.");
    process.exit(0);
  }

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} [${violation.ruleId}] ${violation.message}`,
    );
  }

  process.exit(1);
}

run();
