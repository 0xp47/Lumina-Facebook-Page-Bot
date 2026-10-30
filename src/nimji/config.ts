import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import stripJsonComments from "strip-json-comments";
import { resolveAppHomeDir } from "./paths.js";
import type {
  GemaiConfig,
  KeepaliveBatchexecuteConfig,
  KeepaliveOptions,
  Result,
} from "./types.js";
import { ok, fail } from "./types.js";

/** Flat env-style keys (e.g. `COOKIES`) passed into {@link loadConfigFromEnv} / {@link create}. */
export type ConfigOverrides = Readonly<
  Partial<Record<string, string | number | boolean | undefined>>
>;

/** Env overrides for {@link create} plus optional `keepalive` (stripped before env merge). */
export type CreateInput = ConfigOverrides & {
  readonly keepalive?: boolean | KeepaliveOptions;
};

export type ConfigPick = (key: string, fallback?: string) => string;

export function makePick(overrides?: ConfigOverrides): ConfigPick {
  return (key: string, fallback = ""): string => {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      const raw = overrides[key];
      if (raw === undefined) return process.env[key] ?? fallback;
      if (typeof raw === "boolean") return raw ? "1" : "0";
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
      return String(raw);
    }
    return process.env[key] ?? fallback;
  };
}

/** Only merge keys that look like `process.env` names (nested config groups). */
const NESTED_ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

const NESTED_CONFIG_ROOT_KEYS = new Set(["chat", "keepalive", "runtime", "browser"]);

function mergeNestedEnvFromObject(obj: unknown): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [envKey, val] of Object.entries(obj as Record<string, unknown>)) {
    if (!NESTED_ENV_KEY.test(envKey)) continue;
    if (process.env[envKey] !== undefined) continue;
    if (val === null || val === undefined) continue;
    if (typeof val === "string") process.env[envKey] = val;
    else if (typeof val === "number" && Number.isFinite(val)) process.env[envKey] = String(val);
    else if (typeof val === "boolean") process.env[envKey] = val ? "1" : "0";
  }
}

const MAX_CONFIG_FILE_BYTES = 256 * 1024; // 256 KiB

let configMergeDone = false;
let lastMergedConfigPath: string | null = null;

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // noop
  }
}

/**
 * Hydrates missing `process.env` from the first matching JSON config file (or `NIMJI_CONFIG`).
 * Search order: `NIMJI_CONFIG` / `GEMAI_CONFIG`, then `./config.jsonc` | `./config.json` under `cwd`,
 * then `config.jsonc` | `config.json` under {@link resolveAppHomeDir} (`~/.nimji` by default).
 * Existing env always wins. Nested groups: `chat`, `keepalive`, `runtime`, `browser`, `upload`.
 */
export function mergeProjectConfigIntoEnv(cwd: string = process.cwd()): string | null {
  loadEnvFile(path.resolve(cwd, ".env"));
  const appHome = resolveAppHomeDir();
  loadEnvFile(path.resolve(appHome, ".env"));

  if (configMergeDone) return lastMergedConfigPath;

  const candidates: string[] = [];
  const fromEnv = (process.env.NIMJI_CONFIG ?? process.env.GEMAI_CONFIG)?.trim();
  if (fromEnv) {
    candidates.push(path.isAbsolute(fromEnv) ? fromEnv : path.resolve(cwd, fromEnv));
  }
  candidates.push(path.resolve(cwd, "config.jsonc"));
  candidates.push(path.resolve(cwd, "config.json"));
  candidates.push(path.join(appHome, "config.jsonc"));
  candidates.push(path.join(appHome, "config.json"));

  const tried = new Set<string>();
  let applied: string | null = null;

  for (const filePath of candidates) {
    if (tried.has(filePath)) continue;
    tried.add(filePath);
    if (!existsSync(filePath)) continue;

    try {
      const stat = statSync(filePath);
      if (stat.size > MAX_CONFIG_FILE_BYTES) continue; // skip oversized files silently
      const raw = readFileSync(filePath, "utf8");
      const stripped = stripJsonComments(raw, { whitespace: false });
      const parsed: unknown = JSON.parse(stripped);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      const root = parsed as Record<string, unknown>;

      for (const [key, val] of Object.entries(root)) {
        if (!key || typeof key !== "string") continue;
        if (NESTED_CONFIG_ROOT_KEYS.has(key)) continue;
        if (process.env[key] !== undefined) continue;
        if (val === null || val === undefined) continue;

        if (typeof val === "string") process.env[key] = val;
        else if (typeof val === "number" && Number.isFinite(val)) process.env[key] = String(val);
        else if (typeof val === "boolean") process.env[key] = val ? "1" : "0";
      }

      const chatVal = root.chat;
      if (chatVal !== null && typeof chatVal === "object" && !Array.isArray(chatVal)) {
        const c = chatVal as Record<string, unknown>;
        const densRaw = c.UI_DENSITY ?? c.density;
        const ansRaw = c.UI_ANSWER_STYLE ?? c.answerStyle;
        if (typeof densRaw === "string") {
          const t = densRaw.trim();
          if (t && process.env.UI_DENSITY === undefined) process.env.UI_DENSITY = t;
        }
        if (typeof ansRaw === "string") {
          const t = ansRaw.trim();
          if (t && process.env.UI_ANSWER_STYLE === undefined) process.env.UI_ANSWER_STYLE = t;
        }
      }

      mergeNestedEnvFromObject(root.keepalive);
      mergeNestedEnvFromObject(root.runtime);
      mergeNestedEnvFromObject(root.browser);
      mergeNestedEnvFromObject(root.upload);

      applied = filePath;
      break;
    } catch {
      /* next candidate */
    }
  }

  configMergeDone = true;
  lastMergedConfigPath = applied;
  return applied;
}

