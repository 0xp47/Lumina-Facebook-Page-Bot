import { Client } from "undici";
import type { ConversationState, GemaiConfig, ImageAttachment, Result } from "./types.js";
import { fail, ok } from "./types.js";

/** Builds `/assistant.lamda.BardFrontendService/StreamGenerate` URL + query string. */
export function buildStreamGeneratePath(config: GemaiConfig): string {
  return (
    `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate` +
    `?source-path=${encodeURIComponent(config.context.sourcePath)}` +
    `&bl=${encodeURIComponent(config.context.blParam)}` +
    `&f.sid=${encodeURIComponent(config.auth.fSid)}` +
    `&hl=${encodeURIComponent(config.context.language)}` +
    `&_reqid=${encodeURIComponent(config.context.reqId ?? "")}` +
    `&rt=c`
  );
}

/** First semver digit from `CHROME_FULL_VERSION` / UA hints. */
export function chromeMajorFromFullVersion(full: string): string {
  const m = /^(\d+)/.exec(full.trim());
  return m?.[1] ?? "147";
}

/** Chrome client-hint headers aligned with Gemini web requests. */
export function buildSecChUaHeaders(config: GemaiConfig): Record<string, string> {
  const full = config.context.chromeFullVersion;
  const major = chromeMajorFromFullVersion(full);
  const plat = config.context.secChUaPlatform;
  const platVer = config.context.secChUaPlatformVersion;
  return {
    "sec-ch-ua": `"Google Chrome";v="${major}", "Not.A/Brand";v="8", "Chromium";v="${major}"`,
    "sec-ch-ua-arch": '"x86"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-form-factors": '"Desktop"',
    "sec-ch-ua-full-version": `"${full}"`,
    "sec-ch-ua-full-version-list": `"Google Chrome";v="${full}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${full}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": '""',
    "sec-ch-ua-platform": JSON.stringify(plat),
    "sec-ch-ua-platform-version": JSON.stringify(platVer),
    "sec-ch-ua-wow64": "?0",
  };
}

const baseHeaders = (config: GemaiConfig): Record<string, string> => ({
  accept: "*/*",
  "accept-language": config.context.acceptLanguage,
  cookie: config.auth.cookies,
  origin: "https://gemini.google.com",
  priority: "u=1, i",
  referer: "https://gemini.google.com/",
  ...buildSecChUaHeaders(config),
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "user-agent": config.context.userAgent,
  "x-browser-channel": config.context.browserChannel,
  "x-browser-copyright": config.context.browserCopyright,
  "x-browser-validation": config.context.browserValidation,
  "x-browser-year": "2026",
  "x-client-data": config.context.clientData,
});

/** Headers for `StreamGenerate` POST bodies returned by {@link buildPayload}. */
export function buildStreamHeaders(config: GemaiConfig): Record<string, string> {
  return {
    ...baseHeaders(config),
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "sec-fetch-site": "same-origin",
    "x-goog-ext-525001261-jspb": `[1,null,null,null,"${config.context.sessionFingerprint}",null,null,0,[4],null,null,1,null,null,${config.context.ext525001261Tail}]`,
    "x-goog-ext-525005358-jspb": `["${config.context.requestUuid}",1]`,
    "x-goog-ext-73010989-jspb": "[0]",
    "x-goog-ext-73010990-jspb": "[0]",
    "x-same-domain": "1",
  };
}

/** `/batchexecute` query builder (`rpcids` from `config.keepalive`). */
export function buildBatchexecutePath(config: GemaiConfig): string {
  const rpc = config.keepalive?.rpcId ?? "aPya6c";
  return (
    `/_/BardChatUi/data/batchexecute?rpcids=${encodeURIComponent(rpc)}` +
    `&source-path=${encodeURIComponent(config.context.sourcePath)}` +
    `&bl=${encodeURIComponent(config.context.blParam)}` +
    `&f.sid=${encodeURIComponent(config.auth.fSid)}` +
    `&hl=${encodeURIComponent(config.context.language)}` +
    `&_reqid=${encodeURIComponent(config.context.reqId ?? "")}` +
    `&rt=c`
  );
}

/** URL-encoded `f.req` body for keepalive POSTs (browser capture or synthetic RPC triple). */
export function buildBatchexecuteKeepaliveBody(config: GemaiConfig): string {
  const ka = config.keepalive;
  let fReqValue: string;

  if (ka?.fReqOuterJson?.trim()) {
    fReqValue = ka.fReqOuterJson.trim();
  } else {
    const rpc = ka?.rpcId ?? "aPya6c";
    const inner = ka?.innerPayloadJson ?? "[]";
    try {
      JSON.parse(inner);
    } catch {
      throw new Error("KEEPALIVE_INNER_PAYLOAD must be valid JSON text");
    }
    fReqValue = JSON.stringify([[[rpc, inner, null, "generic"]]]);
  }

  const params = new URLSearchParams();
  params.set("f.req", fReqValue);
  params.set("at", config.auth.atToken);
  return `${params.toString()}&`;
}

/** Headers for `/batchexecute` keepalive-only POSTs. */
export function buildBatchexecuteHeaders(config: GemaiConfig): Record<string, string> {
  const goog525Raw = config.keepalive?.googExt525001261Jspb?.trim();
  const goog525 =
    goog525Raw && goog525Raw.length > 0
      ? goog525Raw
      : `[1,null,null,null,"${config.context.sessionFingerprint}",null,null,null,[4],null,null,null,null,null,1]`;

  return {
    ...baseHeaders(config),
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "sec-fetch-site": "same-origin",
    "x-goog-ext-525001261-jspb": goog525,
    "x-goog-ext-73010989-jspb": "[0]",
    "x-same-domain": "1",
  };
}

/** Sends one warm-session ping using configured credentials + keepalive payload. */
export async function runBatchexecuteKeepalive(
  config: GemaiConfig,
): Promise<Result<{ statusCode: number; rawSize: number }>> {
  const requestConfig: GemaiConfig = {
    ...config,
    context: {
      ...config.context,
      reqId: String(Math.floor(1_000_000 + Math.random() * 9_000_000)),
    },
  };

  const requestPath = buildBatchexecutePath(requestConfig);
  const requestBody = buildBatchexecuteKeepaliveBody(requestConfig);
  const client = new Client("https://gemini.google.com", {
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    pipelining: 1,
    connect: { rejectUnauthorized: true },
  });

  try {
    const { statusCode, body } = await client.request({
      method: "POST",
      path: requestPath,
      headers: buildBatchexecuteHeaders(requestConfig),
      body: requestBody,
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });

    const rawBuffer = await readStreamWithTimeouts(
      body,
      15_000,
      45_000,
      () => undefined,
      () => undefined,
    );
    const raw = rawBuffer.toString("utf-8");

    if (statusCode !== 200) {
      return fail(new Error(`batchexecute keepalive failed (${statusCode}): ${raw.slice(0, 500)}`));
    }
    return ok({ statusCode, rawSize: raw.length });
  } catch (err) {
    return fail(err instanceof Error ? err : new Error(String(err)));
  } finally {
    await client.close();
  }
}

/** Headers tuned for CDN/lh3 GETs mirroring Gemini tab behavior. */
export function buildImageHeaders(config: GemaiConfig): Record<string, string> {
  return {
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "accept-language": config.context.acceptLanguage,
    cookie: config.auth.cookies,
    referer: "https://gemini.google.com/",
    ...buildSecChUaHeaders(config),
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "sec-fetch-storage-access": "active",
    "user-agent": config.context.userAgent,
  };
}

/** Builds URL-encoded `f.req` matching Gemini web's StreamGenerate envelope. */
export function buildPayload(
  config: GemaiConfig,
  prompt: string,
  conversation?: ConversationState,
  imageAttachment?: ImageAttachment,
): string {
  const activeConversation = conversation ?? config.conversation ?? {};

  // When an image is attached the first slot in the inner array encodes it as:
  // [prompt, 0, null, [[[tokenPath, 1, null, mimeType], fileName]]]
  // This matches the f.req shape captured in Gemini DevTools when a file is attached.
  const promptSlot = imageAttachment
    ? [
        prompt,
        0,
        null,
        [
          [
            [imageAttachment.tokenPath, 1, null, imageAttachment.mimeType],
            imageAttachment.fileName,
          ],
        ],
      ]
    : [prompt, 0, null, null, null, null, 0];

  const inner = JSON.stringify([
    promptSlot,
    [config.context.language],
    [
      activeConversation.conversationId ?? "",
      activeConversation.responseId ?? "",
      activeConversation.choiceId ?? "",
      null,
      null,
      null,
      null,
      null,
      null,
      "",
    ],
    config.context.requestBlob ?? null,
    config.context.requestHash ?? null,
    null,
    [1],
    1,
    null,
    null,
    1,
    0,
    null,
    null,
    null,
    null,
    null,
    [[0]],
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    1,
    null,
    null,
    [4],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [2],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    null,
    null,
    null,
    config.context.requestUuid,
    null,
    [],
    null,
    null,
    null,
    null,
    null,
    null,
    2,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    1,
  ]);

  const outer = JSON.stringify([null, inner]);
  const params = new URLSearchParams();
  params.set("f.req", outer);
  params.set("at", config.auth.atToken);
  return `${params.toString()}&`;
}

/** Splits Gemini's length-prefixed streaming blob into JSON fragments. */
export function parseStreamChunks(raw: string): unknown[] {
  const results: unknown[] = [];
  const normalized = raw.replace(/^\)\]\}'\s*/, "");
  const marker = /\n?\d+\n/g;
  const matches = [...normalized.matchAll(marker)];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    if (!current.index && current.index !== 0) continue;

    const chunkStart = current.index + current[0].length;
    const chunkEnd = next?.index ?? normalized.length;
    const chunk = normalized.slice(chunkStart, chunkEnd).replace(/\s+$/, "");
    if (!chunk) continue;

    try {
      results.push(JSON.parse(chunk));
    } catch {
      results.push(chunk);
    }
  }

  return results;
}

/** Consumes an Undici body with idle + wall-clock guards (partial streams allowed). */
export async function readStreamWithTimeouts(
  body: AsyncIterable<Uint8Array>,
  idleTimeoutMs: number,
  maxDurationMs: number,
  onIdle?: (idleMs: number) => void,
  onMax?: (maxMs: number) => void,
  onChunkBuffer?: (chunk: Buffer) => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const iterator = body[Symbol.asyncIterator]();

  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let maxFired = false;
  const maxPromise = new Promise<"max">((resolve) => {
    maxTimer = setTimeout(() => {
      maxFired = true;
      resolve("max");
    }, maxDurationMs);
  });

  try {
    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idlePromise = new Promise<"idle">((resolve) => {
        idleTimer = setTimeout(() => resolve("idle"), idleTimeoutMs);
      });

      const result = await Promise.race([iterator.next(), idlePromise, maxPromise]);
      clearTimeout(idleTimer);

      if (result === "max") {
        onMax?.(maxDurationMs);
        break;
      }

      if (result === "idle") {
        onIdle?.(idleTimeoutMs);
        break;
      }

      if (result.done) break;
      const buf = Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value);
      chunks.push(buf);
      onChunkBuffer?.(buf);

      if (maxFired) {
        onMax?.(maxDurationMs);
        break;
      }
    }
  } finally {
    clearTimeout(maxTimer);
    const destroyable = body as unknown as { destroy?: () => void };
    if (typeof destroyable.destroy === "function") destroyable.destroy();
  }

  return Buffer.concat(chunks);
}
