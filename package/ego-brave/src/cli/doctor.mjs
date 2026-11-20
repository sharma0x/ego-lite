import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { BridgeDirectory } from "../profiles/bridge-directory.mjs";
import { ProfileCatalog } from "../profiles/profile-catalog.mjs";
import { BROWSER, stagedExtensionIsStale } from "./browser.mjs";
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
    const router = createProfileRouter({ client, profiles, browserProcessId });
    await router.ensureProfile(defaultProfile.id);
    const extensionCurrent = reportStagedExtension(report);
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
 * A staged copy (Edge) is refreshed only when the browser starts; profiles
 * then reload onto it on first use (BridgeDirectory). In-place copies need
 * nothing here.
 * @returns {boolean} false when a restart is still needed
 */
function reportStagedExtension(report) {
  if (!stagedExtensionIsStale(BROWSER)) return true;
  report(
    false,
    "Agent Spaces extension is out of date",
    `run \`${BROWSER.command} launch --restart\` to load the new version (tabs are restored)`,
  );
  return false;
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
