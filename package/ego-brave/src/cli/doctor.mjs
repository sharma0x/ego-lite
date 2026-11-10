import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { BridgeDirectory } from "../profiles/bridge-directory.mjs";
import { ProfileCatalog } from "../profiles/profile-catalog.mjs";
import { assertHarnessBuilt } from "./harness.mjs";
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

  let channel;
  try {
    channel = await CdpChannel.connect();
    const client = new CdpClient(channel);
    const { product } = await client.call("Browser.getVersion");
    report(true, "browser reachable over CDP", product);
    const profiles = ProfileCatalog.load();
    const defaultProfile = profiles.resolve(undefined);
    const router = createProfileRouter({
      client,
      profiles,
      browserProcessId: await browserProcessIdOf(client),
    });
    await router.ensureProfile(defaultProfile.id);
    const { taskSpaces } = await router.call("listSpaces");
    report(
      true,
      "ego-brave extension",
      `default profile "${defaultProfile.name}" (${defaultProfile.id}), ${taskSpaces.length} Space(s)`,
    );
    await reportProfiles(output, profiles, new BridgeDirectory(client));
    return 0;
  } catch (error) {
    report(false, "browser/extension", error.message);
    return 1;
  } finally {
    channel?.close();
  }
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