/** Testing helper — clears merge memoization so another cwd/file can load. */
export function resetProjectConfigMergeCache(): void {
  configMergeDone = false;
  lastMergedConfigPath = null;
}

const MAX_KEEPALIVE_F_REQ_BYTES = 512 * 1024;

function extractRpcIdFromFReqOuter(json: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const layer1 = parsed[0];
    if (!Array.isArray(layer1) || layer1.length === 0) return null;
    const triple = layer1[0];
    if (!Array.isArray(triple) || typeof triple[0] !== "string") return null;
    return triple[0];
  } catch {
    return null;
  }
}

function loadKeepaliveBatchexecute(cwd: string, pick: ConfigPick): KeepaliveBatchexecuteConfig {
  const rpcFromEnv = pick("KEEPALIVE_RPC", "").trim();
  const freqPath = pick("KEEPALIVE_F_REQ_PATH", "").trim();
  const freqInline = pick("KEEPALIVE_F_REQ", "").trim();

  let fReqOuterJson: string | undefined;

  if (freqPath) {
    const abs = path.isAbsolute(freqPath) ? freqPath : path.resolve(cwd, freqPath);
    // Reject paths that escape cwd to prevent reading arbitrary files via ../../ traversal
    const safeRoot = path.resolve(cwd) + path.sep;
    if (!abs.startsWith(safeRoot) && abs !== path.resolve(cwd)) {
      throw new Error(`KEEPALIVE_F_REQ_PATH must be inside the project directory: ${abs}`);
    }
    if (!existsSync(abs)) {
      throw new Error(`KEEPALIVE_F_REQ_PATH not found: ${abs}`);
    }
    const buf = readFileSync(abs);
    if (buf.length > MAX_KEEPALIVE_F_REQ_BYTES) {
      throw new Error(`KEEPALIVE_F_REQ_PATH exceeds ${MAX_KEEPALIVE_F_REQ_BYTES} bytes: ${abs}`);
    }
    fReqOuterJson = buf.toString("utf8").trim();
    try {
      JSON.parse(fReqOuterJson);
    } catch (err) {
      throw new Error(`Invalid JSON in KEEPALIVE_F_REQ_PATH (${abs})`, { cause: err });
    }
  } else if (freqInline) {
    fReqOuterJson = freqInline.trim();
    try {
      JSON.parse(fReqOuterJson);
    } catch (err) {
      throw new Error("Invalid JSON in KEEPALIVE_F_REQ", { cause: err });
    }
  }

  let rpcId: string;

  if (fReqOuterJson) {
    const extracted = extractRpcIdFromFReqOuter(fReqOuterJson);
    if (rpcFromEnv) {
      if (extracted && extracted !== rpcFromEnv) {
        throw new Error(
          `KEEPALIVE_RPC (${rpcFromEnv}) does not match rpc inside KEEPALIVE_F_REQ (${extracted})`,
        );
      }
      rpcId = rpcFromEnv;
    } else if (extracted) {
      rpcId = extracted;
    } else {
      throw new Error('KEEPALIVE_RPC must be set when f.req JSON is not [[["rpcId", …]]]');
    }
  } else {
    rpcId = rpcFromEnv || "aPya6c";
  }

  const innerPayloadJson = pick("KEEPALIVE_INNER_PAYLOAD", "").trim() || undefined;
  const googExt525001261Jspb = pick("KEEPALIVE_GOOG_EXT_525001261_JSPB", "").trim() || undefined;

  return {
    rpcId,
    fReqOuterJson,
    innerPayloadJson,
    googExt525001261Jspb,
  };
}

const normalizeCookies = (raw: string): string => {
  const value = raw.trim();
  if (!value) return value;

  const firstQuote = value.indexOf('"');
  const lastQuote = value.lastIndexOf('"');
  if (firstQuote >= 0 && lastQuote > firstQuote) {
    return value.slice(firstQuote + 1, lastQuote);
  }
  return value;
};

const toNum = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const randomSourcePath = (): string => randomUUID().replace(/-/g, "").slice(0, 16);

