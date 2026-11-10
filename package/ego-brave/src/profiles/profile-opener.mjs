import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bridgeMissing } from "../extension/extension-rpc.mjs";
import { ActiveProfilePage } from "./active-profile-page.mjs";

const EXTENSION_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../extension",
);
const SWITCH_ATTEMPTS = 20;
const SWITCH_DELAY_MS = 300;
const SETTLE_ATTEMPTS = 3;
const BRIDGE_ATTEMPTS = 20;
const BRIDGE_DELAY_MS = 150;
const NEW_TAB_URL = /^chrome:\/\/newtab\/?$/;

const PROFILE_PATH_READY =
  "Boolean(document.getElementById('profile_path')?.textContent)";
const PROFILE_PATH =
  "document.getElementById('profile_path').textContent.trim()";
const EXTENSIONS_API_READY =
  "Boolean(globalThis.chrome?.developerPrivate && chrome.management)";

/**
 * Makes a profile usable by agents: switches the browser to it, confirms its
 * identity, installs the extension there if missing and tells the extension
 * which profile it serves.
 *
 * CDP can only open targets in the most recently active profile and cannot
 * name profiles, so the browser is asked to switch with --profile-directory
 * (handled by the running instance) and the result is read from
 * chrome://version. This happens once per profile: the tag persists in the
 * extension's storage.
 */
export class ProfileOpener {
  #client;
  #catalog;
  #directory;
  #browserExecutable;
  #pages;

  constructor({ client, catalog, directory, browserExecutable }) {
    this.#client = client;
    this.#catalog = catalog;
    this.#directory = directory;
    this.#browserExecutable = browserExecutable;
    this.#pages = new ActiveProfilePage(client);
  }

  /**
   * @returns {{ rpc, cleanup: () => Promise<void> }} cleanup closes blank tabs
   *   the switch opened; call it once the caller has its own window open.
   */
  async open(profileId) {
    const existing = await this.#directory.forProfile(profileId);
    if (existing) return { rpc: existing, cleanup: async () => {} };

    const pagesBefore = await this.#pageTargetIds();
    const browserContextId = await this.#switchTo(profileId);
    const rpc = await this.#bridgeIn(browserContextId, profileId);
    await rpc.call("setProfile", {
      id: profileId,
      name: this.#catalog.resolve(profileId).name,
      idBase: this.#catalog.idBaseOf(profileId),
    });
    this.#directory.register(profileId, rpc);
    return {
      rpc,
      cleanup: () => this.#closeBlankTabs(pagesBefore, browserContextId),
    };
  }

  async #switchTo(profileId) {
    const contextBefore = await this.#activeContextId();
    spawn(this.#browserExecutable, [`--profile-directory=${profileId}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    for (let attempt = 0; attempt < SWITCH_ATTEMPTS; attempt += 1) {
      await sleep(SWITCH_DELAY_MS);
      const switched = (await this.#activeContextId()) !== contextBefore;
      if (!switched && attempt < SETTLE_ATTEMPTS) continue;
      const active = await this.#identifyActiveProfile();
      if (active.profileId === profileId) return active.browserContextId;
    }
    throw new Error(`The browser did not switch to profile "${profileId}"`);
  }

  async #identifyActiveProfile() {
    const { value, browserContextId } = await this.#pages.evaluate(
      "chrome://version",
      PROFILE_PATH_READY,
      PROFILE_PATH,
    );
    return { profileId: basename(value), browserContextId };
  }

  /** Extensions.loadUnpacked installs into the active profile, which is now this one. */
  async #bridgeIn(browserContextId, profileId) {
    const running = await this.#directory.inContext(browserContextId);
    if (running) return running;
    const { id } = await this.#client.call("Extensions.loadUnpacked", {
      path: EXTENSION_DIR,
    });
    await this.#allowUnpackedExtension(id);
    for (let attempt = 0; attempt < BRIDGE_ATTEMPTS; attempt += 1) {
      await sleep(BRIDGE_DELAY_MS);
      const loaded = await this.#directory.inContext(browserContextId);
      if (loaded) return loaded;
    }
    throw bridgeMissing(` "${profileId}"`);
  }

  /**
   * Chromium disables unpacked extensions in profiles without Developer mode
   * (disable reason 1 << 24), so turn it on and re-enable the extension.
   */
  async #allowUnpackedExtension(extensionId) {
    const id = JSON.stringify(extensionId);
    await this.#pages.evaluate(
      "chrome://extensions",
      EXTENSIONS_API_READY,
      `chrome.developerPrivate
        .updateProfileConfiguration({ inDeveloperMode: true })
        .then(() => chrome.management.setEnabled(${id}, true))`,
    );
  }

  async #closeBlankTabs(pagesBefore, browserContextId) {
    const { targetInfos } = await this.#client.call("Target.getTargets");
    const blank = targetInfos.filter(
      (target) =>
        target.type === "page" &&
        target.browserContextId === browserContextId &&
        !pagesBefore.has(target.targetId) &&
        NEW_TAB_URL.test(target.url),
    );
    for (const { targetId } of blank) {
      await this.#client
        .call("Target.closeTarget", { targetId })
        .catch(() => {});
    }
  }

  async #activeContextId() {
    const { defaultBrowserContextId } = await this.#client.call(
      "Target.getBrowserContexts",
    );
    return defaultBrowserContextId;
  }

  async #pageTargetIds() {
    const { targetInfos } = await this.#client.call("Target.getTargets");
    return new Set(
      targetInfos
        .filter((target) => target.type === "page")
        .map((target) => target.targetId),
    );
  }
}

function sleep(milliseconds) {
  return new Promise((settle) => setTimeout(settle, milliseconds));
}
