import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Each profile owns a block of Space ids: "Default" 1..99999, "Profile N"
 * N*100000+1... A Space id therefore names its profile, and ids stay unique
 * although every profile's extension allocates its own.
 */
export const SPACE_ID_SPAN = 100_000;

const DEFAULT_PROFILE_DIR = "Default";
const NUMBERED_PROFILE = /^Profile (\d+)$/;
const DEFAULT_ALIASES = new Set([undefined, "", "default"]);
const BRAVE_USER_DATA_DIR = join(
  homedir(),
  "Library/Application Support/BraveSoftware/Brave-Browser",
);

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
    userDataDir = process.env.EGO_BRAVE_USER_DATA_DIR || BRAVE_USER_DATA_DIR,
    preferredId = process.env.EGO_BRAVE_PROFILE,
  } = {}) {
    const localState = JSON.parse(
      readFileSync(join(userDataDir, "Local State"), "utf8"),
    );
    const cache = localState.profile?.info_cache ?? {};
    const profiles = Object.entries(cache).map(([id, info]) => ({
      id,
      name: info.name || id,
    }));
    const defaultId =
      [preferredId, DEFAULT_PROFILE_DIR, localState.profile?.last_used].find(
        (id) => id && cache[id],
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

function isSupportedId(id) {
  return id === DEFAULT_PROFILE_DIR || NUMBERED_PROFILE.test(id);
}
