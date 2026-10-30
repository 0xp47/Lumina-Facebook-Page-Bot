import path from "node:path";
import { resolveAppHomeDir } from "../paths.js";
import { createSessionStore, loadConfigFromEnv, validateConfig } from "../index.js";
import { runBatchexecuteKeepalive } from "../transport.js";

const toPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CLI/daemon loop around `runBatchexecuteKeepalive`. Honors `KEEPALIVE_INTERVAL_MINUTES`,
 * `KEEPALIVE_BASE_DIR`, `KEEPALIVE_SESSION_FILE`, and other `KEEPALIVE_*` / auth env vars.
 */
export async function runKeepalive(options?: { once?: boolean; quiet?: boolean }): Promise<void> {
  const config = loadConfigFromEnv();
  const checked = validateConfig(config);
  if (!checked.ok) throw checked.error;

  const intervalMinutes = toPositiveInt(process.env.KEEPALIVE_INTERVAL_MINUTES, 10);
  const intervalMs = intervalMinutes * 60_000;
  const baseDir = process.env.KEEPALIVE_BASE_DIR
    ? path.resolve(process.env.KEEPALIVE_BASE_DIR)
    : resolveAppHomeDir();
  const sessionFile = process.env.KEEPALIVE_SESSION_FILE ?? "keepalive-session.json";
  const sessionPath = path.resolve(baseDir, sessionFile);
  const once = options?.once ?? process.argv.includes("--once");
  const quiet = options?.quiet ?? process.argv.includes("--daemon");

  const store = createSessionStore(sessionPath);
  const conversation = await store.load();

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  if (!quiet) {
    console.log(
      `[keepalive] batchexecute (${checked.value.keepalive?.rpcId ?? "aPya6c"}) every ${intervalMinutes} minute(s)`,
    );
    console.log(`[keepalive] session file: ${sessionFile}`);
    if (once) console.log("[keepalive] mode: once");
  }

  let cycle = 0;
  while (!stopping) {
    cycle += 1;
    const startedAt = new Date().toISOString();
    const result = await runBatchexecuteKeepalive(checked.value);

    if (result.ok) {
      await store.save(conversation);
      if (!quiet) {
        console.log(
          `[keepalive] #${cycle} ok @ ${startedAt} | status=${result.value.statusCode} | bytes=${result.value.rawSize}`,
        );
      }
    } else if (!quiet) {
      console.log(`[keepalive] #${cycle} fail @ ${startedAt} | ${result.error.message}`);
    }

    if (once || stopping) break;
    await sleep(intervalMs);
  }

  await store.save(conversation);
  if (!quiet) console.log("[keepalive] exited.");
}

runKeepalive().catch((error) => {
  console.error("[keepalive] fatal:", error);
  process.exit(1);
});
