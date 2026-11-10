/**
 * Decorates a CdpChannel to log each request and how long its reply took,
 * on stderr. Enabled with EGO_BRAVE_TRACE=1; useful when a harness call waits
 * on a reply that never comes.
 */
export class TracingChannel {
  #inner;
  #label;
  #started = new Map();
  #log;

  constructor(inner, label, log = (line) => process.stderr.write(`${line}\n`)) {
    this.#inner = inner;
    this.#label = label;
    this.#log = log;
    inner.onMessage((raw) => this.#traceReply(raw));
  }

  get isOpen() {
    return this.#inner.isOpen;
  }

  send(rawMessage) {
    const { id, method, params, sessionId } = JSON.parse(rawMessage);
    this.#started.set(id, { method, params, sessionId, at: performance.now() });
    this.#inner.send(rawMessage);
  }

  onMessage(listener) {
    return this.#inner.onMessage(listener);
  }

  onClose(listener) {
    this.#inner.onClose(listener);
  }

  close() {
    for (const [id, { method, params }] of this.#started) {
      this.#log(
        `[${this.#label}] #${id} ${method} NEVER ANSWERED ${JSON.stringify(params ?? {}).slice(0, 240)}`,
      );
    }
    this.#inner.close();
  }

  #traceReply(raw) {
    const { id, error } = JSON.parse(raw);
    const started = this.#started.get(id);
    if (!started) return;
    this.#started.delete(id);
    const elapsed = (performance.now() - started.at).toFixed(0);
    this.#log(
      `[${this.#label}] #${id} ${started.method} ${elapsed}ms${error ? ` ERROR ${error.message}` : ""}`,
    );
  }
}

export function traced(channel, label) {
  return process.env.EGO_BRAVE_TRACE === "1"
    ? new TracingChannel(channel, label)
    : channel;
}
