const STORAGE_KEY = "egoBrave";

/**
 * Persists Spaces in chrome.storage.local, the single source of truth shared
 * by the service worker and the popup. Mutations are queued so concurrent
 * agent calls cannot lose each other's read-modify-write.
 *
 * Space fields: id, name, createdBy ('agent'|'user'), ownership ('agent'|'user'),
 * reason, status ('active'|'completed'), state, groupId (tab group) or
 * tabIds (tab-set Space, see space-container.js), inAgentWindow, managed,
 * activeTargetId. `agentWindowId` is the window all agent Spaces share.
 *
 * The extension runs once per browser profile. `profile` ({ id, name, idBase })
 * is assigned by the CLI, which alone knows which profile this instance is
 * in; Space ids start above idBase so they are unique across profiles.
 */
export class SpaceStore {
  #queue = Promise.resolve();

  async all() {
    return (await this.#read()).spaces;
  }

  async profile() {
    return (await this.#read()).profile ?? null;
  }

  setProfile(profile) {
    return this.#mutate((state) => {
      state.profile = profile;
      state.nextId = Math.max(state.nextId, profile.idBase + 1);
      return profile;
    });
  }

  async agentWindowId() {
    return (await this.#read()).agentWindowId ?? null;
  }

  setAgentWindowId(windowId) {
    return this.#mutate((state) => {
      state.agentWindowId = windowId;
      return windowId;
    });
  }

  async get(spaceId) {
    return (await this.all()).find((space) => space.id === spaceId);
  }

  add(fields) {
    return this.#mutate((state) => {
      const space = { ...fields, id: state.nextId };
      state.nextId += 1;
      state.spaces.push(space);
      return space;
    });
  }

  update(spaceId, patch) {
    return this.#mutate((state) => {
      const space = state.spaces.find((candidate) => candidate.id === spaceId);
      if (space) Object.assign(space, patch);
      return space;
    });
  }

  removeWhere(predicate) {
    return this.#mutate((state) => {
      const removed = state.spaces.filter(predicate);
      state.spaces = state.spaces.filter((space) => !predicate(space));
      return removed;
    });
  }

  /** Drops a closed tab from tab-set Spaces and removes the ones left empty. */
  async forgetTab(tabId) {
    const spaces = await this.all();
    if (!spaces.some((space) => space.tabIds?.includes(tabId))) return;
    await this.#mutate((state) => {
      for (const space of state.spaces)
        if (Array.isArray(space.tabIds))
          space.tabIds = space.tabIds.filter((id) => id !== tabId);
      state.spaces = state.spaces.filter(
        (space) => !Array.isArray(space.tabIds) || space.tabIds.length > 0,
      );
    });
  }

  #mutate(change) {
    const run = this.#queue.then(async () => {
      const state = await this.#read();
      const result = change(state);
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
      return result;
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #read() {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return stored ?? { nextId: 1, spaces: [] };
  }
}
