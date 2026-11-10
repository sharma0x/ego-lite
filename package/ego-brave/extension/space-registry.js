const RECENT_TAB_TITLES = 5;
const STATUS_PREFIX = /^(🤖|✋|✓)\s*/u;

export function errorResult(errorCode, message) {
  return { error: message, error_code: errorCode };
}

/**
 * Space lifecycle and ownership. A Space is a tab group: agent-created Spaces
 * get their own unfocused window so the agent never switches the user's tabs;
 * a user's own tab groups are listed as user-owned Spaces they can let the
 * agent claim.
 */
export class SpaceRegistry {
  #store;

  constructor(store) {
    this.#store = store;
  }

  /** @returns {{space, group}} or an EGO_TASK_SPACE_NOT_FOUND result. */
  async resolve(spaceId) {
    const space = await this.#store.get(spaceId);
    const group =
      space &&
      (await chrome.tabGroups.get(space.groupId).catch(() => undefined));
    if (group) return { space, group };
    if (space)
      await this.#store.removeWhere((candidate) => candidate.id === spaceId);
    return errorResult(
      "EGO_TASK_SPACE_NOT_FOUND",
      `Task space not found: ${spaceId}`,
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
    return {
      taskSpaces: await Promise.all(
        spaces.map((space) => describeForListing(space, profileFields)),
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

  async create({ name }) {
    const window = await chrome.windows.create({
      url: "about:blank",
      focused: false,
    });
    const groupId = await chrome.tabs.group({
      tabIds: [window.tabs[0].id],
      createProperties: { windowId: window.id },
    });
    const space = await this.#store.add({
      name,
      createdBy: "agent",
      ownership: "agent",
      status: "active",
      state: "",
      groupId,
      ownsWindow: true,
      managed: true,
    });
    return descriptor(space);
  }

  async claim({ spaceId, name }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    const patch = {
      ownership: "agent",
      reason: undefined,
      status: "active",
      managed: true,
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

  async close({ spaceId }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    await closeGroup(resolved.space, resolved.group);
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
      { ownership: "agent", reason: undefined, status: "active" },
      "has been taken over by the agent.",
    );
  }

  setState({ spaceId, state }) {
    return this.#transition(spaceId, { state }, "state updated.");
  }

  async focus({ spaceId }) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    await chrome.windows.update(resolved.group.windowId, { focused: true });
    return `${spaceId} focused.`;
  }

  async #transition(spaceId, patch, message) {
    const resolved = await this.resolve(spaceId);
    if (resolved.error_code) return resolved;
    await this.#store.update(spaceId, patch);
    return `${spaceId} ${message}`;
  }

  /** Drop Spaces whose group is gone; list the user's other groups as user Spaces. */
  async #syncWithTabGroups() {
    const groups = await queryAllTabGroups();
    const liveIds = new Set(groups.map((group) => group.id));
    await this.#store.removeWhere((space) => !liveIds.has(space.groupId));
    const knownIds = new Set(
      (await this.#store.all()).map((space) => space.groupId),
    );
    for (const group of groups.filter(
      (candidate) => !knownIds.has(candidate.id),
    )) {
      await this.#store.add({
        name: groupTitleWithoutStatus(group),
        createdBy: "user",
        ownership: "user",
        status: "active",
        state: "",
        groupId: group.id,
        ownsWindow: false,
        managed: false,
      });
    }
  }
}

// chrome.tabGroups.query rejects with "No current window" in a profile that
// has no windows open; such a profile has no groups.
async function queryAllTabGroups() {
  const windows = await chrome.windows.getAll();
  return windows.length > 0 ? chrome.tabGroups.query({}) : [];
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
  const tabs = await chrome.tabs.query({ groupId: space.groupId });
  const recentTabTitles = tabs
    .map((tab) => tab.title)
    .filter(Boolean)
    .slice(-RECENT_TAB_TITLES);
  return { ...descriptor(space), ...profileFields, recentTabTitles };
}

async function closeGroup(space, group) {
  if (space.ownsWindow) {
    await chrome.windows.remove(group.windowId);
    return;
  }
  const tabs = await chrome.tabs.query({ groupId: space.groupId });
  await chrome.tabs.remove(tabs.map((tab) => tab.id));
}
