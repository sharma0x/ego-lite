import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rewriteUsageGuide } from "./usage-guide.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HARNESS_OUT = resolve(PACKAGE_ROOT, "../ego-browser/dist/out");

export function harnessBundlePath() {
  return process.env.EGO_BRAVE_SDK_PATH || join(HARNESS_OUT, "index.js");
}

export function assertHarnessBuilt() {
  if (existsSync(harnessBundlePath())) return;
  throw new Error(
    `ego-browser harness is not built at ${harnessBundlePath()}. Run: npm --prefix ${PACKAGE_ROOT} run build:harness`,
  );
}

/**
 * Load the unmodified harness and run one script. globalThis.ego must already
 * be installed: importing the bundle runs installEgoSdk() against it.
 */
export async function runHarnessScript(code, { browserProcessId }) {
  pinRuntimeInstance(browserProcessId);
  const harness = await import(pathToFileURL(harnessBundlePath()).href);
  return harness.runMain({ argv: [], stdinText: code });
}

/**
 * The harness keys its persisted Page ledger by runtimeInstanceId(), which is
 * `process.ppid` because under Ego Lite the CLI's parent is the browser host.
 * Here the parent is whatever shell ran us, so each round would look like a
 * new browser and forget p1. The Brave browser PID has the intended meaning:
 * stable for one browser run, new after a restart (when target ids change).
 */
function pinRuntimeInstance(browserProcessId) {
  // process.ppid is a native interceptor that ignores writes and redefinition
  // until it is deleted.
  delete process.ppid;
  Object.defineProperty(process, "ppid", {
    value: browserProcessId,
    configurable: true,
    enumerable: true,
  });
  if (process.ppid !== browserProcessId)
    throw new Error("could not pin the harness runtime instance id");
}

/** The harness usage guide, rewritten to the ego-brave command. */
export function readUsageGuide() {
  const platformGuide = join(
    HARNESS_OUT,
    "ego-browser",
    `SKILL.${process.platform === "win32" ? "windows" : "macos"}.md`,
  );
  const guide = existsSync(platformGuide)
    ? platformGuide
    : join(HARNESS_OUT, "ego-browser", "SKILL.md");
  return rewriteUsageGuide(readFileSync(guide, "utf8"));
}
