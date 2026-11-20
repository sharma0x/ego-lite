import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { BROWSER, stageExtension, stagedExtensionIsStale } from "./browser.mjs";
import { platformFor } from "./platform.mjs";

const APP_NAME = BROWSER.app;
const DEBUGGING_PORT = BROWSER.port;
const QUIT_TIMEOUT_MS = 20_000;
const FORCE_QUIT_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 500;

/**
 * Browser flags for an agent session. Without the three --disable-* flags,
 * renderers in windows behind other apps are throttled and CDP calls stall
 * for seconds or time out.
 */
export function launchFlags(browser = BROWSER, profileDirectory = "Default") {
  return [
    `--remote-debugging-port=${browser.port}`,
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    ...(browser.customUserDataDir
      ? [`--user-data-dir=${browser.userDataDir}`, "--no-first-run"]
      : []),
    ...browser.extraFlags,
    `--profile-directory=${profileDirectory}`,
  ];
}

/**
 * Makes sure the browser runs with remote debugging, started the way the OS
 * expects (platform.mjs).
 *
 * @param {{ restart?: boolean, profileDirectory?: string }} options restart
 *   permits quitting a browser that runs without debugging (tabs are restored).
 * @returns {Promise<number>} exit code
 */
export async function runLaunch({
  restart = false,
  profileDirectory = "Default",
  output = process.stdout,
  platform = platformFor(BROWSER),
} = {}) {
  // A dedicated agent browser (its own user data dir) is the agent's alone,
  // so --restart restarts it even when it is reachable, e.g. to load an
  // updated extension. The user's own browser is only restarted to add
  // debugging.
  const restartReachable = restart && BROWSER.customUserDataDir;
  if (!restartReachable && (await debuggingReady())) {
    output.write(
      `ok   ${APP_NAME} is already running with remote debugging on port ${DEBUGGING_PORT}\n`,
    );
    if (stagedExtensionIsStale(BROWSER))
      output.write(
        `note the Agent Spaces extension changed; run \`${BROWSER.command} launch --restart\` to load it (tabs are restored)\n`,
      );
    return 0;
  }
  let restarted = false;
  if (await platform.isRunning()) {
    if (!restart) {
      output.write(
        `${APP_NAME} is running without remote debugging. Re-run with --restart to quit it ` +
          "(open windows and tabs are restored) and start it again with debugging.\n",
      );
      return 3;
    }
    await quit(platform);
    restarted = true;
  }
  // Profiles reload onto a changed copy on first use (BridgeDirectory).
  stageExtension(BROWSER);
  await platform.start([
    ...launchFlags(BROWSER, profileDirectory),
    ...(restarted ? ["--restore-last-session"] : []),
  ]);
  await waitFor(
    debuggingReady,
    START_TIMEOUT_MS,
    `${APP_NAME} did not open port ${DEBUGGING_PORT}. ` +
      `If this is a managed (company) browser, run \`${BROWSER.command} doctor\`: ` +
      "a policy may forbid remote debugging.",
  );
  output.write(
    `ok   ${APP_NAME} started with remote debugging on port ${DEBUGGING_PORT} (profile ${profileDirectory})\n`,
  );
  return 0;
}

/** Closes windows first so the session is saved; then clears leftover background processes. */
async function quit(platform) {
  await platform.quit();
  const closed = await waitUntil(
    async () => !(await platform.isRunning()),
    QUIT_TIMEOUT_MS,
  );
  if (closed) return;
  await platform.forceQuit();
  if (
    !(await waitUntil(
      async () => !(await platform.isRunning()),
      FORCE_QUIT_TIMEOUT_MS,
    ))
  )
    throw new Error(`${APP_NAME} did not quit; quit it yourself and retry`);
}

async function debuggingReady() {
  let channel;
  try {
    channel = await CdpChannel.connect(`http://127.0.0.1:${DEBUGGING_PORT}`);
    await new CdpClient(channel).call(
      "Browser.getVersion",
      {},
      undefined,
      3000,
    );
    return true;
  } catch {
    return false;
  } finally {
    channel?.close();
  }
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
  return false;
}

async function waitFor(condition, timeoutMs, failure) {
  if (!(await waitUntil(condition, timeoutMs))) throw new Error(failure);
}
