import { ErrorCode, codedError } from "../errors.mjs";

import { BROWSER, CDP_ENDPOINT } from "../cli/browser.mjs";

/**
 * One browser-level CDP WebSocket. It forwards raw JSON both ways and knows
 * nothing about message ids or sessions, so the harness channel can stay a
 * byte-for-byte passthrough.
 */
export class CdpChannel {
  #socket;
  #listeners = new Set();
  #closeListeners = new Set();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) =>
      this.#emit(String(event.data)),
    );
    socket.addEventListener("close", () =>
      this.#closeListeners.forEach((listener) => listener()),
    );
  }

  static async connect(endpoint = CDP_ENDPOINT) {
    const webSocketUrl = await resolveBrowserWebSocketUrl(endpoint);
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(unreachable(endpoint)), {
        once: true,
      });
    });
    return new CdpChannel(socket);
  }

  get isOpen() {
    return this.#socket.readyState === WebSocket.OPEN;
  }

  send(rawMessage) {
    if (!this.isOpen)
      throw codedError(
        ErrorCode.CDP_CHANNEL_UNAVAILABLE,
        "CDP channel is not connected",
      );
    this.#socket.send(rawMessage);
  }

  onMessage(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener) {
    this.#closeListeners.add(listener);
  }

  close() {
    this.#socket.close();
  }

  #emit(rawMessage) {
    for (const listener of this.#listeners) listener(rawMessage);
  }
}

async function resolveBrowserWebSocketUrl(endpoint) {
  if (/^wss?:\/\//.test(endpoint)) return endpoint;
  try {
    const response = await fetch(new URL("/json/version", endpoint));
    const { webSocketDebuggerUrl } = await response.json();
    if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
  } catch {
    // Fall through to the actionable error below.
  }
  throw unreachable(endpoint);
}

function unreachable(endpoint) {
  return codedError(
    ErrorCode.BROWSER_UNAVAILABLE,
    `No browser is listening for CDP at ${endpoint}. Run \`${BROWSER.command} launch\`; if ${BROWSER.app} is open without debugging, ask the user, then run \`${BROWSER.command} launch --restart\` (tabs are restored).`,
  );
}
