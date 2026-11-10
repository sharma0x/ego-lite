import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BridgeMissingError,
  ExtensionRpc,
  bridgeMissing,
} from "./extension-rpc.mjs";

const EXTENSION_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../extension",
);
const BRIDGE_WAIT_ATTEMPTS = 20;
const BRIDGE_WAIT_MS = 150;

/**
 * Connect to the extension, loading it first if the browser does not have it.
 * Extensions.loadUnpacked behaves like --load-extension: it lasts for one
 * browser run, so this heals the setup after every browser restart.
 */
export async function connectExtension(client) {
  const connected = await tryConnect(client);
  if (connected) return connected;
  try {
    await client.call("Extensions.loadUnpacked", { path: EXTENSION_DIR });
  } catch (error) {
    throw new BridgeMissingError(
      `${bridgeMissing().message} (automatic load failed: ${error.message})`,
    );
  }
  for (let attempt = 0; attempt < BRIDGE_WAIT_ATTEMPTS; attempt += 1) {
    await new Promise((settle) => setTimeout(settle, BRIDGE_WAIT_MS));
    const rpc = await tryConnect(client);
    if (rpc) return rpc;
  }
  throw bridgeMissing();
}

async function tryConnect(client) {
  try {
    return await ExtensionRpc.connect(client);
  } catch (error) {
    if (error instanceof BridgeMissingError) return undefined;
    throw error;
  }
}
