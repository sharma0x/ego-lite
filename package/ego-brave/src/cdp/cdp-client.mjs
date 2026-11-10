const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Request/response CDP calls over a dedicated channel. The adapter's own work
 * (snapshots, extension calls) uses this so its message ids can never collide
 * with the harness's ids on the passthrough channel.
 */
export class CdpClient {
  #channel;
  #nextId = 1;
  #pending = new Map();
  #eventListeners = new Set();
  #sessions = new Map();

  constructor(channel) {
    this.#channel = channel;
    channel.onMessage((raw) => this.#dispatch(JSON.parse(raw)));
    channel.onClose(() => this.#rejectAll(new Error("CDP channel closed")));
  }

  call(method, params = {}, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.#settle(id, { error: { message: `${method} timed out` } }),
        timeoutMs,
      );
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#channel.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }

  /** Attach once per target; reuses the flattened session for the process lifetime. */
  async session(targetId) {
    if (!this.#sessions.has(targetId)) {
      const attaching = this.call("Target.attachToTarget", {
        targetId,
        flatten: true,
      }).then((result) => result.sessionId);
      attaching.catch(() => this.#sessions.delete(targetId));
      this.#sessions.set(targetId, attaching);
    }
    return this.#sessions.get(targetId);
  }

  onEvent(listener) {
    this.#eventListeners.add(listener);
  }

  #dispatch(message) {
    if (message.id !== undefined) return this.#settle(message.id, message);
    if (message.method === "Target.detachedFromTarget")
      this.#forgetSession(message.params.sessionId);
    for (const listener of this.#eventListeners) listener(message);
  }

  #settle(id, message) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result ?? {});
  }

  #forgetSession(sessionId) {
    for (const [targetId, attaching] of this.#sessions) {
      attaching.then(
        (id) => id === sessionId && this.#sessions.delete(targetId),
        () => {},
      );
    }
  }

  #rejectAll(error) {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }
}
