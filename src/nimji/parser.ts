import type {
  CandidateScore,
  ConversationState,
  ExtractedPayload,
  GroundingSource,
} from "./types.js";
function extractConversationState(payload: unknown): ConversationState {
  const state: ConversationState = {};

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      if (
        node.length >= 2 &&
        Array.isArray(node[1]) &&
        typeof node[1][0] === "string" &&
        typeof node[1][1] === "string" &&
        node[1][0].startsWith("c_") &&
        node[1][1].startsWith("r_")
      ) {
        (state as Record<string, string>).conversationId ??= node[1][0];
        (state as Record<string, string>).responseId ??= node[1][1];
      }

      if (typeof node[0] === "string" && node[0].startsWith("rc_")) {
        (state as Record<string, string>).choiceId ??= node[0];
      }

      for (const value of node) walk(value);
      return;
    }

    if (node && typeof node === "object") {
      for (const value of Object.values(node)) walk(value);
    }
  };

  walk(payload);
  return state;
}

function decodeWrbFrame(chunk: unknown): unknown[] {
  if (Array.isArray(chunk)) return chunk;
  if (typeof chunk !== "string") return [];
  const normalized = chunk.trim().replace(/\n\d+$/, "");
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function looksLikeStandaloneLocation(value: string): boolean {
  const t = value.trim();
  if (t.length < 4 || t.length > 140) return false;
  if (/[\n\r]/.test(t)) return false;
  const parts = t.split(",").map((s) => s.trim());
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => {
    if (!p) return false;
    if (!/^[A-Za-z][A-Za-z\s.'-]*$/u.test(p)) return false;
    if (p.split(/\s+/).length > 5) return false;
    return true;
  });
}

function isStandaloneGeolocationNoiseBlock(value: string): boolean {
  const lines = value
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/\*{1,2}/g, "")
        .trim(),
    )
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every((line) => looksLikeStandaloneLocation(line));
}

function collectTextCandidates(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    const value = node.trim();
    if (
      value.length > 1 &&
      !value.startsWith("http") &&
      !value.startsWith("//") &&
      !value.startsWith("r_") &&
      !value.startsWith("c_") &&
      !value.startsWith("rc_") &&
      !/^[A-Za-z0-9_-]{20,}$/.test(value) &&
      !value.includes("SWML_DESCRIPTION_FROM_YOUR_INTERNET_ADDRESS") &&
      !looksLikeStandaloneLocation(value)
    ) {
      out.push(value);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collectTextCandidates(item, out);
    return;
  }

  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectTextCandidates(value, out);
  }
}

function normalizeForLh3UrlScan(raw: string): string {
  return raw.replace(/\\\//g, "/").replace(/\\u002f/gi, "/");
}

const LH3_IMAGE_PATH_RE =
  /https:\/\/lh3\.googleusercontent\.com\/(?:rd-gg-dl|rd-gg|gg-dl|blogger_img_proxy)\/[^"\s]+/gi;

function isLh3ImageNoise(url: string): boolean {
  return (
    url.includes("fonts.gstatic.com/") ||
    url.includes("googleusercontent.com/image_generation_content/")
  );
}

function trimTrailingJsonCruft(url: string): string {
  return url.replace(/[.,;)\]}\s\\]+$/g, "");
}

function discoverLh3ImageUrls(blob: string, out: Set<string>): void {
  const s = normalizeForLh3UrlScan(blob);
  LH3_IMAGE_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LH3_IMAGE_PATH_RE.exec(s)) !== null) {
    const url = trimTrailingJsonCruft(m[0]);
    if (url.length < 48) continue;
    if (isLh3ImageNoise(url)) continue;
    out.add(url);
  }
}

