const ACTIVITY_KEY = "egoBraveActivity";
const TOUCH_THROTTLE_MS = 60_000;
const MINUTE = 60_000;

/**
 * How long an agent Space may sit untouched before it is closed, so tabs an
 * agent forgot to finish do not pile up. Activity is any agent call on the
 * Space, a page loading in it, or the user selecting one of its tabs.
 */
export const IDLE_LIMITS_MS = {
  /** 🤖 the agent is working, or forgot to finish. */
  working: 30 * MINUTE,
  /** ✓ done and kept for the user to look at. */
  done: 60 * MINUTE,
  /** ✋ waiting for the user (a sign-in, a restored Space). */
  user: 8 * 60 * MINUTE,
};

/**
 * @returns {number | null} the Space's idle limit; null for Spaces that are
 *   never closed automatically: the user's own tab groups, including ones an
 *   agent claimed.
 */
export function idleLimit(space) {
  if (space.createdBy !== "agent" || !space.managed) return null;
  if (space.status === "completed") return IDLE_LIMITS_MS.done;
  if (space.ownership === "agent") return IDLE_LIMITS_MS.working;
  return IDLE_LIMITS_MS.user;
}

/**
 * The Spaces to close now. A Space with no recorded activity is not expired
 * (its clock starts at the next sweep), and the one the user is looking at
 * never is.
 *
 * @param {object[]} spaces
 * @param {Record<string, number>} activity last activity per Space id
 * @param {number} now
 * @param {number | undefined} viewedSpaceId
 */
export function expiredSpaces(spaces, activity, now, viewedSpaceId) {
  return spaces.filter((space) => {
    const limit = idleLimit(space);
    const last = activity[space.id];
    return (
      limit !== null &&
      space.id !== viewedSpaceId &&
      last !== undefined &&
      now - last >= limit
    );
  });
}

/**
 * Records Space activity (in its own storage key, so it does not re-render
 * the tab groups) and closes Spaces that stayed idle past their limit.
 */
export class SpaceJanitor {
  #registry;
  #store;
  #queue = Promise.resolve();

  constructor(registry, store) {
    this.#registry = registry;
    this.#store = store;
  }

  touch(spaceId, now = Date.now()) {
    return this.#mutate((activity) => {
      if (now - (activity[spaceId] ?? 0) < TOUCH_THROTTLE_MS) return false;
      activity[spaceId] = now;
      return true;
    });
  }

  async touchTab(tabId) {
    const space = await this.#spaceOfTab(tabId);
    if (space) await this.touch(space.id);
  }

  /** @returns {Promise<number[]>} ids of the Spaces it closed */
  async sweep(now = Date.now()) {
    const spaces = await this.#store.all();
    const viewed = await this.#viewedSpace();
    if (viewed) await this.touch(viewed.id, now);
    const activity = await this.#read();
    const expired = expiredSpaces(spaces, activity, now, viewed?.id);
    for (const space of expired)
      await this.#registry.close({ spaceId: space.id }).catch(() => {});
    // Start the clock for new Spaces and forget the ones that are gone.
    const tracked = new Set(
      spaces
        .filter(
          (space) => !expired.includes(space) && idleLimit(space) !== null,
        )
        .map((space) => String(space.id)),
    );
    await this.#mutate((record) => {
      let changed = false;
      for (const id of Object.keys(record))
        if (!tracked.has(id)) {
          delete record[id];
          changed = true;
        }
      for (const id of tracked)
        if (record[id] === undefined) {
          record[id] = now;
          changed = true;
        }
      return changed;
    });
    return expired.map((space) => space.id);
  }

  /** The Space holding the selected tab of the focused window, if any. */
  async #viewedSpace() {
    const window = await chrome.windows
      .getLastFocused({ populate: true })
      .catch(() => undefined);
    if (!window?.focused) return undefined;
    const tab = window.tabs?.find((candidate) => candidate.active);
    return tab ? this.#spaceOfTab(tab.id, tab) : undefined;
  }

  async #spaceOfTab(tabId, known) {
    const tab = known ?? (await chrome.tabs.get(tabId).catch(() => undefined));
    if (!tab) return undefined;
    return (await this.#store.all()).find((space) =>
      space.tabIds
        ? space.tabIds.includes(tab.id)
        : tab.groupId !== -1 && space.groupId === tab.groupId,
    );
  }

  async #read() {
    return (await chrome.storage.local.get(ACTIVITY_KEY))[ACTIVITY_KEY] ?? {};
  }

  /** Serialised read-modify-write; `change` returns whether to save. */
  #mutate(change) {
    const run = this.#queue.then(async () => {
      const activity = await this.#read();
      if (change(activity))
        await chrome.storage.local.set({ [ACTIVITY_KEY]: activity });
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}
