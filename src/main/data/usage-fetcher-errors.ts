export type UsageFetchErrorType = "auth" | "network" | "parse";

export interface UsageFetchErrorOptions {
  cause?: unknown;
  statusCode?: number;
  context?: string;
}

export class UsageFetchError extends Error {
  readonly type: UsageFetchErrorType;
  readonly statusCode?: number;
  readonly context?: string;
  readonly cause?: unknown;

  constructor(
    type: UsageFetchErrorType,
    message: string,
    options: UsageFetchErrorOptions = {},
  ) {
    super(message);
    this.name = "UsageFetchError";
    this.type = type;
    this.statusCode = options.statusCode;
    this.context = options.context;
    this.cause = options.cause;

    Object.setPrototypeOf(this, UsageFetchError.prototype);
  }
}

export function isUsageFetchError(error: unknown): error is UsageFetchError {
  return error instanceof UsageFetchError;
}

export function toUsageFetchError(
  error: unknown,
  fallbackType: UsageFetchErrorType,
  fallbackMessage: string,
): UsageFetchError {
  if (isUsageFetchError(error)) return error;
  return new UsageFetchError(fallbackType, fallbackMessage, { cause: error });
}