function collectImageUrls(node: unknown, out: Set<string>): void {
  if (typeof node === "string") {
    discoverLh3ImageUrls(node, out);
    const urlMatches = node.trim().match(/https?:\/\/[^\s"]+/g) ?? [];
    for (const found of urlMatches) {
      if (found.includes("lh3.googleusercontent.com/")) continue;
      const isRealImageUrl =
        /(\.png|\.jpg|\.jpeg|\.webp|\.gif|\.svg)(\?|$)/i.test(found) ||
        found.includes("encrypted-tbn0.gstatic.com/images");
      const isKnownNoise =
        found.includes("fonts.gstatic.com/") ||
        found.includes("googleusercontent.com/image_generation_content/");
      if (isRealImageUrl && !isKnownNoise) out.add(found);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collectImageUrls(item, out);
    return;
  }

  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectImageUrls(value, out);
  }
}

function collectGroundingSources(node: unknown, out: Map<string, GroundingSource>): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      if (typeof item === "string" && /^https?:\/\/[^\s"]+$/i.test(item.trim())) {
        const url = item.trim();
        if (
          !url.includes("lh3.googleusercontent.com") &&
          !url.includes("fonts.gstatic.com") &&
          !url.includes("google.com/search") &&
          !url.includes("clients6.google.com") &&
          !url.includes("googleusercontent.com")
        ) {
          let title = "";
          if (i + 1 < node.length && typeof node[i + 1] === "string") {
            const cand = (node[i + 1] as string).trim();
            if (cand.length >= 2 && cand.length <= 150 && !cand.startsWith("http")) {
              title = cand;
            }
          }
          if (!title && i > 0 && typeof node[i - 1] === "string") {
            const cand = (node[i - 1] as string).trim();
            if (cand.length >= 2 && cand.length <= 150 && !cand.startsWith("http")) {
              title = cand;
            }
          }
          if (!title) {
            try {
              title = new URL(url).hostname.replace(/^www\./, "");
            } catch {
              title = url;
            }
          }
          if (!out.has(url)) {
            out.set(url, { title, url });
          }
        }
      } else {
        collectGroundingSources(item, out);
      }
    }
    return;
  }

  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.url === "string" && typeof obj.title === "string") {
      const url = obj.url.trim();
      if (url.startsWith("http") && !out.has(url)) {
        out.set(url, {
          title: obj.title.trim(),
          url,
          snippet: typeof obj.snippet === "string" ? obj.snippet.trim() : undefined,
        });
      }
    }
    for (const value of Object.values(obj)) {
      collectGroundingSources(value, out);
    }
  }
}

/** Prefers durable `lh3` `rd-gg` URLs before short-lived `gg-dl` links. */
export function sortStableGoogleImageUrls(urls: readonly string[]): string[] {
  const rank = (u: string): number => {
    if (
      u.includes("lh3.googleusercontent.com/rd-gg/") ||
      u.includes("lh3.googleusercontent.com/rd-gg-dl/")
    ) {
      return 0;
    }
    if (u.includes("lh3.googleusercontent.com/gg-dl/")) return 1;
    return 2;
  };
  return [...urls].sort((a, b) => rank(a) - rank(b));
}

const NOISE_PHRASES = [
  "I've registered the user's",
  "Greeting and Assessment",
  "Longer",
  "Shorter",
  "Try again",
  "Answer now",
] as const;

function looksLikeImageGenerationProcessTrace(t: string): boolean {
  const s = t.trim();
  if (s.length < 160) return false;
  const boldMeta =
    /\*\*(?:Verifying|Confirming|Examining|Reviewing)\s+/i.test(s) ||
    /\*\*[A-Za-z][^*\n]{4,}\*\*\s*\n/i.test(s);
  const imProcess =
    /\bI['']m now (zeroing|focusing|checking)\b/i.test(s) ||
    /\bI['']ve moved on to examining\b/i.test(s) ||
    /\bThe details are coming together\b/i.test(s) ||
    /\bI['']m checking the scene\b/i.test(s);
  if (boldMeta && imProcess) return true;
  const boldBlocks = s.match(/\*\*[A-Za-z][^*]{6,}\*\*/g) ?? [];
  if (boldBlocks.length >= 3 && /\bI['']m\b/i.test(s)) return true;
  return false;
}

