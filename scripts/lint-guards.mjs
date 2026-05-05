import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT_DIR = process.cwd();
const SOURCE_DIR = join(ROOT_DIR, "src");
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

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
    const content = readFileSync(file, "utf8");
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(content);
      while (match) {
        violations.push({
          file,
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
