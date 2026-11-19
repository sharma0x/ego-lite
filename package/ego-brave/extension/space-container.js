// What holds a Space's tabs. In Brave and Chrome it is a tab group. Opera
// accepts chrome.tabs.group() but keeps no group (tabGroups.get() rejects the
// id it just returned), so there a Space is its own window instead: the Space
// stores `windowId` and no `groupId`. Every other module goes through these
// helpers, so the two kinds behave the same to the CLI.

/** True when the Space is held by a window rather than a tab group. */
export function isWindowSpace(space) {
  return space.groupId == null && space.windowId != null;
}

/**
 * Puts the first tab of a new window into a container. Returns the fields to
 * store on the Space: { groupId } where tab groups work, { windowId } where not.
 */
export async function createContainer(window) {
  const groupId = await chrome.tabs
    .group({
      tabIds: [window.tabs[0].id],
      createProperties: { windowId: window.id },
    })
    .catch(() => undefined);
  const group =
    groupId === undefined
      ? undefined
      : await chrome.tabGroups.get(groupId).catch(() => undefined);
  return group ? { groupId } : { windowId: window.id };
}

/** { windowId } of the live container, or undefined once it is gone. */
export async function liveContainer(space) {
  if (isWindowSpace(space)) {
    const window = await chrome.windows
      .get(space.windowId)
      .catch(() => undefined);
    return window && { windowId: window.id };
  }
  const group = await chrome.tabGroups
    .get(space.groupId)
    .catch(() => undefined);
  return group && { windowId: group.windowId };
}

export function tabsOf(space) {
  return chrome.tabs.query(
    isWindowSpace(space)
      ? { windowId: space.windowId }
      : { groupId: space.groupId },
  );
}

export function holdsTab(space, tab) {
  return isWindowSpace(space)
    ? tab.windowId === space.windowId
    : tab.groupId === space.groupId;
}

/** Adds a tab already created in the container's window. */
export async function addTab(space, tabId) {
  if (!isWindowSpace(space))
    await chrome.tabs.group({ groupId: space.groupId, tabIds: [tabId] });
}

export async function closeContainer(space, container) {
  if (space.ownsWindow || isWindowSpace(space)) {
    await chrome.windows.remove(container.windowId);
    return;
  }
  const tabs = await tabsOf(space);
  await chrome.tabs.remove(tabs.map((tab) => tab.id));
}

/** Titles the group; a window Space has no title to set. */
export async function labelContainer(space, title, color) {
  if (isWindowSpace(space)) return;
  await chrome.tabGroups.update(space.groupId, { title, color });
}
