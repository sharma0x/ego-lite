import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePolicies, parseRegQuery } from "../src/cli/policies.mjs";

const KEY = "SOFTWARE\\Policies\\Microsoft\\Edge";

test("parses reg query output, turning list subkeys into arrays", () => {
  const output = [
    "",
    `HKEY_LOCAL_MACHINE\\${KEY}`,
    "    RemoteDebuggingAllowed    REG_DWORD    0x0",
    "    HomepageLocation    REG_SZ    https://intranet.example",
    "",
    `HKEY_LOCAL_MACHINE\\${KEY}\\ExtensionInstallBlocklist`,
    "    1    REG_SZ    *",
    "",
  ].join("\r\n");
  assert.deepEqual(parseRegQuery(output, KEY), {
    RemoteDebuggingAllowed: 0,
    HomepageLocation: "https://intranet.example",
    ExtensionInstallBlocklist: ["*"],
  });
});

test("an unmanaged browser has no blocking policy", () => {
  assert.deepEqual(evaluatePolicies({}), [
    {
      ok: true,
      label: "no blocking enterprise policy",
      detail: "browser is not managed",
    },
  ]);
});

test("flags every policy that blocks agents", () => {
  const labels = evaluatePolicies({
    RemoteDebuggingAllowed: false,
    DeveloperToolsAvailability: 2,
    ExtensionDeveloperModeSettings: 1,
    ExtensionInstallBlocklist: ["*"],
    ExtensionAllowedTypes: ["theme"],
  }).map((finding) => finding.ok || finding.label);
  assert.deepEqual(labels, [
    "RemoteDebuggingAllowed",
    "DeveloperToolsAvailability = 2",
    "ExtensionDeveloperModeSettings = 1",
    "ExtensionInstallBlocklist = *",
    "ExtensionAllowedTypes",
  ]);
});

test("allowed debugging and extension policies pass", () => {
  const [finding] = evaluatePolicies({
    RemoteDebuggingAllowed: 1,
    DeveloperToolsAvailability: 1,
    ExtensionAllowedTypes: ["extension", "theme"],
  });
  assert.equal(finding.ok, true);
});
