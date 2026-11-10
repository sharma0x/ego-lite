// chrome.debugger.getTargets() reports each tab's DevTools target id, which is
// the id the harness uses in CDP. Listing targets does not attach a debugger,
// so no "is debugging this browser" bar appears.

const LOOKUP_ATTEMPTS = 30;
const LOOKUP_DELAY_MS = 100;

export async function targetIdsByTab() {
  const targets = await chrome.debugger.getTargets();
  return new Map(
    targets
      .filter((target) => target.tabId !== undefined)
      .map((target) => [target.tabId, target.id]),
  );
}

export async function tabIdForTarget(targetId) {
  const targets = await chrome.debugger.getTargets();
  return targets.find((target) => target.id === targetId)?.tabId;
}

/** A new tab's target appears shortly after chrome.tabs.create resolves. */
export async function waitForTargetId(tabId) {
  for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt += 1) {
    const targetId = (await targetIdsByTab()).get(tabId);
    if (targetId) return targetId;
    await new Promise((resolve) => setTimeout(resolve, LOOKUP_DELAY_MS));
  }
  return undefined;
}
