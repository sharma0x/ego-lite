import { errorResult } from "./space-registry.js";
import {
  tabIdForTarget,
  targetIdsByTab,
  waitForTargetId,
} from "./target-map.js";

/**
 * The tabs inside one Space. "Active" is tracked per Space: in a Space's own
 * window the tab is also selected, but focus never moves, and in a claimed
 * user group the user's selected tab is left alone.
 */
export class SpaceTabs {
  #registry;
  #store;

  constructor(registry, store) {
    this.#registry = registry;
    this.#store = store;
  }

  async list({ spaceId }) {
    const resolved = await this.#registry.resolve(spaceId);
    if (resolved.error_code) return resolved;
    return { tabs: await describeGroupTabs(resolved.space.groupId) };
  }

  async create({ spaceId, url }) {
    const resolved = await this.#registry.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const { space, group } = resolved;
    const tab = await chrome.tabs.create({
      windowId: group.windowId,
      url,
      active: space.ownsWindow,
    });
    await chrome.tabs.group({ groupId: space.groupId, tabIds: [tab.id] });
    const targetId = await waitForTargetId(tab.id);
    if (!targetId)
      return errorResult(
        "EGO_OPERATION_FAILED",
        `No DevTools target appeared for tab ${tab.id}`,
      );
    await this.#store.update(spaceId, { activeTargetId: targetId });
    return {
      targetId,
      index: tab.index,
      url,
      title: tab.title ?? "",
      active: true,
    };
  }

  async activate({ spaceId, targetId }) {
    const resolved = await this.#registry.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const tabId = await tabIdForTarget(targetId);
    const tab =
      tabId === undefined
        ? undefined
        : await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.groupId !== resolved.space.groupId) {
      return errorResult(
        "EGO_OPERATION_FAILED",
        `Target ${targetId} is not in task space ${spaceId}`,
      );
    }
    if (resolved.space.ownsWindow)
      await chrome.tabs.update(tabId, { active: true });
    await this.#store.update(spaceId, { activeTargetId: targetId });
    return {};
  }

  async activeTarget({ spaceId }) {
    const resolved = await this.#registry.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const tabs = await describeGroupTabs(resolved.space.groupId);
    const chosen =
      tabs.find((tab) => tab.targetId === resolved.space.activeTargetId) ??
      tabs.find((tab) => tab.active) ??
      tabs.at(-1);
    if (!chosen)
      return errorResult(
        "EGO_WEB_CONTENTS_UNAVAILABLE",
        `Task space ${spaceId} has no tabs`,
      );
    return { targetId: chosen.targetId };
  }
}

async function describeGroupTabs(groupId) {
  const [tabs, targetIds] = await Promise.all([
    chrome.tabs.query({ groupId }),
    targetIdsByTab(),
  ]);
  return tabs
    .sort((left, right) => left.index - right.index)
    .map((tab, index) => ({
      index,
      targetId: targetIds.get(tab.id),
      url: tab.url || tab.pendingUrl || "",
      title: tab.title ?? "",
      active: tab.active,
    }))
    .filter((tab) => tab.targetId);
}
