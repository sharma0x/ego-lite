import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which browser this process drives. `ego-brave` drives Brave; `ego-opera`
 * sets EGO_BRAVE_BROWSER=opera. Everything browser-specific lives here: the
 * macOS app name, the debugging port, the user data dir and launch flags.
 *
 * Opera differs from Brave in three ways. It cannot reach the extension
 * through Developer mode the way Brave profiles do, so the extension is
 * loaded with --load-extension on every launch. It may run with its own user
 * data dir (EGO_OPERA_USER_DATA_DIR), next to the user's everyday Opera, so it
 * is started with `open -n` and found by that dir. And it keeps no tab groups,
 * which the extension handles by giving each Space its own window.
 */
const EXTENSION_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../extension",
);

function preset(name) {
  if (name === "opera") {
    const customDir = process.env.EGO_OPERA_USER_DATA_DIR;
    return {
      name: "opera",
      command: "ego-opera",
      app: process.env.EGO_BRAVE_APP || "Opera",
      port: 9333,
      userDataDir:
        customDir ||
        join(homedir(), "Library/Application Support/com.operasoftware.Opera"),
      customUserDataDir: Boolean(customDir),
      extraFlags: [
        ...(customDir
          ? [`--user-data-dir=${customDir}`, "--no-first-run"]
          : []),
        `--load-extension=${EXTENSION_DIR}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
      ],
    };
  }
  return {
    name: "brave",
    command: "ego-brave",
    app: process.env.EGO_BRAVE_APP || "Brave Browser",
    port: 9222,
    userDataDir: join(
      homedir(),
      "Library/Application Support/BraveSoftware/Brave-Browser",
    ),
    customUserDataDir: false,
    extraFlags: [],
  };
}

export const BROWSER = preset(process.env.EGO_BRAVE_BROWSER);

export const CDP_ENDPOINT =
  process.env.EGO_BRAVE_CDP_URL || `http://127.0.0.1:${BROWSER.port}`;