const DEFAULT_BL_BUILD = "boq_assistant-bard-web-server_20260427.06_p7";

function resolveBlParam(pick: ConfigPick): string {
  const explicitBl = pick("BL_PARAM", "").trim();
  if (explicitBl) return explicitBl;

  const raw = pick("MODEL", "").trim();
  if (!raw || /^auto$/i.test(raw)) return DEFAULT_BL_BUILD;

  if (/boq_assistant/i.test(raw)) return raw.trim();

  return DEFAULT_BL_BUILD;
}

const defaultUserAgentForChrome = (chromeFullVersion: string): string =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVersion.trim()} Safari/537.36`;

/** Options for locating project-level JSON config before reading env. */
export type LoadConfigOptions = {
  readonly cwd?: string;
  /** Wins over `process.env` and merged project JSON for keys you pass (same names as env, e.g. `COOKIES`). */
  readonly overrides?: ConfigOverrides;
};

/** Builds {@link GemaiConfig} from env (after optional JSON merge) and optional flat overrides. */
export function loadConfigFromEnv(options?: LoadConfigOptions): GemaiConfig {
  const cwd = options?.cwd ?? process.cwd();
  mergeProjectConfigIntoEnv(cwd);
  const pick = makePick(options?.overrides);

  const chromeFullVersion = pick("CHROME_FULL_VERSION", "147.0.7727.56").trim();
  const userAgentRaw = pick("USER_AGENT", "").trim();
  return {
    auth: {
      cookies: normalizeCookies(pick("COOKIES")),
      atToken: pick("AT_TOKEN").trim(),
      fSid: pick("F_SID").trim(),
    },
    context: {
      blParam: resolveBlParam(pick),
      sourcePath: pick("SOURCE_PATH", `/app/${randomSourcePath()}`),
      reqId: pick("REQ_ID", String(Math.floor(1_000_000 + Math.random() * 9_000_000))),
      requestUuid: pick("REQUEST_UUID", randomUUID().toUpperCase()),
      sessionFingerprint: pick("SESSION_FINGERPRINT", "5bf011840784117a"),
      requestBlob: pick("REQUEST_BLOB", "") || undefined,
      requestHash: pick("REQUEST_HASH", "") || undefined,
      ext525001261Tail: toNum(pick("EXT_525001261_TAIL", "1"), 1),
      browserValidation: pick("X_BROWSER_VALIDATION", "EsmT91Yc2imP58B+tvFt/g1KK/I="),
      clientData: pick("X_CLIENT_DATA", "CKmdygEIlKHLAQiFoM0BCLG+zwEYv6nKARj0ss8BGPW0zwE="),
      language: pick("LANGUAGE", "en"),
      chromeFullVersion,
      acceptLanguage: pick("ACCEPT_LANGUAGE", "en-US,en;q=0.9"),
      secChUaPlatform: pick("SEC_CH_UA_PLATFORM", "Windows"),
      secChUaPlatformVersion: pick("SEC_CH_UA_PLATFORM_VERSION", "19.0.0"),
      browserChannel: pick("X_BROWSER_CHANNEL", "stable"),
      browserCopyright: pick(
        "X_BROWSER_COPYRIGHT",
        "Copyright 2026 Google LLC. All Rights reserved.",
      ),
      userAgent: userAgentRaw || defaultUserAgentForChrome(chromeFullVersion),
    },
    conversation: {
      conversationId: pick("CONVERSATION_ID", "") || undefined,
      responseId: pick("RESPONSE_ID", "") || undefined,
      choiceId: pick("CHOICE_ID", "") || undefined,
    },
    runtime: {
      streamIdleTimeoutMs: toNum(pick("STREAM_IDLE_TIMEOUT_MS", "30000"), 30_000),
      streamMaxDurationMs: toNum(pick("STREAM_MAX_DURATION_MS", "180000"), 180_000),
      imageStreamIdleTimeoutMs: toNum(pick("IMAGE_STREAM_IDLE_TIMEOUT_MS", "120000"), 120_000),
      imageStreamMaxDurationMs: toNum(pick("IMAGE_STREAM_MAX_DURATION_MS", "600000"), 600_000),
      debugCandidates: pick("DEBUG_CANDIDATES", "0") === "1",
    },
    keepalive: loadKeepaliveBatchexecute(cwd, pick),
  };
}

/** Ensures `COOKIES`, `AT_TOKEN`, and `F_SID` are present before hitting Gemini. */
export function validateConfig(config: GemaiConfig): Result<GemaiConfig> {
  const missing: string[] = [];
  if (!config.auth.cookies) missing.push("COOKIES");
  if (!config.auth.atToken) missing.push("AT_TOKEN");
  if (!config.auth.fSid) missing.push("F_SID");

  if (missing.length > 0) {
    return fail(
      new Error(
        `Missing required configuration: ${missing.join(", ")} (environment, project or ~/.nimji config.json(c), or create({ … }) overrides)`,
      ),
    );
  }
  return ok(config);
}
