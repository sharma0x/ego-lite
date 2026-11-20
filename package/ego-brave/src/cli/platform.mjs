import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * How this OS starts, finds, quits and names a browser process. macOS goes
 * through LaunchServices (`open -a`): a browser binary started from a shell
 * gets no keyboard focus, Dock entry or Quit menu. Windows has no such rule,
 * so the executable is spawned detached.
 *
 * @param {object} browser a preset from browser.mjs
 */
export function platformFor(browser, platform = process.platform) {
  return platform === "win32" ? windows(browser) : macos(browser);
}

function macos(browser) {
  const dataDirPattern = `--user-data-dir=${browser.userDataDir}`;
  return {
    async start(args) {
      // A second instance on its own user data dir needs `open -n`.
      const openArgs = browser.customUserDataDir ? ["-n", "-a"] : ["-a"];
      await run("open", [...openArgs, macApp(browser), "--args", ...args]);
    },
    async isRunning() {
      const args = browser.customUserDataDir
        ? ["-f", "--", dataDirPattern]
        : ["-x", browser.app];
      return run("pgrep", args).then(
        () => true,
        () => false,
      );
    },
    async quit() {
      if (browser.customUserDataDir)
        await run("pkill", ["-f", "--", dataDirPattern]).catch(() => {});
      else
        await run("osascript", [
          "-e",
          `tell application ${JSON.stringify(browser.app)} to quit`,
        ]).catch(() => {});
    },
    async forceQuit() {
      if (browser.customUserDataDir)
        await run("pkill", ["-9", "-f", "--", dataDirPattern]).catch(() => {});
    },
    executableOf(processId) {
      return execFileSync("ps", ["-o", "comm=", "-p", String(processId)], {
        encoding: "utf8",
      }).trim();
    },
  };
}

/**
 * The app bundle to open: the preset's explicit bundle (EGO_EDGE_APP), else
 * the app in /Applications or ~/Applications (where users without admin
 * rights install), else its name. `open -a` resolves a name through
 * LaunchServices, which misses an app installed moments ago.
 */
export function macApp(browser, exists = existsSync) {
  const bundles = [
    browser.macAppBundle,
    `/Applications/${browser.app}.app`,
    join(homedir(), "Applications", `${browser.app}.app`),
  ].filter(Boolean);
  return bundles.find((bundle) => exists(bundle)) ?? browser.app;
}

function windows(browser) {
  return {
    async start(args) {
      const executable = windowsExecutable(browser);
      await new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
          detached: true,
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("spawn", resolve);
        child.unref();
      });
    },
    async isRunning() {
      return (await mainProcesses(browser)).length > 0;
    },
    /** taskkill without /F closes the windows, so the session is saved. */
    async quit() {
      for (const { processId } of await mainProcesses(browser))
        await run("taskkill", ["/PID", String(processId)]).catch(() => {});
    },
    /** Edge keeps background processes (Startup boost) after its windows close. */
    async forceQuit() {
      for (const { processId } of await mainProcesses(browser))
        await run("taskkill", ["/F", "/T", "/PID", String(processId)]).catch(
          () => {},
        );
    },
    executableOf(processId) {
      const path = powershellSync(
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(processId)}").ExecutablePath`,
      ).trim();
      return path || windowsExecutable(browser);
    },
  };
}

/** The first installed executable among the preset's candidates. */
export function windowsExecutable(browser, exists = existsSync) {
  const found = browser.windowsExecutables.find((path) => exists(path));
  if (!found)
    throw new Error(
      `${browser.app} was not found. Looked in:\n  ${browser.windowsExecutables.join("\n  ")}\n` +
        "Install it, or set EGO_EDGE_EXE to the full path of msedge.exe.",
    );
  return found;
}

/**
 * Browser main processes (not renderers or helpers, which carry --type=) of
 * this preset: on its user data dir when it has its own, else any.
 */
async function mainProcesses(browser) {
  const image = basename(windowsExecutable(browser));
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='${image}'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true },
  ).catch(() => ({ stdout: "" }));
  return selectMainProcesses(stdout, browser);
}

/** Exported for tests: parses ConvertTo-Json output of Win32_Process rows. */
export function selectMainProcesses(json, browser) {
  if (!json.trim()) return [];
  const parsed = JSON.parse(json);
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    processId: row.ProcessId,
    commandLine: row.CommandLine ?? "",
  }));
  const wantedDir = normalizeWindowsPath(browser.userDataDir);
  return rows.filter(({ commandLine }) => {
    if (/\s--type=/.test(commandLine)) return false;
    const dir = userDataDirOf(commandLine);
    return browser.customUserDataDir
      ? dir !== undefined && normalizeWindowsPath(dir) === wantedDir
      : dir === undefined;
  });
}

// Node quotes a spaced argument whole ("--user-data-dir=C:\a b"); other
// launchers quote only the value (--user-data-dir="C:\a b").
const USER_DATA_DIR_FORMS = [
  /"--user-data-dir=([^"]+)"/,
  /--user-data-dir="([^"]+)"/,
  /--user-data-dir=(\S+)/,
];

function userDataDirOf(commandLine) {
  for (const form of USER_DATA_DIR_FORMS) {
    const match = form.exec(commandLine);
    if (match) return match[1];
  }
  return undefined;
}

function normalizeWindowsPath(path) {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function powershellSync(command) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
}
