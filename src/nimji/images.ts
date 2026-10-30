import { fetch } from "undici";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSecChUaHeaders } from "./transport.js";
import type { GemaiConfig, GemaiHooks, ImageAttachment } from "./types.js";

/**
 * Strip patterns that look like session cookies, auth tokens, or SID values from an HTTP
 * error body before the message is surfaced in thrown errors or CLI output.
 * Matches: `key=<base64/alphanum value>` pairs and bare long base64-ish strings (≥ 32 chars).
 */
export function redactErrorBody(raw: string, maxLen = 300): string {
  return raw
    .slice(0, maxLen * 4) // work on a reasonable prefix before regex
    .replace(
      /\b(SID|PSID|SSID|APISID|SAPISID|HSID|NID|AEC|SIDCC|ENID|BUCKET)[^;,\s"]{8,}/gi,
      "$1=[redacted]",
    )
    .replace(/\b[\w-]{32,}={0,2}\b/g, "[redacted]")
    .slice(0, maxLen);
}

export const IMAGE_PIPELINE_DISABLED = process.env.IMAGE_PIPELINE_DISABLED === "1";

function isPipelineDisabled(): boolean {
  return process.env.IMAGE_PIPELINE_DISABLED === "1";
}

const GOOGLEBOT_IMAGE_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const MAX_IMAGE_DOWNLOAD_BYTES = 40 * 1024 * 1024;

const EXT_MAP: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function inferExt(contentType: string): string {
  for (const [key, value] of Object.entries(EXT_MAP)) {
    if (contentType.includes(key)) return value;
  }
  return "bin";
}

function buildCandidates(originalUrl: string): string[] {
  const out: string[] = [];
  const addUnique = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  const addAlr = (value: string): string => {
    try {
      const parsed = new URL(value);
      if (!parsed.searchParams.has("alr")) parsed.searchParams.set("alr", "yes");
      return parsed.toString();
    } catch {
      return value;
    }
  };
  const addSizeVariant = (value: string, suffix: string): string => {
    try {
      const parsed = new URL(value);
      const basePath = parsed.pathname;
      const cleanPath = basePath.includes("=")
        ? basePath.slice(0, basePath.indexOf("="))
        : basePath;
      parsed.pathname = `${cleanPath}${suffix}`;
      return parsed.toString();
    } catch {
      return value;
    }
  };

  // Primary high-resolution variants for Google LH3 CDN
  const highResSuffixes = ["=s0", "=s2048-rj", "=s1024-rj"];

  for (const suffix of highResSuffixes) {
    const variant = addSizeVariant(originalUrl, suffix);
    addUnique(addAlr(variant));
    addUnique(variant);
  }

  // Fallback to original URL if high-res variants fail
  addUnique(addAlr(originalUrl));
  addUnique(originalUrl);

  return out;
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]!);
    }
  });

  await Promise.all(runners);
  return results;
}

function buildHeaderProfiles(
  config: GemaiConfig,
): Array<{ name: string; headers: Record<string, string> }> {
  return [
    {
      name: "googlebot-with-cookie",
      headers: {
        accept: "*/*",
        "accept-language": config.context.acceptLanguage,
        cookie: config.auth.cookies,
        referer: "https://www.google.com/",
        "user-agent": GOOGLEBOT_IMAGE_UA,
      },
    },
    {
      name: "browser-full-image",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": config.context.acceptLanguage,
        cookie: config.auth.cookies,
        referer: "https://gemini.google.com/",
        ...buildSecChUaHeaders(config),
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
        "user-agent": config.context.userAgent,
      },
    },
    {
      name: "browser-with-cookie",
      headers: {
        accept: "*/*",
        "accept-language": config.context.acceptLanguage,
        cookie: config.auth.cookies,
        origin: "https://gemini.google.com",
        priority: "u=1, i",
        referer: "https://gemini.google.com/",
        ...buildSecChUaHeaders(config),
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
        "sec-fetch-storage-access": "active",
        "user-agent": config.context.userAgent,
        "x-browser-channel": config.context.browserChannel,
        "x-browser-copyright": config.context.browserCopyright,
        "x-browser-validation": config.context.browserValidation,
        "x-browser-year": "2026",
        "x-client-data": config.context.clientData,
      },
    },
  ];
}

async function drainResponseBody(res: Awaited<ReturnType<typeof fetch>>): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {
    /* noop */
  }
}

async function followGgDlRedirectChain(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 15; hop++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await drainResponseBody(res);
      if (!loc) return url;
      current = new URL(loc, current).href;
      if (current.includes("/rd-gg/") || current.includes("/rd-gg-dl/")) return current;
      continue;
    }
    await drainResponseBody(res);
    return url;
  }
  return url;
}

