/** Explicit success/error result (used across the library instead of throwing). */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Mark a successful {@link Result}. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Mark a failed {@link Result}. */
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Multi-turn conversation handles returned inside stream payloads. */
export type ConversationState = {
  readonly conversationId?: string;
  readonly responseId?: string;
  readonly choiceId?: string;
};

/** Stream read timeouts and debug toggles (`STREAM_*`, `IMAGE_STREAM_*`, `DEBUG_CANDIDATES`). */
export type RuntimeOptions = {
  readonly streamIdleTimeoutMs: number;
  readonly streamMaxDurationMs: number;
  readonly imageStreamIdleTimeoutMs: number;
  readonly imageStreamMaxDurationMs: number;
  readonly debugCandidates: boolean;
};

/** Required session cookies/token for Gemini web requests. */
export type GemaiAuth = {
  readonly cookies: string;
  readonly atToken: string;
  readonly fSid: string;
};

/** Browser-like metadata for StreamGenerate (UA, `bl`, client hints, etc.). */
export type RequestContext = {
  /** StreamGenerate `bl=` build id; override with `BL_PARAM` / `MODEL` in env. */
  readonly blParam: string;
  readonly sourcePath: string;
  readonly reqId?: string;
  readonly requestUuid?: string;
  readonly sessionFingerprint: string;
  readonly requestBlob?: string;
  readonly requestHash?: string;
  readonly ext525001261Tail: number;
  readonly browserValidation: string;
  readonly clientData: string;
  readonly language: string;
  readonly userAgent: string;
  readonly chromeFullVersion: string;
  readonly acceptLanguage: string;
  readonly secChUaPlatform: string;
  readonly secChUaPlatformVersion: string;
  readonly browserChannel: string;
  readonly browserCopyright: string;
};

/**
 * Batchexecute keepalive payload. Filled from `KEEPALIVE_RPC`, `KEEPALIVE_F_REQ_PATH`, etc.
 *
 * - `fReqOuterJson` — paste full DevTools `f.req` JSON when you need a browser-identical ping.
 * - Otherwise `rpcId` + optional `innerPayloadJson` build a minimal generic wrapper.
 */
export type KeepaliveBatchexecuteConfig = {
  readonly rpcId: string;
  readonly fReqOuterJson?: string;
  readonly innerPayloadJson?: string;
  readonly googExt525001261Jspb?: string;
};

/** Full config: credentials, forged browser context, timeouts, uploads, keepalive. */
export type GemaiConfig = {
  readonly auth: GemaiAuth;
  readonly context: RequestContext;
  readonly conversation?: ConversationState;
  readonly runtime: RuntimeOptions;
  readonly keepalive?: KeepaliveBatchexecuteConfig;
};

/**
 * An image attached to a generate() call as a Gemini contribution token.
 * Obtained by calling `uploadImageToGemini` in `images.ts`.
 */
export type ImageAttachment = {
  /** The `/contrib_service/ttl_1d/<token>` path returned by the Gemini upload endpoint. */
  readonly tokenPath: string;
  /** MIME type, e.g. `"image/png"`, `"image/jpeg"`. */
  readonly mimeType: string;
  /** Original filename used when uploading. */
  readonly fileName: string;
};

/** Single `generate()` invocation options. */
export type GenerateOptions = {
  readonly prompt: string;
  readonly includeImages?: boolean;
  readonly saveImages?: boolean;
  readonly imageOutputDir?: string;
  /** Optional image to attach to the prompt (uploaded via `uploadImageToGemini`). */
  readonly imageAttachment?: ImageAttachment;
  /** Optional callback fired incrementally whenever new text tokens arrive. */
  readonly onToken?: (token: string) => void | Promise<void>;
  /** If true, do not reuse or inherit any previous conversation state. */
  readonly freshConversation?: boolean;
  /** Explicit conversation state to use for this call (overrides client state). */
  readonly conversation?: ConversationState;
};

/** HTTP/stream stats copied from the raw Gemini response. */
export type StreamMeta = {
  readonly statusCode: number;
  readonly contentType: string;
  readonly rawSize: number;
  readonly chunkCount: number;
};

/** Grounding / web search source cited by Gemini web. */
export type GroundingSource = {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
};

/** Parsed assistant reply plus CDN URLs, optional citations, and optional saved/upload paths. */
export type GenerateResult = {
  readonly text: string | null;
  readonly thought?: string | null;
  readonly imageUrls: readonly string[];
  readonly sources?: readonly GroundingSource[];
  readonly savedImagePaths: readonly string[];
  readonly conversation: ConversationState;
  readonly meta: StreamMeta;
};

/** Internal scoring tuple used while ranking text candidates. */
export type CandidateScore = {
  readonly value: string;
  readonly score: number;
};

/** Hook payload describing the outbound StreamGenerate POST. */
export type HookContext = {
  readonly prompt: string;
  readonly path: string;
  readonly body: string;
};

/** Optional instrumentation hooks for requests, ranking, and image I/O. */
export type GemaiHooks = {
  readonly onRequest?: (ctx: HookContext) => Promise<void> | void;
  readonly onCandidates?: (candidates: CandidateScore[]) => Promise<void> | void;
  readonly onImageDownloadAttempt?: (url: string) => Promise<void> | void;
  readonly onImageDownloadSkip?: (reason: string, url: string) => Promise<void> | void;
};

/**
 * In-process timer keepalive (`createClient` / `create`); detached daemon uses `runKeepalive` instead.
 * Pass `true` for defaults; `{}` or a partial object toggles advanced fields (`intervalMs`, `prompt`).
 */
export type KeepaliveOptions = {
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly prompt?: string;
};

/** Pass `{ hooks }` and/or `{ keepalive }` when constructing a client. */
export type ClientOptions = {
  readonly hooks?: GemaiHooks;
  readonly keepalive?: KeepaliveOptions | boolean;
};

/** Parser output before hooks/downloads mutate paths. */
export type ExtractedPayload = {
  readonly text: string | null;
  readonly thought?: string | null;
  readonly imageUrls: readonly string[];
  readonly sources?: readonly GroundingSource[];
  readonly candidates: readonly CandidateScore[];
  readonly conversation: ConversationState;
};

/** Handle returned by {@link createClient}, {@link create}, or {@link createClientFromEnv}. */
export type GemaiClient = {
  readonly getConversation: () => ConversationState;
  readonly setConversation: (state: ConversationState) => void;
  readonly resetConversation: () => void;
  readonly generate: (options: GenerateOptions) => Promise<Result<GenerateResult>>;
  readonly startKeepalive: (options?: KeepaliveOptions) => void;
  readonly stopKeepalive: () => void;
  /** Closes any persistent HTTP sockets and timers managed by this client. */
  readonly close?: () => Promise<void>;
};

/** Tiny filesystem helper around `session.json` (or a custom path). */
export type SessionStore = {
  readonly path: string;
  readonly load: () => Promise<ConversationState>;
  readonly save: (state: ConversationState) => Promise<void>;
  readonly clear: () => Promise<void>;
};
