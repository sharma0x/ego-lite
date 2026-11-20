import { loadedCodeState } from "../cli/browser.mjs";
import {
  ExtensionRpc,
  bridgeMissing,
  findBridges,
} from "../extension/extension-rpc.mjs";
import { reloadExtensionIn } from "../extension/extension-reload.mjs";

/**
 * The extension bridges running in the browser, attached at most once each.
 * A bridge learns which profile it serves from the CLI (setProfile) and
 * reports it through whoami, so profiles are found by asking, not guessing.
 *
 * Every bridge handed out runs the extension code on disk: a profile whose
 * copy has not run the current code yet is reloaded first (once per code
 * change and profile, tracked by `code`). Otherwise a profile that was not
 * open during an update keeps running a cached old service worker.
 */
export class BridgeDirectory {
  #client;
  #code;
  #byTargetId = new Map();
  #byProfileId = new Map();
  #listeners = new Set();
  #reload;

  /**
   * @param {object} client CdpClient
   * @param {{ code?: ReturnType<typeof loadedCodeState>, reload?: typeof reloadExtensionIn }} options
   */
  constructor(
    client,
    { code = loadedCodeState(), reload = reloadExtensionIn } = {},
  ) {
    this.#client = client;
    this.#code = code;
    this.#reload = reload;
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

  /**
   * Record that a bridge serves a profile, after setProfile succeeded.
   * `installed`: the extension was just installed there, so it already runs
   * the current code. Returns the bridge to use, which is a new one when the
   * profile had to be reloaded.
   */
  async register(profileId, rpc, { browserContextId, installed = false }) {
    if (installed) this.#code.markCurrent(profileId);
    const current = installed
      ? rpc
      : await this.#current(profileId, browserContextId, rpc);
    this.#byProfileId.set(profileId, current);
    return current;
  }

  onEvent(listener) {
    this.#listeners.add(listener);
  }

  async #identifyAll() {
    for (const bridge of await findBridges(this.#client)) {
      if (this.#byTargetId.has(bridge.targetId)) continue;
      const rpc = await this.#attach(bridge);
      const profile = await rpc.call("whoami");
      if (!profile?.id) continue;
      this.#byProfileId.set(
        profile.id,
        await this.#current(profile.id, bridge.browserContextId, rpc),
      );
    }
  }

  async #current(profileId, browserContextId, rpc) {
    if (this.#code.isCurrent(profileId)) return rpc;
    const bridge = await this.#reload(this.#client, browserContextId);
    const fresh = await this.#attach(bridge);
    if (!fresh) throw bridgeMissing(` "${profileId}"`);
    this.#code.markCurrent(profileId);
    return fresh;
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
