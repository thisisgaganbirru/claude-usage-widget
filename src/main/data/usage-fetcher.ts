import { net, session } from "electron";
import isDev from "electron-is-dev";
import { ProviderType, UsageData } from "@shared/types";
import {
  toUsageFetchError,
  UsageFetchError,
  UsageFetchErrorType,
} from "./usage-fetcher-errors";

/** Cached org ID and name — fetched once per session */
let cachedOrgId: string | null = null;
let cachedOrgName: string | null = null;

function createTypedError(
  type: UsageFetchErrorType,
  message: string,
  cause?: unknown,
  statusCode?: number,
  context?: string,
): UsageFetchError {
  return new UsageFetchError(type, message, { cause, statusCode, context });
}

function parseJson(data: string, context: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw createTypedError(
      "parse",
      `Failed to parse ${context} response JSON`,
      error,
      undefined,
      context,
    );
  }
}

function parseOrganizationsResponse(data: string): {
  uuid: string;
  name: string | null;
} {
  const json = parseJson(data, "/api/organizations");
  const orgs = Array.isArray(json) ? json : [json];
  const org = orgs[0];

  if (!org || typeof org !== "object" || Array.isArray(org)) {
    throw createTypedError(
      "parse",
      "No organization found in /api/organizations response",
      undefined,
      undefined,
      "/api/organizations",
    );
  }

  const record = org as Record<string, unknown>;
  if (typeof record.uuid !== "string" || record.uuid.length === 0) {
    throw createTypedError(
      "parse",
      "No organization found in /api/organizations response",
      undefined,
      undefined,
      "/api/organizations",
    );
  }

  const cleanedName =
    (typeof record.name === "string" ? record.name : "")
      .replace(/'s Organization$/i, "")
      .trim() || null;

  return {
    uuid: record.uuid,
    name: cleanedName,
  };
}

export function getCachedOrgName(): string {
  return cachedOrgName ?? "Claude User";
}

function makeApiHeaders(sessionCookie: string): Record<string, string> {
  const hasCookie = sessionCookie && sessionCookie !== "__electron_session__";
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: "https://claude.ai/",
    "Anthropic-Client-Platform": "web_claude_ai",
  };
  if (hasCookie) {
    headers.Cookie = sessionCookie;
  }
  return headers;
}

function netGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: "GET",
      url,
      session: session.defaultSession,
      headers,
    });
    let data = "";
    request.on("response", (response) => {
      if (response.statusCode === 401 || response.statusCode === 403) {
        reject(
          createTypedError(
            "auth",
            `Authentication failed: ${response.statusCode}`,
            undefined,
            response.statusCode,
            url,
          ),
        );
        return;
      }
      response.on("data", (chunk) => {
        data += chunk.toString();
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(
            createTypedError(
              "network",
              `Unexpected HTTP ${response.statusCode}`,
              undefined,
              response.statusCode,
              url,
            ),
          );
          return;
        }
        resolve(data);
      });
    });
    request.on("error", (error) => {
      reject(
        createTypedError(
          "network",
          `Network request failed for ${url}`,
          error,
          undefined,
          url,
        ),
      );
    });
    request.end();
  });
}

/**
 * Discover the user's primary organization ID from /api/organizations.
 * Result is cached for the lifetime of the process.
 */
async function getOrgId(sessionCookie: string): Promise<string> {
  if (cachedOrgId) return cachedOrgId;

  if (isDev)
    console.log("[UsageFetcher] Fetching org ID from /api/organizations...");
  const data = await netGet(
    "https://claude.ai/api/organizations",
    makeApiHeaders(sessionCookie),
  );

  const org = parseOrganizationsResponse(data);
  cachedOrgId = org.uuid;
  cachedOrgName = org.name;
  if (isDev)
    console.log(
      `[UsageFetcher] Org ID: ${cachedOrgId}, Name: ${cachedOrgName}`,
    );
  return cachedOrgId;
}

