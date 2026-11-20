const BRIDGE_PATH = "/offscreen.html";
const POLL_MS = 250;

/**
 * Reloads every running copy of the Agent Spaces extension, so the browser
 * runs the files on disk. Chromium keeps an unpacked extension's service
 * worker cached across restarts and even across version changes; only a
 * reload (the Reload button in the extensions page) replaces it.
 *
 * Waits until each reloaded extension has its bridge (offscreen document)
 * back, so the next CLI call finds it.
 *
 * @param {import("../cdp/cdp-client.mjs").CdpClient} client browser-level
 * @param {{ waitForBridges?: boolean }} options waitForBridges: the browser
 *   just started, so give the extension time to appear first.
 * @returns {Promise<number>} how many extensions were reloaded
 */
export async function reloadExtensions(
  client,
  { timeoutMs = 15_000, waitForBridges = false } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const bridges = waitForBridges
    ? await waitFor(deadline, () => bridgeTargets(client))
    : await bridgeTargets(client);
  if (!bridges) return 0;
  for (const bridge of bridges) {
    const worker = await serviceWorkerOf(client, bridge, deadline);
    if (!worker) throw new Error(`no service worker for ${bridge.base}`);
    const sessionId = await client.session(worker.targetId);
    // The worker dies while reloading, so its reply may never come.
    void client
      .call(
        "Runtime.evaluate",
        { expression: "chrome.runtime.reload()" },
        sessionId,
        2000,
      )
      .catch(() => {});
  }
  const before = new Set(bridges.map((bridge) => bridge.targetId));
  const back = await waitFor(deadline, async () => {
    // Between unload and load there is no bridge at all.
    const now = (await bridgeTargets(client)) ?? [];
    const fresh = now.filter((bridge) => !before.has(bridge.targetId));
    return fresh.length >= bridges.length ? fresh : undefined;
  });
  if (!back)
    throw new Error(
      "the Agent Spaces extension did not come back after a reload",
    );
  return bridges.length;
}

async function bridgeTargets(client) {
  const { targetInfos } = await client.call("Target.getTargets");
  const bridges = targetInfos
    .filter(
      (target) =>
        /^(chrome-)?extension:\/\//.test(target.url) &&
        target.url.endsWith(BRIDGE_PATH),
    )
    .map((target) => ({
      targetId: target.targetId,
      base: target.url.slice(0, -BRIDGE_PATH.length),
    }));
  return bridges.length > 0 ? bridges : undefined;
}

/** The extension's worker target, waking it through its bridge when idle. */
async function serviceWorkerOf(client, bridge, deadline) {
  const find = async () => {
    const { targetInfos } = await client.call("Target.getTargets");
    return targetInfos.find(
      (target) =>
        target.type === "service_worker" && target.url.startsWith(bridge.base),
    );
  };
  const running = await find();
  if (running) return running;
  const bridgeSession = await client.session(bridge.targetId);
  await client
    .call(
      "Runtime.evaluate",
      {
        expression: `chrome.runtime.sendMessage({ channel: "ego-brave", op: "whoami", args: {} })`,
        awaitPromise: true,
      },
      bridgeSession,
    )
    .catch(() => {});
  return waitFor(deadline, find);
}

async function waitFor(deadline, probe) {
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
  return undefined;
}
