import { ErrorCode, errorResult } from "../errors.mjs";

/**
 * Routes extension calls to the right profile, behind the same call/onEvent
 * interface as a single ExtensionRpc:
 *   listSpaces   every set-up profile, merged
 *   createSpace  the requested profile, opened and set up on first use
 *   otherwise    the profile that owns args.spaceId (its id block)
 */
export class ProfileRouter {
  #catalog;
  #directory;
  #opener;

  constructor({ catalog, directory, opener }) {
    this.#catalog = catalog;
    this.#directory = directory;
    this.#opener = opener;
  }

  async call(operation, args = {}) {
    if (operation === "listSpaces") return this.#listSpaces();
    if (operation === "createSpace") return this.#createSpace(args);
    return this.#callSpaceProfile(operation, args);
  }

  onEvent(listener) {
    this.#directory.onEvent(listener);
  }

  /** Set a profile up without creating a Space (used by `ego-brave doctor`). */
  async ensureProfile(profileId) {
    const { cleanup } = await this.#opener.open(profileId);
    await cleanup();
  }

  async #listSpaces() {
    const bridges = [...(await this.#directory.all()).values()];
    const listings = await Promise.all(
      bridges.map((rpc) => rpc.call("listSpaces")),
    );
    return {
      taskSpaces: listings.flatMap((listing) => listing?.taskSpaces ?? []),
    };
  }

  async #createSpace({ name, profileId }) {
    const { rpc, cleanup } = await this.#opener.open(profileId);
    const created = await rpc.call("createSpace", { name });
    await cleanup();
    return created;
  }

  async #callSpaceProfile(operation, args) {
    const profileId = this.#catalog.profileIdForSpace(args.spaceId);
    const rpc = await this.#directory.forProfile(profileId);
    if (rpc) return rpc.call(operation, args);
    return errorResult(
      ErrorCode.TASK_SPACE_NOT_FOUND,
      `Task space not found: ${args.spaceId}`,
    );
  }
}
