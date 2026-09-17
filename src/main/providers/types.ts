/**
 * The contract every vendor adapter implements (phase P1b).
 *
 * A provider knows three things: how to find a credential without ever
 * prompting, how to turn that credential into one normalized `ProviderUsage`,
 * and how to phrase its own failures. It owns no timers and no retry policy —
 * the scheduler owns those, so adding a vendor never changes polling
 * behaviour, and changing polling behaviour never touches a vendor.
 */
import type {
  ProviderErrorKind,
  ProviderId,
  ProviderUsage,
} from "@shared/usage";

/**
 * A secret plus the metadata needed to decide whether it is still usable.
 * `secret` never crosses the IPC boundary and never reaches a log line.
 */
export interface Credential {
  providerId: ProviderId;
  /** How the secret is presented to the vendor. */
  kind: "cookie" | "bearer";
  secret: string;
  /**
   * Expiry the credential itself carries (cookie expiry, token `expiresAt`),
   * or null when it is open-ended. Never a hardcoded age.
   */
  expiresAt: string | null;
  /** Non-secret identity, shown before the first successful fetch. */
  accountLabel?: string;
}

export interface ProviderErrorOptions {
  cause?: unknown;
  statusCode?: number;
  /** Seconds the vendor asked us to wait, parsed from `Retry-After`. */
  retryAfterSec?: number;
  /** Where it failed, for the log line: an endpoint or a file path. */
  context?: string;
}

/**
 * The only error type a provider may throw. The scheduler branches on `kind`,
 * so an adapter that throws something else gets treated as `unknown` and
 * backed off rather than handled.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly statusCode: number | null;
  readonly retryAfterSec: number | null;
  readonly context: string | null;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderError";
    this.kind = kind;
    this.statusCode = options.statusCode ?? null;
    this.retryAfterSec = options.retryAfterSec ?? null;
    this.context = options.context ?? null;
  }
}

/** Normalizes anything thrown inside an adapter into a typed ProviderError. */
export function toProviderError(
  error: unknown,
  fallbackKind: ProviderErrorKind = "unknown",
  fallbackMessage = "Provider request failed",
): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(fallbackKind, message || fallbackMessage, {
    cause: error,
  });
}

export interface UsageProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly defaultIntervalSec: number;
  /** Looks on disk, in the keychain, or in the environment. Never prompts. */
  discoverCredentials(): Promise<Credential | null>;
  /** One network call or one local file read. Throws ProviderError. */
  fetchUsage(cred: Credential): Promise<ProviderUsage>;
  /** Optional interactive flow, e.g. the claude.ai BrowserWindow. */
  login?(): Promise<Credential | null>;
  logout?(cred: Credential): Promise<void>;
}
