/**
 * The one way a provider talks to a vendor.
 *
 * Centralized so that the rules that matter for security and for the
 * scheduler's retry policy are stated once: requests go out on an empty
 * cookie jar, non-2xx becomes a typed `ProviderError`, and `Retry-After` is
 * parsed here rather than in each adapter.
 */
import { net, session } from "electron";
import { ProviderError } from "./types";

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  /** Abandon the request after this long. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Both forms
 * become seconds from now; anything else yields null and the scheduler falls
 * back to its own rate-limit delay.
 *
 * A zero or past-dated delay yields null too, rather than "retry now". The
 * claude.ai OAuth usage endpoint has been observed answering `Retry-After: 0`
 * while continuing to refuse the request, and taking that literally turns a
 * rate limit into a request loop against a vendor that is already saying no.
 */
export function parseRetryAfter(
  value: string | undefined,
  now: number = Date.now(),
): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds;
  }

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  const seconds = Math.round((asDate - now) / 1000);
  return seconds > 0 ? seconds : null;
}

function headerValue(
  headers: Record<string, string | string[]>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * GET a vendor endpoint and return the body, or throw a typed ProviderError.
 *
 * The request runs on `session.defaultSession` on purpose: the credential is
 * passed as an explicit header, so this request wants an empty jar. No ambient
 * cookie rides along with it, and nothing it receives can write back into the
 * vendor's partition.
 */
export function httpGet(request: HttpRequest): Promise<string> {
  const { url, headers } = request;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const outgoing = net.request({
      method: "GET",
      url,
      session: session.defaultSession,
      headers,
    });

    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };

    const timer = setTimeout(() => {
      finish(() => {
        outgoing.abort();
        reject(
          new ProviderError("network", `Request to ${url} timed out`, {
            context: url,
          }),
        );
      });
    }, timeoutMs);

    outgoing.on("response", (response) => {
      const status = response.statusCode;
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        if (status === 401 || status === 403) {
          finish(() =>
            reject(
              new ProviderError("auth", `Authentication failed (${status})`, {
                statusCode: status,
                context: url,
              }),
            ),
          );
          return;
        }
        if (status === 429) {
          finish(() =>
            reject(
              new ProviderError("rate-limited", "Rate limited by the vendor", {
                statusCode: status,
                retryAfterSec:
                  parseRetryAfter(
                    headerValue(response.headers, "retry-after"),
                  ) ?? undefined,
                context: url,
              }),
            ),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          finish(() =>
            reject(
              new ProviderError("network", `Unexpected HTTP ${status}`, {
                statusCode: status,
                context: url,
              }),
            ),
          );
          return;
        }
        finish(() => resolve(body));
      });
      response.on("error", (error: Error) => {
        finish(() =>
          reject(
            new ProviderError("network", `Response failed for ${url}`, {
              cause: error,
              context: url,
            }),
          ),
        );
      });
    });

    outgoing.on("error", (error) => {
      finish(() =>
        reject(
          new ProviderError("network", `Request failed for ${url}`, {
            cause: error,
            context: url,
          }),
        ),
      );
    });

    outgoing.end();
  });
}