function looksLikeThoughtTrace(t: string): boolean {
  const s = t.trim();
  if (looksLikeImageGenerationProcessTrace(s)) return true;
  if (/^(?:\*{1,2}|#+\s*)?(?:Thought|Thinking Process|Reasoning)(?:\*{1,2}|:)/i.test(s))
    return true;
  if (s.startsWith("<thought>") || s.endsWith("</thought>")) return true;
  return false;
}

function scoreCandidate(value: string): number {
  const t = value.trim();
  if (t.length < 3) return -100;
  if (/^[A-Za-z0-9_-]{16,}$/.test(t)) return -100;
  if (/^(und|en|PH)$/i.test(t)) return -100;
  if (/^creating your image/i.test(t)) return -80;

  let score = 0;
  if (/[a-zA-Z]/.test(t)) score += 10;
  if (/\s/.test(t)) score += 20;
  if (/[.,!?;:]/.test(t)) score += 10;
  if (t.length > 20) score += 10;
  if (t.length > 60) score += 10;
  if (/https?:\/\//i.test(t) || t.startsWith("//")) score -= 50;
  if (t.includes("fonts.gstatic.com")) score -= 50;
  if (t.includes("google.com/maps")) score -= 50;
  if (t.includes("SWML_DESCRIPTION_FROM_YOUR_INTERNET_ADDRESS")) score -= 50;
  if (/^[\d\s.,-]+$/.test(t)) score -= 20;
  if (looksLikeThoughtTrace(t)) score -= 120;
  if (
    /^(?:A|An|The)\s+(?:candid|enchanting|detailed|beautiful|stunning|vibrant|serene)\b/i.test(t)
  ) {
    score += 40;
  }
  return score;
}

/** Extracts assistant text, lh3 URLs, and conversation ids from parsed StreamGenerate chunks. */
export function extractResponse(chunks: unknown[], rawStreamText?: string): ExtractedPayload {
  const allCandidates: CandidateScore[] = [];
  const imageUrls = new Set<string>();
  const groundingSources = new Map<string, GroundingSource>();
  let conversation: ConversationState = {};

  if (rawStreamText) {
    discoverLh3ImageUrls(rawStreamText, imageUrls);
    if (/%[0-9A-Fa-f]{2}/.test(rawStreamText)) {
      try {
        discoverLh3ImageUrls(decodeURIComponent(rawStreamText), imageUrls);
      } catch {
        /* noop */
      }
    }
  }

  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      discoverLh3ImageUrls(chunk, imageUrls);
    }

    const frame = decodeWrbFrame(chunk);
    if (frame.length === 0) continue;

    for (const entry of frame) {
      if (!Array.isArray(entry)) continue;
      const [, , payloadStr] = entry as [unknown, unknown, unknown];
      if (typeof payloadStr !== "string") continue;

      discoverLh3ImageUrls(payloadStr, imageUrls);

      try {
        const payload = JSON.parse(payloadStr);
        const candidates: string[] = [];
        collectTextCandidates(payload, candidates);
        collectImageUrls(payload, imageUrls);
        collectGroundingSources(payload, groundingSources);
        const ids = extractConversationState(payload);
        conversation = {
          conversationId: conversation.conversationId ?? ids.conversationId,
          responseId: conversation.responseId ?? ids.responseId,
          choiceId: conversation.choiceId ?? ids.choiceId,
        };

        for (const value of candidates) {
          allCandidates.push({ value, score: scoreCandidate(value) });
        }
      } catch {
        continue;
      }
    }
  }

  const ranked = allCandidates
    .filter((item) => {
      if (item.score < 20) return false;
      if (/^creating your image/i.test(item.value.trim())) return false;
      const trimmed = item.value.trim();
      const geoOneLine = trimmed.replace(/\*{1,2}/g, "").trim();
      if (looksLikeStandaloneLocation(geoOneLine) || isStandaloneGeolocationNoiseBlock(trimmed)) {
        return false;
      }
      return !NOISE_PHRASES.some((phrase) => item.value.includes(phrase));
    })
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length);

  const unique: CandidateScore[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    unique.push(item);
  }

  const withoutProcessTrace = unique.filter((item) => !looksLikeThoughtTrace(item.value));
  const ordered = withoutProcessTrace.length > 0 ? withoutProcessTrace : unique;
  const top = ordered[0];

  const thoughtItem = allCandidates.find((item) => looksLikeThoughtTrace(item.value));
  const thought = thoughtItem ? thoughtItem.value : null;
  const sourcesList = [...groundingSources.values()];

  return {
    text: top?.value ?? null,
    thought,
    imageUrls: sortStableGoogleImageUrls([...imageUrls]),
    sources: sourcesList.length > 0 ? sourcesList : undefined,
    candidates: ordered,
    conversation,
  };
}
