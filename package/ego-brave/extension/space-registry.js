import {
  closeContainer,
  createContainer,
  isObsoleteSpace,
  isTabSetSpace,
  liveContainer,
  openAgentTab,
  tabsOf,
} from "./space-container.js";

const RECENT_TAB_TITLES = 5;
const STATUS_PREFIX = /^(🤖|✋|✓)\s*/u;

export function errorResult(errorCode, message) {
  return { error: message, error_code: errorCode };
}

/**
 * Space lifecycle and ownership. A Space is a tab group (or, in browsers
 * without working tab groups, a set of tabs; see space-container.js). Agent
 * Spaces share one unfocused agent window per profile, so the agent never
 * switches the user's tabs and the user sees every task in one window; a
 * user's own tab groups are listed as user-owned Spaces they can let the
 * agent claim.
 */
export class SpaceRegistry {
  #store;
  // Serialises create() so Spaces started at once share one agent window.
  #creating = Promise.resolve();

  constructor(store) {
    this.#store = store;
  }

  /** @returns {{space, group}} or an EGO_TASK_SPACE_NOT_FOUND result; `group` is the live container ({ windowId }). */
  async resolve(spaceId) {
    const space = await this.#store.get(spaceId);
    const group = space && (await liveContainer(space));
    if (group) return { space, group };
    if (space)
      await this.#store.removeWhere((candidate) => candidate.id === spaceId);
    return errorResult(
      "EGO_TASK_SPACE_NOT_FOUND",
      `Task space not found: ${spaceId}. It was closed, by the user or ` +
        "automatically after being idle; start a new one with taskSpace(name).",
    );
  }

  async list() {
    await this.#syncWithTabGroups();
    const [spaces, profile] = await Promise.all([
      this.#store.all(),
      this.#store.profile(),
    ]);
    const profileFields = profile
      ? { profileId: profile.id, profileName: profile.name }
      : {};
    // A Space the agent finished is only waiting to close (space-janitor.js),
    // so agents do not see it: a new task under the same name gets a fresh
    // Space instead of being told the name belongs to the user. The popup
    // still shows it.
    return {
      taskSpaces: await Promise.all(
        spaces
          .filter((space) => !space.closeWhenIdle)
          .map((space) => describeForListing(space, profileFields)),
      ),
    };
  }

  /** Which browser profile this extension instance runs in, once assigned. */
  whoami() {
    return this.#store.profile();
  }

  async setProfile({ id, name, idBase }) {
    if (typeof id !== "string" || !Number.isInteger(idBase)) {
      throw new Error("setProfile needs a profile id and an integer idBase");
    }
    return this.#store.setProfile({ id, name, idBase });
  }