/** Clear the cached org ID and name (e.g. on logout) */
export function clearOrgIdCache(): void {
  cachedOrgId = null;
  cachedOrgName = null;
}

/**
 * Fetch usage data from Claude.ai using Electron's browser context.
 * Calls the direct JSON API: /api/organizations/{org_id}/usage
 */
export async function fetchUsageDataFromAPI(
  sessionCookie: string,
): Promise<UsageData> {
  const hasCookie = sessionCookie && sessionCookie !== "__electron_session__";
  if (isDev)
    console.log(
      `[UsageFetcher] Cookie present: ${hasCookie}, first 30 chars: ${sessionCookie?.substring(0, 30) ?? "none"}`,
    );

  const orgId = await getOrgId(sessionCookie);
  const url = `https://claude.ai/api/organizations/${orgId}/usage`;
  if (isDev) console.log(`[UsageFetcher] Fetching usage from ${url}`);

  try {
    const data = await netGet(url, makeApiHeaders(sessionCookie));
    if (isDev)
      console.log(`[UsageFetcher] Usage response length: ${data.length}`);

    const usageData = parseAPIResponse(data);
    return usageData;
  } catch (error) {
    throw toUsageFetchError(
      error,
      "network",
      "Failed to fetch usage data from Claude API",
    );
  }
}

/**
 * Fallback: Fetch usage data by scraping the HTML page
 */
export async function fetchUsageDataFromScraping(
  sessionCookie: string,
): Promise<UsageData> {
  throw new Error(
    "HTML scraping fallback is not implemented - CSS selectors unknown. Use API endpoint only.",
  );
}

async function fetchClaudeUsageData(
  sessionCookie: string,
): Promise<UsageData> {
  try {
    if (isDev) console.log("[UsageFetcher] Attempting API fetch...");
    const data = await fetchUsageDataFromAPI(sessionCookie);
    if (isDev) console.log("[UsageFetcher] API fetch successful");
    return data;
  } catch (apiError) {
    const typedApiError = toUsageFetchError(
      apiError,
      "network",
      "API fetch failed",
    );
    console.warn(
      "[UsageFetcher] API fetch failed, attempting scraping fallback...",
      typedApiError,
    );

    try {
      const data = await fetchUsageDataFromScraping(sessionCookie);
      if (isDev) console.log("[UsageFetcher] Scraping fallback successful");
      return data;
    } catch (scrapingError) {
      const typedScrapingError = toUsageFetchError(
        scrapingError,
        "parse",
        "Scraping fallback failed",
      );
      console.error(
        "[UsageFetcher] All data retrieval methods failed",
        typedScrapingError,
      );

      const finalType =
        typedApiError.type === "auth" ? "auth" : typedApiError.type;
      throw createTypedError(
        finalType,
        `Failed to fetch usage data from all sources (${finalType}): ${typedApiError.message}`,
        { apiError: typedApiError, scrapingError: typedScrapingError },
        typedApiError.statusCode,
        typedApiError.context,
      );
    }
  }
}

