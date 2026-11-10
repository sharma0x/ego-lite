import { execFileSync } from "node:child_process";

import { BraveEgo } from "../bindings/brave-ego.mjs";
import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { traced } from "../cdp/tracing-channel.mjs";
import { BridgeDirectory } from "../profiles/bridge-directory.mjs";
import { ProfileCatalog } from "../profiles/profile-catalog.mjs";
import { ProfileOpener } from "../profiles/profile-opener.mjs";
import { ProfileRouter } from "../profiles/profile-router.mjs";
import { SnapshotService } from "../snapshot/snapshot-service.mjs";

const ADAPTER_VERSION = "0.2.0";

/**
 * Composition root: opens the two CDP connections (harness passthrough and
 * the adapter's private control channel) and wires the native bindings.
 */
export async function openSession() {
  const [harnessChannel, controlChannel] = (
    await Promise.all([CdpChannel.connect(), CdpChannel.connect()])
  ).map((channel, index) =>
    traced(channel, index === 0 ? "harness" : "control"),
  );
  const client = new CdpClient(controlChannel);
  try {
    const [browser, browserProcessId] = await Promise.all([
      client.call("Browser.getVersion"),
      browserProcessIdOf(client),
    ]);
    const profiles = ProfileCatalog.load();
    const ego = new BraveEgo({
      harnessChannel,
      rpc: createProfileRouter({ client, profiles, browserProcessId }),
      profiles,
      snapshots: new SnapshotService(client),
      browserVersion: `ego-brave ${ADAPTER_VERSION} (${browser.product})`,
    });
    return {
      bindings: ego.bindings,
      browserProcessId,
      close: () => closeAll(harnessChannel, controlChannel),
    };
  } catch (error) {
    closeAll(harnessChannel, controlChannel);
    throw error;
  }
}

export function createProfileRouter({ client, profiles, browserProcessId }) {
  const directory = new BridgeDirectory(client);
  const opener = new ProfileOpener({
    client,
    catalog: profiles,
    directory,
    browserExecutable: executableOf(browserProcessId),
  });
  return new ProfileRouter({ catalog: profiles, directory, opener });
}

export async function browserProcessIdOf(client) {
  const { processInfo } = await client.call("SystemInfo.getProcessInfo");
  const browser = processInfo.find((process) => process.type === "browser");
  if (!browser)
    throw new Error("SystemInfo.getProcessInfo reported no browser process");
  return browser.id;
}

/** The running browser's binary; launching it hands arguments to that instance. */
function executableOf(processId) {
  return execFileSync("ps", ["-o", "comm=", "-p", String(processId)], {
    encoding: "utf8",
  }).trim();
}

function closeAll(...channels) {
  for (const channel of channels) channel.close();
}
