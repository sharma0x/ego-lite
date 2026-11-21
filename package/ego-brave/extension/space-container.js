// What holds a Space's tabs. Every agent Space of a profile lives in one
// shared, unfocused agent window, so the user watches all agent work in one
// place instead of a window per task. Inside it a Space is a named, coloured
// tab group. Opera accepts chrome.tabs.group() but keeps no group
// (tabGroups.get() rejects the id it just returned), so there a Space is a
// set of tabs in that window: it stores `tabIds` and no `groupId`. Every other
// module goes through these helpers, so both kinds behave the same to the CLI.

/** True when the Space is a set of tabs rather than a tab group. */
export function isTabSetSpace(space) {
  return space.groupId == null && Array.isArray(space.tabIds);
}

/** True for a Space record this version can no longer hold (old window Spaces). */
export function isObsoleteSpace(space) {
  return space.groupId == null && !Array.isArray(space.tabIds);
}

const NEW_TAB_PAGE =
  /^(?:about:blank|(?:chrome|edge|brave|opera):\/\/(?:newtab|startpage)\/?|https:\/\/ntp\.msn\.com\/.*)$/;

/**
 * Opens a tab for a new Space in the profile's agent window, creating the
 * window (unfocused) when there is none. Callers serialise this so two
 * Spaces started at once share one window.
 *
 * dedicatedBrowser: the browser runs only for agents (Edge, or Opera on its
 * own profile), so every window there is the agent's. When the agent window
 * is gone (first run, or window ids changed after a restart) the last focused
 * window becomes it, instead of a new window beside it. Never set for the
 * user's own browser, whose windows are left alone.
 *
 * @returns {Promise<{ windowId: number, tabId: number }>}
 */
export async function openAgentTab(store, { dedicatedBrowser = false } = {}) {
  const window =
    (await storedAgentWindow(store)) ??
    (dedicatedBrowser ? await lastFocusedWindow() : undefined);
  if (window) {
    await store.setAgentWindowId(window.id);
    const idle = await idleTab(window.id, await tabsOwnedBySpaces(store));
    if (idle) {
      // A Space's tabs start blank; a new-tab page left as is would look like
      // a leftover to the CLI's cleanup and the user.
      await chrome.tabs.update(idle.id, { url: "about:blank" });
      return { windowId: window.id, tabId: idle.id };
    }
    const tab = await chrome.tabs.create({
      windowId: window.id,
      url: "about:blank",
      active: await mayTakeFront(store, window.id),
    });
    return { windowId: window.id, tabId: tab.id };
  }
  const created = await chrome.windows.create({
    url: "about:blank",
    focused: false,
  });
  await store.setAgentWindowId(created.id);
  return { windowId: created.id, tabId: created.tabs[0].id };
}

/**
 * Whether a Space may select one of its tabs in this window. Agents share
 * the window, so a Space brings its tab forward only when the front tab is
 * idle (in no Space), its own, or in a finished Space; otherwise it works in
 * a background tab and agents never take the front from each other or from
 * a Space the user controls.
 */
export async function mayTakeFront(store, windowId, spaceId) {
  const [front] = await chrome.tabs.query({ windowId, active: true });
  if (!front) return true;
  const holder = (await store.all()).find((space) => holdsTab(space, front));
  return !holder || holder.id === spaceId || holder.status === "completed";
}

async function storedAgentWindow(store) {
  const storedId = await store.agentWindowId();
  return storedId == null
    ? undefined
    : chrome.windows.get(storedId).catch(() => undefined);
}

function lastFocusedWindow() {
  return chrome.windows
    .getLastFocused({ windowTypes: ["normal"] })
    .catch(() => undefined);
}

/**
 * An ungrouped blank or new-tab page in the agent window (the browser's
 * startup tab, or one a restart left), which a new Space uses instead of
 * opening another tab beside it. Tabs of tab-set Spaces are ungrouped too
 * (Opera) and start blank, so they never count as idle.
 */
async function idleTab(windowId, ownedTabIds) {
  const tabs = await chrome.tabs.query({
    windowId,
    groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
  });
  return tabs
    .filter((tab) => !ownedTabIds.has(tab.id))
    .filter((tab) => NEW_TAB_PAGE.test(tab.url || tab.pendingUrl || ""))
    .at(-1);
}

async function tabsOwnedBySpaces(store) {
  const spaces = await store.all();
  return new Set(spaces.flatMap((space) => space.tabIds ?? []));
}

function normalWindows() {
  return chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
}

/**
 * Puts a Space's first tab into a container. Returns the fields to store on
 * the Space: { groupId } where tab groups work, { tabIds } where not.
 */
export async function createContainer(windowId, tabId) {
  const groupId = await chrome.tabs
    .group({ tabIds: [tabId], createProperties: { windowId } })
    .catch(() => undefined);
  const group =
    groupId === undefined
      ? undefined
      : await chrome.tabGroups.get(groupId).catch(() => undefined);
  return group ? { groupId } : { tabIds: [tabId] };
}

/** { windowId } of the live container, or undefined once it is gone. */
export async function liveContainer(space) {
  if (isTabSetSpace(space)) {
    const [first] = await tabsOf(space);
    return first && { windowId: first.windowId };
  }
  if (isObsoleteSpace(space)) return undefined;
  const group = await chrome.tabGroups
    .get(space.groupId)
    .catch(() => undefined);
  return group && { windowId: group.windowId };
}

export async function tabsOf(space) {
  if (isTabSetSpace(space)) {
    const ids = new Set(space.tabIds);
    return (await chrome.tabs.query({})).filter((tab) => ids.has(tab.id));
  }
  if (isObsoleteSpace(space)) return [];
  return chrome.tabs.query({ groupId: space.groupId });
}

export function holdsTab(space, tab) {
  return isTabSetSpace(space)
    ? space.tabIds.includes(tab.id)
    : tab.groupId === space.groupId;
}

/**
 * Adds a tab already created in the container's window. Returns the patch to
 * store on the Space, if any.
 */
export async function addTab(space, tabId) {
  if (isTabSetSpace(space)) return { tabIds: [...space.tabIds, tabId] };
  await chrome.tabs.group({ groupId: space.groupId, tabIds: [tabId] });
  return undefined;
}

/**
 * Closes the Space's tabs; the agent window closes itself with its last tab.
 * When that window is the browser's last one, a blank tab keeps it open:
 * closing the last window quits the browser on Windows, and the next Space
 * reuses the blank tab.
 */
export async function closeContainer(space) {
  const tabs = await tabsOf(space);
  if (tabs.length === 0) return;
  const closing = new Set(tabs.map((tab) => tab.id));
  const windows = await normalWindows();
  const window = windows.find((candidate) => candidate.id === tabs[0].windowId);
  const emptiesLastWindow =
    windows.length === 1 && window?.tabs.every((tab) => closing.has(tab.id));
  if (emptiesLastWindow)
    await chrome.tabs.create({
      windowId: window.id,
      url: "about:blank",
      active: false,
    });
  await chrome.tabs.remove([...closing]);
}

/** Titles and colours the group; a tab-set Space has no group to label. */
export async function labelContainer(space, title, color) {
  if (isTabSetSpace(space) || isObsoleteSpace(space)) return;
  await chrome.tabGroups.update(space.groupId, { title, color });
}
