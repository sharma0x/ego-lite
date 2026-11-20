import assert from "node:assert/strict";
import { test } from "node:test";

import { launchFlags } from "../src/cli/launch.mjs";
import { selectMainProcesses, windowsExecutable } from "../src/cli/platform.mjs";

const edge = {
  app: "Microsoft Edge",
  port: 9444,
  userDataDir: "C:\\Users\\me\\AppData\\Local\\ego-edge\\User Data",
  customUserDataDir: true,
  windowsExecutables: ["C:\\missing\\msedge.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  extraFlags: ["--no-default-browser-check"],
};

test("finds only the agent Edge's main process among Win32_Process rows", () => {
  const rows = [
    { ProcessId: 10, CommandLine: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --profile-directory=Default' },
    { ProcessId: 11, CommandLine: '"C:\\...\\msedge.exe" --remote-debugging-port=9444 "--user-data-dir=C:\\Users\\me\\AppData\\Local\\ego-edge\\User Data"' },
    { ProcessId: 12, CommandLine: '"C:\\...\\msedge.exe" --user-data-dir="c:\\users\\me\\appdata\\local\\ego-edge\\User Data\\" --remote-debugging-port=9444' },
    { ProcessId: 13, CommandLine: '"C:\\...\\msedge.exe" --type=renderer --user-data-dir="C:\\Users\\me\\AppData\\Local\\ego-edge\\User Data"' },
    { ProcessId: 14, CommandLine: null },
  ];
  assert.deepEqual(
    selectMainProcesses(JSON.stringify(rows), edge).map((row) => row.processId),
    [11, 12],
  );
  assert.deepEqual(
    selectMainProcesses(JSON.stringify(rows[0]), { ...edge, customUserDataDir: false }).map((row) => row.processId),
    [10],
  );
  assert.deepEqual(selectMainProcesses("", edge), []);
});

test("uses the first installed Edge executable and explains when none is", () => {
  assert.equal(windowsExecutable(edge, (path) => !path.includes("missing")), edge.windowsExecutables[1]);
  assert.throws(() => windowsExecutable(edge, () => false), /EGO_EDGE_EXE/);
});

test("an agent Edge runs on its own user data dir with debugging and no throttling", () => {
  assert.deepEqual(launchFlags(edge), [
    "--remote-debugging-port=9444",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    `--user-data-dir=${edge.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--profile-directory=Default",
  ]);
});

test("staging bumps the extension version only when its sources change", async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { stageExtension, stagedExtensionIsStale } = await import("../src/cli/browser.mjs");
  const root = mkdtempSync(join(tmpdir(), "ego-stage-"));
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(join(source, "manifest.json"), JSON.stringify({ version: "0.1.0" }));
  writeFileSync(join(source, "background.js"), "// v1");
  const browser = { extensionDir: join(root, "edge", "extension") };
  const stagedVersion = () => JSON.parse(readFileSync(join(browser.extensionDir, "manifest.json"), "utf8")).version;

  assert.equal(stagedExtensionIsStale(browser, source), true);
  stageExtension(browser, source);
  assert.equal(stagedVersion(), "0.1.0.1");
  assert.equal(stagedExtensionIsStale(browser, source), false);
  stageExtension(browser, source);
  assert.equal(stagedVersion(), "0.1.0.1");
  writeFileSync(join(source, "background.js"), "// v2");
  assert.equal(stagedExtensionIsStale(browser, source), true);
  stageExtension(browser, source);
  assert.equal(stagedVersion(), "0.1.0.2");
  assert.equal(JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")).version, "0.1.0");
});
