import { CdpChannel } from "../cdp/cdp-channel.mjs";
import { CdpClient } from "../cdp/cdp-client.mjs";
import { connectExtension } from "../extension/extension-loader.mjs";
import { assertHarnessBuilt } from "./harness.mjs";

/** Check every dependency in order and print the fix for the first failure. */
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
    const rpc = await connectExtension(client);
    const { taskSpaces } = await rpc.call("listSpaces");
    report(true, "ego-brave extension bridge", `${taskSpaces.length} Space(s)`);
    return 0;
  } catch (error) {
    report(false, "browser/extension", error.message);
    return 1;
  } finally {
    channel?.close();
  }
}
