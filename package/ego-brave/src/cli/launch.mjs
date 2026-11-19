import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { BROWSER } from "./browser.mjs";

const run = promisify(execFile);

const APP_NAME = BROWSER.app;
const DEBUGGING_PORT = BROWSER.port;
// Without the three --disable-* flags, renderers in windows behind other apps
// are throttled and CDP calls stall for seconds or time out.
const LAUNCH_FLAGS = [
  `--remote-debugging-port=${DEBUGGING_PORT}`,
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
  ...BROWSER.extraFlags,
];
// A browser on its own user data dir runs as a second instance beside the
// user's everyday one: open a new instance (-n) and find it by that dir.
const OPEN_ARGS = BROWSER.customUserDataDir ? ["-n", "-a"] : ["-a"];
const QUIT_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 500;

/**
 * Makes sure the browser (Brave, or Opera for ego-opera) runs with remote debugging, started through LaunchServices
 * (`open -a`). Starting the binary directly leaves it unregistered with macOS:
 * no keyboard focus, no Dock entry and no Quit menu.
 *
 * @param {{ restart?: boolean, profileDirectory?: string }} options restart
 *   permits quitting a Brave that runs without debugging (tabs are restored).
 * @returns {Promise<number>} exit code
 */
export async function runLaunch({
  restart = false,
  profileDirectory = "Default",
  output = process.stdout,
} = {}) {
  if (await debuggingReady()) {
    output.write(
      `ok   ${APP_NAME} is already running with remote debugging on port ${DEBUGGING_PORT}\n`,
    );
    return 0;
  }
  if (await isRunning()) {
    if (!restart) {
      output.write(
        `${APP_NAME} is running without remote debugging. Re-run with --restart to quit it ` +
          "(open windows and tabs are restored) and start it again with debugging.\n",
      );
      return 3;
    }
    await quit();
  }
  await run("open", [
    ...OPEN_ARGS,
    APP_NAME,
    "--args",
    ...LAUNCH_FLAGS,
    `--profile-directory=${profileDirectory}`,
  ]);
  await waitFor(
    debuggingReady,
    START_TIMEOUT_MS,
    `${APP_NAME} did not open port ${DEBUGGING_PORT}`,
  );
  output.write(
    `ok   ${APP_NAME} started with remote debugging (profile ${profileDirectory})\n`,
  );
  return 0;
}

export function launchCommand() {
  return [
    "open",
    ...OPEN_ARGS,
    JSON.stringify(APP_NAME),
    "--args",
    ...LAUNCH_FLAGS,
    "--profile-directory=Default",
  ].join(" ");
}

async function quit() {
  if (BROWSER.customUserDataDir)
    await run("pkill", ["-f", `--user-data-dir=${BROWSER.userDataDir}`]).catch(
      () => {},
    );
  else
    await run("osascript", [
      "-e",
      `tell application ${JSON.stringify(APP_NAME)} to quit`,
    ]).catch(() => {});
  await waitFor(
    async () => !(await isRunning()),
    QUIT_TIMEOUT_MS,
    `${APP_NAME} did not quit; quit it yourself and retry`,
  );
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

async function isRunning() {
  try {
    await run(
      "pgrep",
      BROWSER.customUserDataDir
        ? ["-f", `--user-data-dir=${BROWSER.userDataDir}`]
        : ["-x", APP_NAME],
    );
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition, timeoutMs, failure) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
  throw new Error(failure);
}
