import { ErrorCode, codedError } from "../errors.mjs";

const BRIDGE_PATH = "/offscreen.html";
const NOTIFY_BINDING = "egoBraveNotify";

/**
 * Calls into the ego-brave extension. The extension keeps an offscreen
 * document alive as a stable CDP target; evaluating in it forwards the call to
 * the service worker, which owns Spaces, tabs and tab groups. State changes
 * come back through a Runtime binding, so ownership updates are pushed rather
 * than polled.
 */
export class ExtensionRpc {
  #client;
  #sessionId;
  #listeners = new Set();

  constructor(client, sessionId) {
    this.#client = client;
    this.#sessionId = sessionId;
    client.onEvent((message) => this.#onCdpEvent(message));
  }

  static async connect(client) {
    const { targetInfos } = await client.call("Target.getTargets");
    const bridge = targetInfos.find((target) => isBridgeUrl(target.url));
    if (!bridge) throw bridgeMissing();
    const sessionId = await client.session(bridge.targetId);
    await client.call(
      "Runtime.addBinding",
      { name: NOTIFY_BINDING },
      sessionId,
    );
    return new ExtensionRpc(client, sessionId);
  }

  async call(operation, args = {}) {
    const expression = `globalThis.egoBrave.call(${JSON.stringify(operation)}, ${JSON.stringify(args)})`;
    const { result, exceptionDetails } = await this.#client.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.#sessionId,
    );
    if (exceptionDetails) {
      const detail =
        exceptionDetails.exception?.description ?? exceptionDetails.text;
      throw codedError(
        ErrorCode.OPERATION_FAILED,
        `ego-brave extension ${operation} failed: ${detail}`,
      );
    }
    return result?.value;
  }

  onEvent(listener) {
    this.#listeners.add(listener);
  }

  #onCdpEvent(message) {
    if (
      message.sessionId !== this.#sessionId ||
      message.method !== "Runtime.bindingCalled"
    )
      return;
    if (message.params.name !== NOTIFY_BINDING) return;
    const event = JSON.parse(message.params.payload);
    for (const listener of this.#listeners) listener(event);
  }
}

function isBridgeUrl(url) {
  return url.startsWith("chrome-extension://") && url.endsWith(BRIDGE_PATH);
}

export class BridgeMissingError extends Error {
  error_code = ErrorCode.BROWSER_UNAVAILABLE;
}

export function bridgeMissing() {
  return new BridgeMissingError(
    "The ego-brave extension is not running. Load package/ego-brave/extension via brave://extensions (Developer mode > Load unpacked), then run `ego-brave doctor`.",
  );
}
