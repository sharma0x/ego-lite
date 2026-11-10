import { ExtensionRpc, findBridges } from "../extension/extension-rpc.mjs";

/**
 * The extension bridges running in the browser, attached at most once each.
 * A bridge learns which profile it serves from the CLI (setProfile) and
 * reports it through whoami, so profiles are found by asking, not guessing.
 */
export class BridgeDirectory {
  #client;
  #byTargetId = new Map();
  #byProfileId = new Map();
  #listeners = new Set();

  constructor(client) {
    this.#client = client;
  }

  /** The bridge for a profile that is open and set up, or undefined. */
  async forProfile(profileId) {
    if (!this.#byProfileId.has(profileId)) await this.#identifyAll();
    return this.#byProfileId.get(profileId);
  }

  /** Every set-up bridge, keyed by profile id. */
  async all() {
    await this.#identifyAll();
    return new Map(this.#byProfileId);
  }

  /** The bridge running in a browser context, attached but not yet tagged. */
  async inContext(browserContextId) {
    const bridge = (await findBridges(this.#client)).find(
      (candidate) => candidate.browserContextId === browserContextId,
    );
    return bridge ? this.#attach(bridge) : undefined;
  }

  /** Record that a bridge serves a profile, after setProfile succeeded. */
  register(profileId, rpc) {
    this.#byProfileId.set(profileId, rpc);
  }

  onEvent(listener) {
    this.#listeners.add(listener);
  }

  async #identifyAll() {
    for (const bridge of await findBridges(this.#client)) {
      if (this.#byTargetId.has(bridge.targetId)) continue;
      const rpc = await this.#attach(bridge);
      const profile = await rpc.call("whoami");
      if (profile?.id) this.#byProfileId.set(profile.id, rpc);
    }
  }

  async #attach(bridge) {
    if (!this.#byTargetId.has(bridge.targetId)) {
      const rpc = await ExtensionRpc.connectTo(this.#client, bridge);
      rpc.onEvent((event) =>
        this.#listeners.forEach((listener) => listener(event)),
      );
      this.#byTargetId.set(bridge.targetId, rpc);
    }
    return this.#byTargetId.get(bridge.targetId);
  }
}
