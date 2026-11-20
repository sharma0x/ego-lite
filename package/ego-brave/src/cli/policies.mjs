import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Enterprise policies that stop agents on a managed (company) browser. IT
 * sets them in the registry on Windows and as managed preferences on macOS;
 * edge://policy shows the same values. Policy names are shared by every
 * Chromium browser, only the location differs.
 */
const LOCATIONS = {
  edge: {
    registry: "SOFTWARE\\Policies\\Microsoft\\Edge",
    macDomain: "com.microsoft.Edge",
    page: "edge://policy",
  },
  brave: {
    registry: "SOFTWARE\\Policies\\BraveSoftware\\Brave",
    macDomain: "com.brave.Browser",
    page: "brave://policy",
  },
};

/**
 * @returns {Promise<{ page: string, findings: { ok: boolean, label: string, detail: string }[] } | undefined>}
 *   undefined when this browser has no known policy location.
 */
export async function checkPolicies(browser, platform = process.platform) {
  const location = LOCATIONS[browser.name];
  if (!location) return undefined;
  const policies =
    platform === "win32"
      ? await readWindowsPolicies(location.registry)
      : await readMacPolicies(location.macDomain);
  return { page: location.page, findings: evaluatePolicies(policies) };
}

/** Pure: which policies block remote debugging or the unpacked extension. */
export function evaluatePolicies(policies) {
  const findings = [];
  const block = (label, detail) => findings.push({ ok: false, label, detail });
  if (isOff(policies.RemoteDebuggingAllowed))
    block(
      "RemoteDebuggingAllowed",
      "remote debugging is turned off; agents cannot connect at all",
    );
  if (Number(policies.DeveloperToolsAvailability) === 2)
    block(
      "DeveloperToolsAvailability = 2",
      "DevTools are blocked, which also blocks remote debugging",
    );
  if (Number(policies.ExtensionDeveloperModeSettings) === 1)
    block(
      "ExtensionDeveloperModeSettings = 1",
      "Developer mode is forbidden, so the Agent Spaces extension cannot load",
    );
  const blocklist = asList(policies.ExtensionInstallBlocklist);
  if (blocklist.includes("*"))
    block(
      "ExtensionInstallBlocklist = *",
      "all extensions not on the allowlist are blocked, including the Agent Spaces extension",
    );
  const allowedTypes = asList(policies.ExtensionAllowedTypes);
  if (allowedTypes.length > 0 && !allowedTypes.includes("extension"))
    block(
      "ExtensionAllowedTypes",
      `only ${allowedTypes.join(", ")} may be installed, not extensions`,
    );
  if (findings.length === 0)
    findings.push({
      ok: true,
      label: "no blocking enterprise policy",
      detail: Object.keys(policies).length
        ? `${Object.keys(policies).length} managed policies, none blocking`
        : "browser is not managed",
    });
  return findings;
}

/**
 * Pure: `reg query <key> /s` output to { name: value }. List policies are
 * subkeys whose values are numbered entries; they become arrays.
 */
export function parseRegQuery(output, rootKey) {
  const policies = {};
  let listName;
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      const subkey = line.slice(line.indexOf(rootKey) + rootKey.length);
      listName = subkey.replace(/^\\/, "") || undefined;
      if (listName) policies[listName] ??= [];
      continue;
    }
    const match = /^\s+(\S+)\s+(REG_\w+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, type, raw] = match;
    const value = type === "REG_DWORD" ? Number.parseInt(raw, 16) : raw.trim();
    if (listName) policies[listName].push(value);
    else policies[name] = value;
  }
  return policies;
}

async function readWindowsPolicies(key) {
  const merged = {};
  for (const hive of ["HKCU", "HKLM"]) {
    const { stdout } = await run("reg", ["query", `${hive}\\${key}`, "/s"], {
      windowsHide: true,
    }).catch(() => ({ stdout: "" }));
    Object.assign(merged, parseRegQuery(stdout, key));
  }
  return merged;
}

async function readMacPolicies(domain) {
  const merged = {};
  const files = [
    `/Library/Managed Preferences/${domain}.plist`,
    `/Library/Managed Preferences/${userInfo().username}/${domain}.plist`,
  ];
  for (const file of files.filter((path) => existsSync(path))) {
    const { stdout } = await run("plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      file,
    ]).catch(() => ({ stdout: "{}" }));
    Object.assign(merged, JSON.parse(stdout || "{}"));
  }
  return merged;
}

function isOff(value) {
  return value === 0 || value === false || value === "false";
}

function asList(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
