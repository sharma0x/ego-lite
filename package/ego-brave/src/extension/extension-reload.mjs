const BRIDGE_PATH = "/offscreen.html";
const POLL_MS = 250;

/**
 * Reloads the Agent Spaces extension in one profile (browser context), so it
 * runs the files on disk. Chromium keeps an unpacked extension's service
 * worker cached across restarts and even across version changes; only a
 * reload (the Reload button in the extensions page) replaces it. Every
 * profile runs its own copy, so each one needs its own reload.
 *
 * @param {import("../cdp/cdp-client.mjs").CdpClient} client browser-level
 * @param {string} browserContextId the profile's context
 * @returns {Promise<{ targetId: string, browserContextId: string }>} the new
 *   bridge, once the reloaded extension has it back
 */
export async function reloadExtensionIn(
  client,
  browserContextId,
  { timeoutMs = 15_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const [bridge] = await bridgesIn(client, browserContextId);
  if (!bridge)
    throw new Error(`no Agent Spaces bridge in context ${browserContextId}`);
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
  const fresh = await waitFor(deadline, async () =>
    (await bridgesIn(client, browserContextId)).find(
      (candidate) => candidate.targetId !== bridge.targetId,
    ),
  );
  if (!fresh)
    throw new Error(
      "the Agent Spaces extension did not come back after a reload",
    );
  return { targetId: fresh.targetId, browserContextId };
}

async function bridgesIn(client, browserContextId) {
  const { targetInfos } = await client.call("Target.getTargets");
  return targetInfos
    .filter(
      (target) =>
        target.browserContextId === browserContextId &&
        /^(chrome-)?extension:\/\//.test(target.url) &&
        target.url.endsWith(BRIDGE_PATH),
    )
    .map((target) => ({
      targetId: target.targetId,
      base: target.url.slice(0, -BRIDGE_PATH.length),
    }));
}

/** The extension's worker in the same profile, woken through its bridge when idle. */
async function serviceWorkerOf(client, bridge, deadline) {
  const find = async () => {
    const { targetInfos } = await client.call("Target.getTargets");
    const bridgeTarget = targetInfos.find(
      (target) => target.targetId === bridge.targetId,
    );
    return targetInfos.find(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith(bridge.base) &&
        target.browserContextId === bridgeTarget?.browserContextId,
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