async function fetchChatGPTUsageData(
  sessionCookie: string,
): Promise<UsageData> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: "https://chatgpt.com/",
    Cookie: sessionCookie,
  };

  const requirementsUrl =
    "https://chatgpt.com/backend-api/sentinel/chat-requirements";
  const accountUrl = "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";

  const [requirementsResult, accountResult] = await Promise.allSettled([
    netGet(requirementsUrl, headers),
    netGet(accountUrl, headers),
  ]);

  const accountData =
    accountResult.status === "fulfilled"
      ? safeParseJson(accountResult.value)
      : undefined;
  const requirementsData =
    requirementsResult.status === "fulfilled"
      ? safeParseJson(requirementsResult.value)
      : undefined;

  const parsed = parseChatGPTRequirements(requirementsData);
  if (!parsed) {
    throw createTypedError(
      "parse",
      "ChatGPT usage response did not include recognizable limit data",
      requirementsResult.status === "rejected"
        ? requirementsResult.reason
        : requirementsData,
      undefined,
      requirementsUrl,
    );
  }

  const profile = parseChatGPTAccount(accountData);
  return {
    provider: "chatgpt",
    currentUsage: parsed.currentUsage,
    planLimit: parsed.planLimit,
    percentageUsed: parsed.percentageUsed,
    resetTime: parsed.resetTime,
    sessionActive: parsed.sessionActive,
    sevenDayUsage: parsed.sevenDayUsage,
    sevenDayResetTime: parsed.sevenDayResetTime,
    opusUsage: parsed.opusUsage,
    sonnetUsage: parsed.sonnetUsage,
    planType: profile.planType,
    modelInfo: parsed.modelInfo,
    userName: profile.userName,
    timestamp: new Date(),
  };
}

/**
 * Unified interface with automatic fallback
 */
export async function fetchUsageData(
  sessionCookie: string,
  provider: ProviderType = "claude",
): Promise<UsageData> {
  if (provider === "chatgpt") {
    return fetchChatGPTUsageData(sessionCookie);
  }
  return fetchClaudeUsageData(sessionCookie);
}

/**
 * Parse API response — tries multiple formats in order.
 */
function parseAPIResponse(data: string): UsageData {
  // 1. Plain JSON — try top-level then deep search
  try {
    const json = JSON.parse(data);
    if (isDev)
      console.log(
        "[UsageFetcher] Raw API JSON (first 500):",
        JSON.stringify(json).substring(0, 500),
      );

    // Try the actual /api/organizations/{id}/usage shape first
    const shaped = extractFromUsageEndpoint(json);
    if (shaped) return shaped;

    // Top-level match (legacy field names)
    const result = extractFromJsonObject(json);
    if (result) return result;

    // Deep search nested objects
    const deepResult = searchObjectDeep(json);
    if (deepResult) return deepResult;
  } catch {
    // Not plain JSON — fall through
  }

  // 2. RSC wire format (lines like "0:...", "1:...")
  if (!data.startsWith("<!")) {
    const rscResult = parseRSCResponse(data);
    if (rscResult) return rscResult;
  }

  // 3. HTML — extract __NEXT_F flight data and search JSON objects
  if (data.includes("<!DOCTYPE") || data.includes("<html")) {
    const htmlResult = parseHTMLForUsageData(data);
    if (htmlResult) return htmlResult;
  }

  throw createTypedError(
    "parse",
    "Unrecognized API response format — cannot parse usage data. Please ensure you are logged in.",
  );
}

/**
 * Handle the actual /api/organizations/{id}/usage response shape:
 *   {
 *     "five_hour":  { "utilization": 5,  "resets_at": "2026-03-10T03:00:00Z" },
 *     "seven_day":  { "utilization": 20, "resets_at": "2026-03-13T08:00:00Z" },
 *     "seven_day_opus": null | { ... },
 *     "extra_usage": { "is_enabled": false, "monthly_limit": null, ... },
 *     ...
 *   }
 * `utilization` is already a percentage (0–100).
 * We use `five_hour` as the primary window (closest to "current usage"),
 * falling back to `seven_day` if five_hour is absent.
 */