/** Walks `gg-dl` redirects until a stable `rd-gg` URL appears (session-dependent). */
export async function upgradeGgDlUrlsFromRedirects(
  config: GemaiConfig,
  urls: readonly string[],
): Promise<string[]> {
  if (isPipelineDisabled()) return [...urls];

  const profiles = buildHeaderProfiles(config);
  return Promise.all(
    urls.map(async (url) => {
      if (!url.includes("/gg-dl/")) return url;
      try {
        for (const profile of profiles) {
          const upgraded = await followGgDlRedirectChain(url, profile.headers);
          if (upgraded.includes("/rd-gg/") || upgraded.includes("/rd-gg-dl/")) return upgraded;
        }
        return url;
      } catch {
        return url;
      }
    }),
  );
}

/** Attempts concurrent lh3 downloads + optional disk persistence. */
export async function downloadImages(
  config: GemaiConfig,
  urls: readonly string[],
  outputDir: string,
  options?: { saveFiles?: boolean },
  hooks?: GemaiHooks,
): Promise<{ savedPaths: string[] }> {
  if (isPipelineDisabled()) return { savedPaths: [] };

  const saveFiles = options?.saveFiles ?? true;
  if (urls.length === 0) return { savedPaths: [] };

  if (saveFiles) {
    await mkdir(outputDir, { recursive: true });
  }
  const headerProfiles = buildHeaderProfiles(config);

  const perUrl = await mapLimit([...urls], 4, async (url) => {
    const candidates = buildCandidates(url);

    for (const candidateUrl of candidates) {
      for (const profile of headerProfiles) {
        hooks?.onImageDownloadAttempt?.(candidateUrl);
        try {
          const res = await fetch(candidateUrl, {
            method: "GET",
            redirect: "follow",
            headers: profile.headers,
            signal: AbortSignal.timeout(6000),
          });

          if (!res.ok) {
            hooks?.onImageDownloadSkip?.(`${profile.name}: status ${res.status}`, candidateUrl);
            continue;
          }

          const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
          if (!contentType.startsWith("image/")) {
            hooks?.onImageDownloadSkip?.(
              `${profile.name}: content-type ${contentType || "unknown"}`,
              candidateUrl,
            );
            continue;
          }

          const contentLen = res.headers.get("content-length");
          if (contentLen) {
            const n = Number(contentLen);
            if (Number.isFinite(n) && n > MAX_IMAGE_DOWNLOAD_BYTES) {
              hooks?.onImageDownloadSkip?.(
                `${profile.name}: content-length ${n} exceeds cap`,
                candidateUrl,
              );
              continue;
            }
          }

          const bytes = await res.arrayBuffer();
          if (bytes.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
            hooks?.onImageDownloadSkip?.(
              `${profile.name}: body ${bytes.byteLength} exceeds cap`,
              candidateUrl,
            );
            continue;
          }
          const ext = inferExt(contentType);
          const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filePath = path.join(outputDir, fileName);
          const buffer = Buffer.from(bytes);
          if (saveFiles) {
            await writeFile(filePath, buffer);
          }

          return { savedPath: saveFiles ? filePath : null };
        } catch {
          hooks?.onImageDownloadSkip?.(`${profile.name}: network error`, candidateUrl);
        }
      }
    }

    return null;
  });

  return {
    savedPaths: perUrl.flatMap((item) => (item?.savedPath ? [item.savedPath] : [])),
  };
}

const KNOWN_MIME_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

export function inferMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return KNOWN_MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Uploads a local image file to the Gemini `/upload/` endpoint and returns an
 * `ImageAttachment` with the contribution token path, MIME type, and filename.
 *
 * The upload follows the two-step resumable-upload protocol captured in
 * Gemini DevTools traffic:
 *   1. POST `/_/upload/BardChatUi/data?upload_id=…&upload_protocol=resumable`
 *      with `X-Goog-Upload-Protocol: resumable` + `X-Goog-Upload-Command: start`
 *   2. POST same URL with `X-Goog-Upload-Command: upload, finalize` + raw bytes
 *
 * On success the finalize response body contains a JSON fragment with the
 * `/contrib_service/ttl_1d/<token>` path we embed in the StreamGenerate payload.
 */
