import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { BridgeDirectory } from "../profiles/bridge-directory.mjs";
import { ProfileCatalog } from "../profiles/profile-catalog.mjs";
import { reloadExtensions } from "../extension/extension-reload.mjs";
import {
  BROWSER,
  EXTENSION_DIR,
  inPlaceExtensionState,
  stagedExtensionIsStale,
} from "./browser.mjs";
import { assertHarnessBuilt } from "./harness.mjs";
import { checkPolicies } from "./policies.mjs";
import { browserProcessIdOf, createProfileRouter } from "./session.mjs";

/**
 * Check every dependency in order and print the fix for the first failure.
 * Also the setup step: it prepares the default profile, so the one-time
 * profile switch never happens in the middle of an agent's task.
 */
export async function runDoctor(output = process.stdout) {
  const report = (ok, label, detail) =>
    output.write(
      `${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}\n`,
    );
  try {
    assertHarnessBuilt();
    report(true, "harness bundle built");
  } catch (error) {
    report(false, "harness bundle", error.message);
    return 1;
  }

  const policiesBlock = await reportPolicies(report);

  let channel;
  try {
    channel = await CdpChannel.connect();
    const client = new CdpClient(channel);
    const { product } = await client.call("Browser.getVersion");
    report(true, "browser reachable over CDP", product);
    const profiles = ProfileCatalog.load();
    const defaultProfile = profiles.resolve(undefined);
    const browserProcessId = await browserProcessIdOf(client);
    const newRouter = () =>
      createProfileRouter({ client, profiles, browserProcessId });
    // Setting up the profile first guarantees the extension is running, so
    // a reload (which replaces its bridge) is never skipped or raced.
    await newRouter().ensureProfile(defaultProfile.id);
    const extensionCurrent = await refreshExtension(client, report);
    const router = newRouter();
    await router.ensureProfile(defaultProfile.id);
    const { taskSpaces } = await router.call("listSpaces");
    report(
      true,
      "ego-brave extension",
      `default profile "${defaultProfile.name}" (${defaultProfile.id}), ${taskSpaces.length} Space(s)`,
    );
    await reportProfiles(output, profiles, new BridgeDirectory(client));
    return policiesBlock || !extensionCurrent ? 1 : 0;
  } catch (error) {
    report(false, "browser/extension", error.message);
    return 1;
  } finally {
    channel?.close();
  }
}

/**
 * Makes the browser run the extension code on disk: Chromium keeps a cached
 * service worker until the extension is reloaded. A staged copy (Edge) is
 * only replaced by a restart; an in-place one (Brave) is reloaded here.
 * @returns {Promise<boolean>} false when a restart is still needed
 */
async function refreshExtension(client, report) {
  if (BROWSER.extensionDir !== EXTENSION_DIR) {
    if (!stagedExtensionIsStale(BROWSER)) return true;
    report(
      false,
      "Agent Spaces extension is out of date",
      `run \`${BROWSER.command} launch --restart\` to load the new version (tabs are restored)`,
    );
    return false;
  }
  const state = inPlaceExtensionState(BROWSER);
  if (!state.changed) return true;
  const reloaded = await reloadExtensions(client);
  state.record();
  if (reloaded > 0)
    report(true, "Agent Spaces extension reloaded with the latest code");
  return true;
}

/** @returns {Promise<boolean>} true when a policy blocks agents */
async function reportPolicies(report) {
  const result = await checkPolicies(BROWSER).catch((error) => ({
    findings: [
      { ok: true, label: "policy check skipped", detail: error.message },
    ],
  }));
  if (!result) return false;
  for (const { ok, label, detail } of result.findings)
    report(ok, `policy: ${label}`, detail);
  const blocked = result.findings.some((finding) => !finding.ok);
  if (blocked)
    report(
      false,
      "managed browser",
      `your IT department controls these settings (see ${result.page}); ask them to allow remote debugging and unpacked extensions for this browser`,
    );
  return blocked;
}

async function reportProfiles(output, profiles, directory) {
  const ready = await directory.all();
  output.write("profiles (set up on first use):\n");
  for (const profile of profiles.list()) {
    const marks = [
      profile.isDefault && "default",
      ready.has(profile.id) && "set up",
    ]
      .filter(Boolean)
      .join(", ");
    output.write(
      `  ${profile.id.padEnd(11)} ${profile.name}${marks ? `  [${marks}]` : ""}\n`,
    );
  }
}
