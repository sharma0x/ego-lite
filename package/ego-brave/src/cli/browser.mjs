import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which browser this process drives. `ego-brave` drives Brave; `ego-opera`
 * and `ego-edge` set EGO_BRAVE_BROWSER. Everything browser-specific lives
 * here: the app name, executable, debugging port, user data dir and flags.
 *
 * A browser on its own user data dir (`customUserDataDir`) runs as a second
 * instance beside the user's everyday one and is found by that dir. Edge
 * always does: Chromium 136+ ignores --remote-debugging-port on the default
 * user data dir. Such a fresh profile has no Developer mode, so the extension
 * comes in with --load-extension, and --enable-unsafe-extension-debugging
 * lets Extensions.loadUnpacked reinstall it when it is missing.
 *
 * Edge loads a copy of the extension staged in its own app-data folder
 * (`extensionDir`, refreshed by `stageExtension()` before every launch): on
 * macOS reading the repo under ~/Documents would stop Edge's startup on a
 * privacy prompt, and a fixed path keeps the unpacked extension's id stable.
 *
 * Opera keeps no tab groups, which the extension handles by giving each Space
 * its own window.
 */
export const EXTENSION_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../extension",
);

const IS_WINDOWS = process.platform === "win32";

function localAppData() {
  return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
}

function loadExtensionFlags(extensionDir) {
  return [
    `--load-extension=${extensionDir}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ];
}

function edgePreset() {
  const home = IS_WINDOWS
    ? join(localAppData(), "ego-edge")
    : join(homedir(), "Library/Application Support/ego-edge");
  const userDataDir =
    process.env.EGO_EDGE_USER_DATA_DIR || join(home, "User Data");
  const extensionDir = join(home, "extension");
  const programFiles = [
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env.ProgramFiles || "C:\\Program Files",
    localAppData(),
  ];
  return {
    name: "edge",
    command: "ego-edge",
    app: process.env.EGO_BRAVE_APP || "Microsoft Edge",
    port: 9444,
    userDataDir,
    customUserDataDir: true,
    extensionDir,
    macAppBundle: process.env.EGO_EDGE_APP,
    extensionsPage: "edge://extensions",
    windowsExecutables: [
      process.env.EGO_EDGE_EXE,
      ...programFiles.map((root) =>
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      ),
    ].filter(Boolean),
    extraFlags: [
      ...loadExtensionFlags(extensionDir),
      "--enable-unsafe-extension-debugging",
      "--no-default-browser-check",
    ],
  };
}

function operaPreset() {
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
    extensionDir: EXTENSION_DIR,
    extensionsPage: "opera://extensions",
    windowsExecutables: [
      join(localAppData(), "Programs", "Opera", "opera.exe"),
    ],
    extraFlags: loadExtensionFlags(EXTENSION_DIR),
  };
}

function bravePreset() {
  return {
    name: "brave",
    command: "ego-brave",
    app: process.env.EGO_BRAVE_APP || "Brave Browser",
    port: 9222,
    userDataDir: IS_WINDOWS
      ? join(localAppData(), "BraveSoftware", "Brave-Browser", "User Data")
      : join(
          homedir(),
          "Library/Application Support/BraveSoftware/Brave-Browser",
        ),
    customUserDataDir: false,
    extensionDir: EXTENSION_DIR,
    extensionsPage: "brave://extensions",
    windowsExecutables: [
      join(
        process.env.ProgramFiles || "C:\\Program Files",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe",
      ),
    ],
    extraFlags: [],
  };
}

/**
 * Refreshes the staged copy of the extension when the preset loads one from
 * outside the repo. Replaces it whole, so files removed from the repo go too.
 *
 * Chromium keeps running an unpacked extension's cached service worker until
 * its version changes, so each change to the sources bumps a fourth version
 * component (0.1.0 -> 0.1.0.N, shown in the extensions page); the build
 * counter lives beside the copy. A changed copy still needs a reload once the
 * browser runs (extension-reload.mjs).
 *
 * @returns {{ updated: boolean }} updated: an earlier copy was replaced by
 *   changed sources, so a running worker may be stale.
 */
export function stageExtension(browser = BROWSER, sourceDir = EXTENSION_DIR) {
  if (browser.extensionDir === sourceDir) return { updated: false };
  const stateFile = buildStateFile(browser);
  const previous = readBuildState(stateFile);
  const hash = hashDirectory(sourceDir);
  const build = previous.hash === hash ? previous.build : previous.build + 1;
  rmSync(browser.extensionDir, { recursive: true, force: true });
  mkdirSync(dirname(browser.extensionDir), { recursive: true });
  cpSync(sourceDir, browser.extensionDir, { recursive: true });
  const manifestPath = join(browser.extensionDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = `${manifest.version}.${build}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(stateFile, JSON.stringify({ hash, build }));
  return { updated: previous.hash !== undefined && previous.hash !== hash };
}

/** True when the sources changed since the copy the browser runs was staged. */
export function stagedExtensionIsStale(
  browser = BROWSER,
  sourceDir = EXTENSION_DIR,
) {
  if (browser.extensionDir === sourceDir) return false;
  return (
    readBuildState(buildStateFile(browser)).hash !== hashDirectory(sourceDir)
  );
}

/**
 * A browser that loads the extension straight from the repo (Brave) gets no
 * staged copy, so the CLI remembers which sources it last reloaded there.
 * @returns {{ changed: boolean, record: () => void }}
 */
export function inPlaceExtensionState(
  browser = BROWSER,
  sourceDir = EXTENSION_DIR,
  dir = stateDir(),
) {
  const stateFile = join(dir, `${browser.name}-extension.json`);
  const hash = hashDirectory(sourceDir);
  return {
    changed: readBuildState(stateFile).hash !== hash,
    record() {
      mkdirSync(dir, { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ hash }));
    },
  };
}

/** Where the CLI keeps its own small state files. */
function stateDir() {
  return IS_WINDOWS
    ? join(localAppData(), "ego-brave")
    : join(homedir(), ".cache", "ego-brave");
}

function buildStateFile(browser) {
  return join(dirname(browser.extensionDir), "extension-build.json");
}

function readBuildState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return { hash: undefined, build: 0 };
  }
}

function hashDirectory(dir) {
  const hash = createHash("sha256");
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) {
    hash.update(relative(dir, file).replaceAll("\\", "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

const PRESETS = { brave: bravePreset, opera: operaPreset, edge: edgePreset };

export function preset(name) {
  return (PRESETS[name] ?? bravePreset)();
}

export const BROWSER = preset(process.env.EGO_BRAVE_BROWSER);

export const CDP_ENDPOINT =
  process.env.EGO_BRAVE_CDP_URL || `http://127.0.0.1:${BROWSER.port}`;