async function optimizeImageForUpload(
  filePath: string,
  rawBytes: Buffer,
  rawMime: string,
): Promise<{ fileBytes: Buffer; mimeType: string; fileName: string }> {
  const baseName = path.basename(filePath);
  // Only optimize files > 1.2 MB and non-vector / non-animated images
  if (rawBytes.length < 1_200_000 || rawMime === "image/svg+xml" || rawMime === "image/gif") {
    return { fileBytes: rawBytes, mimeType: rawMime, fileName: baseName };
  }

  try {
    const { spawn } = await import("node:child_process");
    const pythonCode =
      "import sys, io\n" +
      "from PIL import Image\n" +
      "data = sys.stdin.buffer.read()\n" +
      "im = Image.open(io.BytesIO(data))\n" +
      "if im.mode in ('RGBA', 'P') and '" +
      rawMime +
      "' != 'image/png':\n" +
      "    im = im.convert('RGB')\n" +
      "max_dim = 1600\n" +
      "if max(im.size) > max_dim:\n" +
      "    im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)\n" +
      "out = io.BytesIO()\n" +
      "im.save(out, format='JPEG', quality=85, optimize=True)\n" +
      "sys.stdout.buffer.write(out.getvalue())\n";

    const child = spawn("python", ["-c", pythonCode], {
      stdio: ["pipe", "pipe", "ignore"],
    });

    child.stdin.end(rawBytes);

    const outChunks: Buffer[] = [];
    for await (const chunk of child.stdout) {
      outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const compressed = Buffer.concat(outChunks);
    if (compressed.length > 0 && compressed.length < rawBytes.length) {
      const parsed = path.parse(baseName);
      return { fileBytes: compressed, mimeType: "image/jpeg", fileName: `${parsed.name}.jpg` };
    }
  } catch {
    // If python or PIL is unavailable or fails, gracefully return original bytes
  }

  return { fileBytes: rawBytes, mimeType: rawMime, fileName: baseName };
}

export async function uploadImageToGemini(
  config: GemaiConfig,
  filePath: string,
): Promise<ImageAttachment> {
  const rawBytes = await readFile(filePath);
  const rawMime = inferMimeTypeFromPath(filePath);
  const { fileBytes, mimeType, fileName } = await optimizeImageForUpload(
    filePath,
    rawBytes,
    rawMime,
  );
  const fileSize = fileBytes.length;

  // Shared headers matching the real browser upload traffic to push.clients6.google.com
  const baseHeaders: Record<string, string> = {
    accept: "*/*",
    "accept-language": config.context.acceptLanguage,
    cookie: config.auth.cookies,
    origin: "https://gemini.google.com",
    priority: "u=1, i",
    "push-id": "feeds/mcudyrk2a4khkz",
    referer: "https://gemini.google.com/",
    ...buildSecChUaHeaders(config),
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": config.context.userAgent,
    "x-browser-channel": config.context.browserChannel,
    "x-browser-copyright": config.context.browserCopyright,
    "x-browser-validation": config.context.browserValidation,
    "x-browser-year": "2026",
    "x-client-data": config.context.clientData,
    "x-tenant-id": "bard-storage",
  };

  // Step 1 — POST to push.clients6.google.com/upload/ with x-goog-upload-command: start
  // The server returns an x-goog-upload-url header containing the upload_id for step 2.
  const startUrl = "https://push.clients6.google.com/upload/?upload_protocol=resumable";
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-goog-upload-command": "start",
      "x-goog-upload-header-content-length": String(fileSize),
      "x-goog-upload-protocol": "resumable",
    },
    body: `File name: ${fileName}`,
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`Gemini upload start failed (${startRes.status}): ${redactErrorBody(body)}`);
  }

  // The server echoes back the full upload URL including server-assigned upload_id
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  await startRes.arrayBuffer(); // drain body

  if (!uploadUrl) {
    throw new Error("Gemini upload start did not return x-goog-upload-url");
  }

  // Step 2 — POST raw bytes to the server-provided upload URL
  const finalRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      "x-goog-upload-command": "upload, finalize",
      "x-goog-upload-offset": "0",
    },
    body: fileBytes,
  });

  const finalBody = await finalRes.text();

  if (!finalRes.ok) {
    throw new Error(
      `Gemini upload finalize failed (${finalRes.status}): ${redactErrorBody(finalBody)}`,
    );
  }

  // The response contains a token path of the form /contrib_service/ttl_1d/<token>
  const tokenMatch = /\/contrib_service\/ttl_\d+[dhms]?\/([A-Za-z0-9_-]+)/.exec(finalBody);
  if (!tokenMatch) {
    throw new Error(
      `Could not extract contrib token from upload response: ${redactErrorBody(finalBody)}`,
    );
  }

  const tokenPath = tokenMatch[0];
  return { tokenPath, mimeType, fileName };
}
