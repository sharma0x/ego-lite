const STORAGE_KEY = "egoBrave";

/**
 * Persists Spaces in chrome.storage.local, the single source of truth shared
 * by the service worker and the popup. Mutations are queued so concurrent
 * agent calls cannot lose each other's read-modify-write.
 *
 * Space fields: id, name, createdBy ('agent'|'user'), ownership ('agent'|'user'),
 * reason, status ('active'|'completed'), state, groupId, ownsWindow, managed,
 * activeTargetId.
 */
export class SpaceStore {
  #queue = Promise.resolve();

  async all() {
    return (await this.#read()).spaces;
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