function extractFromUsageEndpoint(json: unknown): UsageData | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  const fiveHour = parseUsageWindow(obj.five_hour);
  const sevenDay = parseUsageWindow(obj.seven_day);

  if (!fiveHour && !sevenDay) return null;

  const fiveHourUtil = fiveHour?.utilization ?? 0;
  const fiveHourReset = fiveHour?.resetsAt ?? null;

  const sevenDayUtil = sevenDay?.utilization ?? 0;
  const sevenDayReset = sevenDay?.resetsAt ?? null;

  const opusUtil =
    getNum(
      (obj.seven_day_opus as Record<string, unknown>) ?? {},
      "utilization",
    ) ?? null;
  const sonnetUtil =
    getNum(
      (obj.seven_day_sonnet as Record<string, unknown>) ?? {},
      "utilization",
    ) ?? null;

  let modelInfo = "claude.ai";
  if (opusUtil !== null && opusUtil > 0) modelInfo = "Opus";
  else if (sonnetUtil !== null && sonnetUtil > 0) modelInfo = "Sonnet";

  const extra = obj.extra_usage as Record<string, unknown> | null;
  const planType = extra?.is_enabled === true ? "Pro+" : "Pro";

  const resetTime = parseDateOrNull(fiveHourReset);
  const sevenDayResetTime =
    parseDateOrNull(sevenDayReset) ?? getDefaultResetTime();

  return {
    provider: "claude",
    currentUsage: fiveHourUtil,
    planLimit: 100,
    percentageUsed: fiveHourUtil,
    resetTime,
    sessionActive: fiveHour !== null,
    sevenDayUsage: sevenDayUtil,
    sevenDayResetTime,
    opusUsage: opusUtil,
    sonnetUsage: sonnetUtil,
    planType,
    modelInfo,
    userName: cachedOrgName ?? "Claude User",
    timestamp: new Date(),
  };
}

/**
 * Extract usage fields from any JSON object with flexible field name support.
 * Claude.ai may use different field names across deployments.
 */
function extractFromJsonObject(json: unknown): UsageData | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  // Try all known field name variants for "used" count
  const used =
    getNum(obj, "current_messages") ??
    getNum(obj, "messagesUsed") ??
    getNum(obj, "messages_used") ??
    getNum(obj, "message_count") ??
    getNum(obj, "currentUsage") ??
    null;

  // Try all known field name variants for "limit" — specific compound names only (not generic "limit")
  const limit =
    getNum(obj, "message_limit") ??
    getNum(obj, "messageLimit") ??
    getNum(obj, "messages_limit") ??
    getNum(obj, "max_messages") ??
    getNum(obj, "maxMessages") ??
    getNum(obj, "planLimit") ??
    null;

  // Only accept if we found a limit AND it's a plausible message count (< 100,000)
  // Values like 2,000,000 are byte/character limits, not message limits
  if (limit === null || limit === 0 || limit > 100000) return null;

  const usedVal = used ?? 0;
  const resetRaw =
    (obj.reset_at as string) ??
    (obj.resetAt as string) ??
    (obj.reset_time as string) ??
    (obj.resetTime as string) ??
    null;

  return {
    provider: "claude",
    currentUsage: usedVal,
    planLimit: limit,
    percentageUsed: (usedVal / limit) * 100,
    resetTime: resetRaw ? new Date(resetRaw) : getDefaultResetTime(),
    sessionActive: resetRaw !== null,
    sevenDayUsage: (usedVal / limit) * 100,
    sevenDayResetTime: resetRaw ? new Date(resetRaw) : getDefaultResetTime(),
    opusUsage: null,
    sonnetUsage: null,
    planType:
      (obj.plan_type as string) ??
      (obj.planType as string) ??
      (obj.plan as string) ??
      "Unknown",
    modelInfo:
      (obj.model as string) ??
      (obj.modelInfo as string) ??
      (obj.model_name as string) ??
      "Unknown",
    userName: cachedOrgName ?? "Claude User",
    timestamp: new Date(),
  };
}

function getNum(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
  return null;
}

function parseUsageWindow(
  value: unknown,
): { utilization: number; resetsAt: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if ("utilization" in record) {
    const utilization = getNum(record, "utilization");
    if (utilization === null) return null;

    const resetsAtRaw = record.resets_at;
    const resetsAt = typeof resetsAtRaw === "string" ? resetsAtRaw : null;
    return { utilization, resetsAt };
  }

  return { utilization: 0, resetsAt: null };
}

