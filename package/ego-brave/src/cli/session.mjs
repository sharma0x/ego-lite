import { BraveEgo } from "../bindings/brave-ego.mjs";
import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { traced } from "../cdp/tracing-channel.mjs";
import { connectExtension } from "../extension/extension-loader.mjs";
import { SnapshotService } from "../snapshot/snapshot-service.mjs";

const ADAPTER_VERSION = "0.1.0";

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
    const [rpc, browser, browserProcessId] = await Promise.all([
      connectExtension(client),
      client.call("Browser.getVersion"),
      browserProcessIdOf(client),
    ]);
    const ego = new BraveEgo({
      harnessChannel,
      rpc,
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

async function browserProcessIdOf(client) {
  const { processInfo } = await client.call("SystemInfo.getProcessInfo");
  const browser = processInfo.find((process) => process.type === "browser");
  if (!browser)
    throw new Error("SystemInfo.getProcessInfo reported no browser process");
  return browser.id;
}

function closeAll(...channels) {
  for (const channel of channels) channel.close();
}
