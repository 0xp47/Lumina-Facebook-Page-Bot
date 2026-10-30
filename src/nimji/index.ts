/**
 * Nimji — Gemini web `StreamGenerate` client. This module is the stable npm entry surface.
 *
 * @packageDocumentation
 */

export { create, createClient, createClientFromEnv } from "./client.js";
export { sortStableGoogleImageUrls } from "./parser.js";
export {
  IMAGE_PIPELINE_DISABLED,
  upgradeGgDlUrlsFromRedirects,
  downloadImages,
  uploadImageToGemini,
  inferMimeTypeFromPath,
} from "./images.js";
export {
  loadConfigFromEnv,
  mergeProjectConfigIntoEnv,
  resetProjectConfigMergeCache,
  validateConfig,
} from "./config.js";
export type { ConfigOverrides, ConfigPick, CreateInput, LoadConfigOptions } from "./config.js";
export {
  buildBatchexecuteKeepaliveBody,
  buildBatchexecuteHeaders,
  buildBatchexecutePath,
  buildSecChUaHeaders,
  chromeMajorFromFullVersion,
  runBatchexecuteKeepalive,
} from "./transport.js";
export { createSessionStore } from "./session.js";
export { ok, fail } from "./types.js";
export type {
  CandidateScore,
  ClientOptions,
  ConversationState,
  ExtractedPayload,
  GemaiAuth,
  GemaiClient,
  GemaiConfig,
  GemaiHooks,
  GenerateOptions,
  GenerateResult,
  GroundingSource,
  HookContext,
  ImageAttachment,
  KeepaliveBatchexecuteConfig,
  KeepaliveOptions,
  RequestContext,
  Result,
  RuntimeOptions,
  SessionStore,
  StreamMeta,
} from "./types.js";

// Professional Nimji AI Agent for CCSAS
export * from "./agent/index.js";
