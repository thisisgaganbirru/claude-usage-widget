/**
 * Minimal structural checks for vendor responses.
 *
 * Every provider runs its response through these before touching a field, so a
 * vendor that renames or retypes something produces one `schema` error naming
 * the path rather than a `NaN` that reaches the tray icon. Deliberately not a
 * validation library: the shapes we read are a handful of fields deep, and
 * `context.md` forbids adding a runtime dependency without explicit approval.
 *
 * `path` is a dotted location inside the response ("five_hour.utilization").
 * It names a field, never a value, so it is safe to log and safe to paste into
 * a bug report.
 */
import { ProviderError } from "./types";

export function schemaError(path: string, expected: string): ProviderError {
  return new ProviderError(
    "schema",
    `Unexpected response shape: ${path} is not ${expected}`,
    { context: path },
  );
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError("schema", `${path} is not valid JSON`, {
      cause: error,
      context: path,
    });
  }
}

export function asObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) throw schemaError(path, "an object");
  return value;
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw schemaError(path, "an array");
  return value;
}

/** An object, or null when the key is absent or explicitly null. */
export function optionalObject(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw schemaError(path, "an object or null");
  return value;
}

export function asNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw schemaError(path, "a finite number");
  }
  return value;
}

/** A finite number, or null when the key is absent or explicitly null. */
export function optionalNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): number | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw schemaError(path, "a finite number or null");
  }
  return value;
}

export function asString(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = parent[key];
  if (typeof value !== "string") throw schemaError(path, "a string");
  return value;
}

/** A string, or null when the key is absent or explicitly null. */
export function optionalString(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw schemaError(path, "a string or null");
  return value;
}

export function optionalBoolean(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): boolean | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw schemaError(path, "a boolean or null");
  return value;
}

/**
 * An ISO timestamp the UI can render, or null. A syntactically present but
 * unparseable date is a schema problem, not a silently dropped field.
 */
export function optionalIsoDate(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const value = optionalString(parent, key, path);
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw schemaError(path, "an ISO 8601 timestamp");
  return new Date(parsed).toISOString();
}
