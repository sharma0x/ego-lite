const STORAGE_KEY = "egoBrave";

/**
 * Persists Spaces in chrome.storage.local, the single source of truth shared
 * by the service worker and the popup. Mutations are queued so concurrent
 * agent calls cannot lose each other's read-modify-write.
 *
 * Space fields: id, name, createdBy ('agent'|'user'), ownership ('agent'|'user'),
 * reason, status ('active'|'completed'), state, groupId, ownsWindow, managed,
 * activeTargetId.
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