  create({ name, dedicatedBrowser = false }) {
    const run = this.#creating.then(async () => {
      const { windowId, tabId } = await openAgentTab(this.#store, {
        dedicatedBrowser,
      });
      const container = await createContainer(windowId, tabId);
      const space = await this.#store.add({
        name,
        createdBy: "agent",
        ownership: "agent",
        status: "active",
        state: "",
        ...container,
        inAgentWindow: true,
        managed: true,
      });
      return descriptor(space);
    });
    this.#creating = run.catch(() => {});
    return run;
  }

  async claim({ spaceId, name }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const patch = {
      ownership: "agent",
      reason: undefined,
      status: "active",
      managed: true,
      closeWhenIdle: undefined,
    };
    return descriptor(
      await this.#store.update(spaceId, name ? { ...patch, name } : patch),
    );
  }

  async status({ spaceId }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    return {
      ownership: resolved.space.ownership,
      reason: resolved.space.reason,
    };
  }

  /**
   * `linger` (an agent finishing): mark the Space done and leave its tabs up
   * for the user to see; space-janitor.js closes them once idle. Without it
   * (Stop in the popup) the tabs close now.
   */
  async close({ spaceId, linger = false }) {
    if (linger)
      return this.#transition(
        spaceId,
        {
          ownership: "user",
          reason: undefined,
          status: "completed",
          closeWhenIdle: true,
        },
        "task space finished; its tabs close after 10 idle minutes.",
      );
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    await closeContainer(resolved.space);
    await this.#store.removeWhere((space) => space.id === spaceId);
    return `${spaceId} task space closed.`;
  }

  complete({ spaceId }) {
    return this.#transition(
      spaceId,
      { ownership: "user", reason: undefined, status: "completed" },
      "task space completed.",
    );
  }

  handOff({ spaceId }) {
    return this.#transition(
      spaceId,
      { ownership: "user", reason: "manual_takeover", status: "active" },
      "has been handed off to the user.",
    );
  }

  takeOver({ spaceId }) {
    return this.#transition(
      spaceId,
      {
        ownership: "agent",
        reason: undefined,
        status: "active",
        closeWhenIdle: undefined,
      },
      "has been taken over by the agent.",
    );
  }

  setState({ spaceId, state }) {
    return this.#transition(spaceId, { state }, "state updated.");
  }

  /** Brings the Space's window forward and selects its current tab. */
  async focus({ spaceId }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const { space, group } = resolved;
    if (!isTabSetSpace(space))
      await chrome.tabGroups
        .update(space.groupId, { collapsed: false })
        .catch(() => {});
    const tabs = await tabsOf(space);
    const tab = tabs.find((candidate) => candidate.active) ?? tabs.at(-1);
    if (tab) await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(group.windowId, { focused: true });
    return `${spaceId} focused.`;
  }

  async #transition(spaceId, patch, message) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    await this.#store.update(spaceId, patch);
    return `${spaceId} ${message}`;
  }

  /** Drop Spaces whose group or tabs are gone; list the user's other groups as user Spaces. */
  async #syncWithTabGroups() {
    const groups = await queryAllTabGroups();
    const liveIds = new Set(groups.map((group) => group.id));
    const liveTabs = new Set(
      (await chrome.tabs.query({})).map((tab) => tab.id),
    );
    await this.#store.removeWhere((space) => {
      if (isObsoleteSpace(space)) return true;
      if (isTabSetSpace(space))
        return !space.tabIds.some((id) => liveTabs.has(id));
      return !liveIds.has(space.groupId);
    });
    const knownIds = new Set(
      (await this.#store.all()).map((space) => space.groupId),
    );
    for (const group of groups.filter(
      (candidate) => !knownIds.has(candidate.id),
    )) {
      // A status prefix marks an agent Space restored after a browser
      // restart: nothing drives it now, so it is the user's, labelled as such
      // (or still done), and an agent can claim it again by name.
      const restoredStatus = STATUS_PREFIX.exec(group.title ?? "")?.[1];
      await this.#store.add({
        name: groupTitleWithoutStatus(group),
        createdBy: restoredStatus ? "agent" : "user",
        ownership: "user",
        status: restoredStatus === "✓" ? "completed" : "active",
        state: "",
        groupId: group.id,
        inAgentWindow: Boolean(restoredStatus),
        managed: Boolean(restoredStatus),
        color: group.color,
      });
    }
  }
}

// chrome.tabGroups.query rejects with "No current window" in a profile that
// has no windows open; such a profile has no groups.
async function queryAllTabGroups() {
  const windows = await chrome.windows.getAll();
  return windows.length > 0 ? chrome.tabGroups.query({}).catch(() => []) : [];
}

// A Space restored after a browser restart comes back as a plain tab group
// still titled "🤖 name"; list it under its own name.
function groupTitleWithoutStatus(group) {
  const title = (group.title ?? "").replace(STATUS_PREFIX, "").trim();
  return title || `Tab group ${group.id}`;
}

function descriptor(space) {
  return {
    taskId: space.name,
    id: space.id,
    name: space.name,
    createdBy: space.createdBy,
    ownership: space.ownership,
  };
}

async function describeForListing(space, profileFields) {
  const tabs = await tabsOf(space);
  const recentTabTitles = tabs
    .map((tab) => tab.title)
    .filter(Boolean)
    .slice(-RECENT_TAB_TITLES);
  return { ...descriptor(space), ...profileFields, recentTabTitles };
}
