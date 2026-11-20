import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BROWSER } from "../cli/browser.mjs";

/**
 * Each profile owns a block of Space ids: "Default" 1..99999, "Profile N"
 * N*100000+1... A Space id therefore names its profile, and ids stay unique
 * although every profile's extension allocates its own.
 */
export const SPACE_ID_SPAN = 100_000;

const DEFAULT_PROFILE_DIR = "Default";
const NUMBERED_PROFILE = /^Profile (\d+)$/;
const DEFAULT_ALIASES = new Set([undefined, "", "default"]);

/** The browser's profiles, read from its Local State file. */
export class ProfileCatalog {
  #profiles;
  #defaultId;

  /**
   * @param {{ id: string, name: string }[]} profiles
   * @param {string} defaultId profile used when a Space names none
   */
  constructor(profiles, defaultId) {
    this.#profiles = profiles.filter((profile) => isSupportedId(profile.id));
    this.#defaultId = defaultId;
  }

  static load({
    userDataDir = process.env.EGO_BRAVE_USER_DATA_DIR || BROWSER.userDataDir,
    preferredId = process.env.EGO_BRAVE_PROFILE,
  } = {}) {
    const localState = readJson(join(userDataDir, "Local State")) ?? {};
    const cache = localState.profile?.info_cache ?? {};
    const profiles = Object.entries(cache).map(([id, info]) => ({
      id,
      name: info.name || id,
    }));
    // A new user data dir lists no profile in Local State until the browser
    // writes it later, so profile folders on disk, and the last used one,
    // count too.
    const lastUsed = localState.profile?.last_used;
    for (const id of new Set([...profileDirsOnDisk(userDataDir), lastUsed]))
      if (id && isSupportedId(id) && !cache[id])
        profiles.push({ id, name: nameFromPreferences(userDataDir, id) });
    const known = new Set(profiles.map((profile) => profile.id));
    const defaultId =
      [preferredId, DEFAULT_PROFILE_DIR, lastUsed].find(
        (id) => id && known.has(id),
      ) ?? profiles[0]?.id;
    return new ProfileCatalog(profiles, defaultId);
  }

  /** In the native listProfiles() shape. */
  list() {
    return this.#profiles.map((profile) => ({
      ...profile,
      isDefault: profile.id === this.#defaultId,
    }));
  }

  /** A profile by id; undefined, "" and "default" mean the default profile. */
  resolve(profileId) {
    const id = DEFAULT_ALIASES.has(profileId) ? this.#defaultId : profileId;
    return this.#profiles.find((profile) => profile.id === id);
  }

  idBaseOf(profileId) {
    if (profileId === DEFAULT_PROFILE_DIR) return 0;
    const match = NUMBERED_PROFILE.exec(profileId);
    if (!match) throw new Error(`Unsupported profile directory: ${profileId}`);
    return Number(match[1]) * SPACE_ID_SPAN;
  }

  profileIdForSpace(spaceId) {
    const block = Math.floor(spaceId / SPACE_ID_SPAN);
    return block === 0 ? DEFAULT_PROFILE_DIR : `Profile ${block}`;
  }
}

function profileDirsOnDisk(userDataDir) {
  if (!existsSync(userDataDir)) return [];
  return readdirSync(userDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSupportedId(entry.name))
    .map((entry) => entry.name);
}

function nameFromPreferences(userDataDir, id) {
  return readJson(join(userDataDir, id, "Preferences"))?.profile?.name || id;
}

/** Parsed JSON, or undefined while the browser has not written the file yet. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isSupportedId(id) {
  return id === DEFAULT_PROFILE_DIR || NUMBERED_PROFILE.test(id);
}