function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse RSC wire format (text/x-component).
 * Lines are prefixed: "0:...", "1:...", etc.
 */
function parseRSCResponse(data: string): UsageData | null {
  const lines = data.split("\n");
  for (const line of lines) {
    const match = line.match(/^\w+:(.*)/);
    if (!match) continue;
    try {
      const json = JSON.parse(match[1]);
      const result = searchObjectDeep(json);
      if (result) return result;
    } catch {
      // Not parseable JSON — skip
    }
  }
  return null;
}

/**
 * Same as parseRSCResponse but logs the matched object for debugging.
 */
function parseRSCResponseLogged(data: string): UsageData | null {
  const lines = data.split("\n");
  for (const line of lines) {
    const match = line.match(/^\w+:(.*)/);
    if (!match) continue;
    try {
      const json = JSON.parse(match[1]);
      const result = searchObjectDeep(json);
      if (result) {
        if (isDev)
          console.log(
            "[UsageFetcher] RSC match — raw object:",
            JSON.stringify(json).substring(0, 500),
          );
        if (isDev)
          console.log(
            "[UsageFetcher] RSC match — parsed result:",
            JSON.stringify(result),
          );
        return result;
      }
    } catch {
      // Not parseable JSON — skip
    }
  }
  return null;
}

function searchObjectDeep(obj: unknown): UsageData | null {
  if (!obj || typeof obj !== "object") return null;

  if (!Array.isArray(obj)) {
    const direct = extractFromJsonObject(obj);
    if (direct) return direct;
  }

  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      const nested = searchObjectDeep(val);
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Parse HTML — extract __NEXT_F flight data and search for usage JSON.
 * Next.js App Router embeds RSC flight data in HTML for client hydration.
 */
function parseHTMLForUsageData(html: string): UsageData | null {
  // Strategy 1: Find __next_f.push([1,"<rsc-data>"]) script calls
  const pattern = /__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  const chunks: string[] = [];

  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`));
    } catch {
      // Skip malformed
    }
  }

  if (chunks.length > 0) {
    const combined = chunks.join("\n");
    if (isDev)
      console.log(
        `[UsageFetcher] Found ${chunks.length} __next_f chunks (${combined.length} chars)`,
      );

    // Search RSC data for date strings (billing reset dates) and model names
    const dateMatches = [
      ...combined.matchAll(/"(202\d-\d{2}-\d{2}T[^"]{5,50})"/g),
    ];
    if (dateMatches.length > 0) {
      if (isDev)
        console.log(
          `[UsageFetcher] Found ${dateMatches.length} date strings in flight data:`,
        );
      for (const dm of dateMatches.slice(0, 5)) {
        const pos = dm.index ?? 0;
        if (isDev)
          console.log(
            `  Date: ${dm[1]} — context: ...${combined.substring(Math.max(0, pos - 80), pos + 100)}...`,
          );
      }
    } else {
      if (isDev)
        console.log("[UsageFetcher] No ISO date strings found in flight data");
    }

    // Search RSC data for API endpoint URLs
    const apiUrls = [...combined.matchAll(/"(\/api\/[^"]{5,100})"/g)];
    if (apiUrls.length > 0) {
      const uniqueUrls = [...new Set(apiUrls.map((m) => m[1]))];
      if (isDev)
        console.log(
          `[UsageFetcher] API URLs in RSC (${uniqueUrls.length} unique):`,
        );
      for (const url of uniqueUrls.slice(0, 20)) {
        if (isDev) console.log(`  ${url}`);
      }
    }
    // Also search for usage-related URL patterns
    const usageUrlMatches = [
      ...combined.matchAll(/["'](https?:\/\/[^"']+usage[^"']{0,100})["']/gi),
    ];
    if (usageUrlMatches.length > 0) {
      if (isDev)
        console.log(
          "[UsageFetcher] Usage URLs found:",
          usageUrlMatches
            .slice(0, 5)
            .map((m) => m[1])
            .join(", "),
        );
    }

    // Try RSC format on flight data
    const rscResult = parseRSCResponseLogged(combined);
    if (rscResult) return rscResult;

    // Search for JSON objects within flight data
    const jsonResult = searchForJsonWithUsageFields(combined);
    if (jsonResult) return jsonResult;
  }

  // Strategy 2: Search the entire HTML for JSON objects with usage fields
  const broadResult = searchForJsonWithUsageFields(html);
  if (broadResult) return broadResult;

  return null;
}

/**
 * Search text for JSON objects containing any known usage field names.
 */
function searchForJsonWithUsageFields(text: string): UsageData | null {
  const fieldNames = [
    "message_limit",
    "messageLimit",
    "messages_limit",
    "max_messages",
    "maxMessages",
    "planLimit",
  ];

  for (const field of fieldNames) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(`"${field}"`, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 1;

      // Find enclosing JSON object
      const start = text.lastIndexOf("{", idx);
      if (start === -1) continue;

      let depth = 0;
      let end = -1;
      for (let i = start; i < Math.min(text.length, start + 3000); i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }

      if (end !== -1) {
        try {
          const json = JSON.parse(text.substring(start, end));
          const result = extractFromJsonObject(json);
          if (result) {
            if (isDev)
              console.log(
                `[UsageFetcher] Found usage data via field "${field}":`,
                JSON.stringify(result),
              );
            return result;
          }
        } catch {
          // Not valid JSON at this location
        }
      }
    }
  }

  return null;
}

function safeParseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

interface ChatGPTParsedUsage {
  currentUsage: number;
  planLimit: number;
  percentageUsed: number;
  resetTime: Date | null;
  sessionActive: boolean;
  sevenDayUsage: number;
  sevenDayResetTime: Date;
  opusUsage: number | null;
  sonnetUsage: number | null;
  modelInfo: string;
}

function parseChatGPTRequirements(data: unknown): ChatGPTParsedUsage | null {
  if (!data || typeof data !== "object") return null;

  const candidateObjects = collectObjects(data);
  const usageCandidates: ChatGPTParsedUsage[] = [];

  for (const object of candidateObjects) {
    const limit =
      getNum(object, "limit") ??
      getNum(object, "max") ??
      getNum(object, "cap") ??
      getNum(object, "total") ??
      null;
    const remaining =
      getNum(object, "remaining") ??
      getNum(object, "left") ??
      getNum(object, "available") ??
      null;
    const used =
      getNum(object, "used") ??
      getNum(object, "consumed") ??
      getNum(object, "current_usage") ??
      null;

    let planLimit = limit;
    let currentUsage = used;

    if (planLimit === null && remaining !== null && used !== null) {
      planLimit = remaining + used;
    }
    if (currentUsage === null && planLimit !== null && remaining !== null) {
      currentUsage = Math.max(0, planLimit - remaining);
    }

    if (
      planLimit === null ||
      currentUsage === null ||
      planLimit <= 0 ||
      !Number.isFinite(planLimit) ||
      !Number.isFinite(currentUsage)
    ) {
      continue;
    }

    const rawReset =
      (object.reset_at as string) ??
      (object.resetAt as string) ??
      (object.resets_at as string) ??
      (object.resetsAt as string) ??
      null;
    const reset = parseDateOrNull(rawReset);

    const weeklyCap =
      getNum(object, "weekly_limit") ??
      getNum(object, "weekly_cap") ??
      getNum(object, "seven_day_limit") ??
      null;
    const weeklyUsed =
      getNum(object, "weekly_used") ??
      getNum(object, "seven_day_used") ??
      null;
    const weeklyResetRaw =
      (object.weekly_reset_at as string) ??
      (object.seven_day_reset_at as string) ??
      null;
    const weeklyReset = parseDateOrNull(weeklyResetRaw);

    const pct = Math.max(0, Math.min(100, (currentUsage / planLimit) * 100));
    const sevenDayUsage =
      weeklyCap && weeklyCap > 0 && weeklyUsed !== null
        ? Math.max(0, Math.min(100, (weeklyUsed / weeklyCap) * 100))
        : pct;

    const modelName =
      (object.model as string) ??
      (object.tier as string) ??
      (object.plan as string) ??
      "chatgpt.com";

    usageCandidates.push({
      currentUsage,
      planLimit,
      percentageUsed: pct,
      resetTime: reset,
      sessionActive: reset !== null,
      sevenDayUsage,
      sevenDayResetTime: weeklyReset ?? getDefaultResetTime(7 * 24),
      opusUsage: null,
      sonnetUsage: null,
      modelInfo: modelName,
    });
  }

  if (usageCandidates.length === 0) return null;

  usageCandidates.sort((a, b) => b.planLimit - a.planLimit);
  const primary = usageCandidates[0];

  const modelBreakdown = parseChatGPTModelBreakdown(candidateObjects);
  if (modelBreakdown) {
    primary.opusUsage = modelBreakdown.primaryModelPct;
    primary.sonnetUsage = modelBreakdown.secondaryModelPct;
    primary.modelInfo = modelBreakdown.modelInfo;
  }

  if (!primary.resetTime) {
    primary.resetTime = getDefaultResetTime(3);
    primary.sessionActive = true;
  }

  return primary;
}

function parseChatGPTModelBreakdown(
  candidates: Record<string, unknown>[],
): {
  primaryModelPct: number;
  secondaryModelPct: number;
  modelInfo: string;
} | null {
  type ModelEntry = { name: string; pct: number };
  const models: ModelEntry[] = [];

  for (const object of candidates) {
    const modelName =
      (object.model as string) ??
      (object.slug as string) ??
      (object.name as string) ??
      null;
    const used = getNum(object, "used") ?? getNum(object, "consumed") ?? null;
    const limit = getNum(object, "limit") ?? getNum(object, "max") ?? null;
    if (!modelName || used === null || limit === null || limit <= 0) continue;
    const pct = Math.max(0, Math.min(100, (used / limit) * 100));
    models.push({ name: modelName, pct });
  }

  if (models.length === 0) return null;
  models.sort((a, b) => b.pct - a.pct);
  return {
    primaryModelPct: Math.round(models[0]?.pct ?? 0),
    secondaryModelPct: Math.round(models[1]?.pct ?? 0),
    modelInfo: models
      .slice(0, 2)
      .map((entry) => entry.name)
      .join(", "),
  };
}

function parseChatGPTAccount(data: unknown): { userName: string; planType: string } {
  if (!data || typeof data !== "object") {
    return { userName: "ChatGPT User", planType: "Unknown" };
  }
  const candidates = collectObjects(data);
  for (const object of candidates) {
    const userName =
      (object.name as string) ??
      (object.display_name as string) ??
      (object.email as string) ??
      null;
    const planType =
      (object.plan_type as string) ??
      (object.plan as string) ??
      (object.subscription as string) ??
      (object.account_plan as string) ??
      null;
    if (userName || planType) {
      return {
        userName: userName ?? "ChatGPT User",
        planType: planType ?? "Unknown",
      };
    }
  }
  return { userName: "ChatGPT User", planType: "Unknown" };
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const stack: unknown[] = [value];
  const objects: Record<string, unknown>[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const record = current as Record<string, unknown>;
    objects.push(record);
    for (const nested of Object.values(record)) stack.push(nested);
  }
  return objects;
}

/**
 * Get default reset time (24 hours from now)
 */
function getDefaultResetTime(hoursFromNow: number = 24): Date {
  const resetTime = new Date();
  resetTime.setHours(resetTime.getHours() + hoursFromNow);
  return resetTime;
}
