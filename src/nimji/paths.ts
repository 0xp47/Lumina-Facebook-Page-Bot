import os from "node:os";
import path from "node:path";

/** Default `$HOME` subdirectory when neither `NIMJI_HOME` nor `GEMAI_HOME` is set. */
export const APP_HOME_DIRNAME = ".nimji";

/** Persistent app directory for sessions / keepalive files. */
export function resolveAppHomeDir(): string {
  const raw = process.env.NIMJI_HOME ?? process.env.GEMAI_HOME;
  return raw ? path.resolve(raw) : path.resolve(os.homedir(), APP_HOME_DIRNAME);
}
