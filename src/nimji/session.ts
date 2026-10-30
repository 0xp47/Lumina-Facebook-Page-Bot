import { readFile, unlink, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveAppHomeDir } from "./paths.js";
import type { ConversationState, SessionStore } from "./types.js";

const MAX_SESSION_FILE_BYTES = 64 * 1024;
const MAX_CONVERSATION_FIELD_LEN = 4096;

function normalizeConversationState(parsed: unknown): ConversationState {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const o = parsed as Record<string, unknown>;
  const pick = (key: string): string | undefined => {
    const v = o[key];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (!t || t.length > MAX_CONVERSATION_FIELD_LEN) return undefined;
    return t;
  };
  return {
    conversationId: pick("conversationId"),
    responseId: pick("responseId"),
    choiceId: pick("choiceId"),
  };
}

/** File-backed conversation cursor (default path: `<nimji-home>/session.json`). */
export function createSessionStore(filePath?: string): SessionStore {
  const baseDir = resolveAppHomeDir();
  const resolved = filePath ?? path.resolve(baseDir, "session.json");

  return {
    path: resolved,

    async load(): Promise<ConversationState> {
      try {
        const buf = await readFile(/*turbopackIgnore: true*/ resolved);
        if (buf.length > MAX_SESSION_FILE_BYTES) return {};
        const raw = buf.toString("utf8");
        const parsed: unknown = JSON.parse(raw);
        return normalizeConversationState(parsed);
      } catch {
        return {};
      }
    },

    async save(state: ConversationState): Promise<void> {
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, JSON.stringify(state, null, 2), "utf8");
    },

    async clear(): Promise<void> {
      try {
        await unlink(resolved);
      } catch {
        /* noop */
      }
    },
  };
}
