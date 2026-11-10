import { ErrorCode, isErrorResult } from "../errors.mjs";

const USER_CONTROL_MESSAGE = "The task is under user control";

/**
 * Passes the harness's raw CDP traffic to the browser in send order, applying
 * the native rules: no traffic without a selected agent-owned Space, failures
 * reported through onSendCDPMessageError, and Target.activateTarget handled
 * by the extension so the agent never raises a window over the user's work.
 */
export class HarnessCdpBridge {
  #channel;
  #control;
  #activateTarget;
  #callbacks;
  #outbox = Promise.resolve();

  /**
   * @param {object} deps
   * @param {import("../cdp/cdp-channel.mjs").CdpChannel} deps.channel
   * @param {import("./space-control.mjs").SpaceControl} deps.control
   * @param {(targetId: string) => Promise<object>} deps.activateTarget
   * @param {{ onCDPMessage?: Function, onSendCDPMessageError?: Function }} deps.callbacks
   *   the binding object; the harness assigns its callbacks onto it.
   */
  constructor({ channel, control, activateTarget, callbacks }) {
    this.#channel = channel;
    this.#control = control;
    this.#activateTarget = activateTarget;
    this.#callbacks = callbacks;
    channel.onMessage((raw) => this.#deliver(raw));
  }

  get isOpen() {
    return this.#channel.isOpen;
  }

  send(rawMessage) {
    this.#outbox = this.#outbox
      .then(() => this.#forward(rawMessage))
      .catch((error) =>
        this.#fail(
          error.message,
          error.error_code ?? ErrorCode.CDP_SEND_FAILED,
        ),
      );
  }

  async #forward(rawMessage) {
    const blocker = await this.#control.agentBlocker();
    if (blocker)
      return this.#fail(describeBlocker(blocker), blocker.error_code);
    const message = JSON.parse(rawMessage);
    if (message.method === "Target.activateTarget")
      return this.#activateInSpace(message);
    this.#channel.send(rawMessage);
  }

  async #activateInSpace(message) {
    const result = await this.#activateTarget(message.params?.targetId);
    const reply = isErrorResult(result)
      ? { id: message.id, error: { code: -32000, message: result.error } }
      : { id: message.id, result: {} };
    if (message.sessionId) reply.sessionId = message.sessionId;
    this.#deliver(JSON.stringify(reply));
  }

  #deliver(rawMessage) {
    const callback = this.#callbacks.onCDPMessage;
    if (typeof callback === "function") callback(rawMessage);
  }

  #fail(message, errorCode) {
    const callback = this.#callbacks.onSendCDPMessageError;
    if (typeof callback === "function") callback(message, errorCode);
  }
}

// The native callback carries no reason key; the harness probes
// setAgentTaskState() for it, so the message stays generic here.
function describeBlocker(blocker) {
  return blocker.error_code === ErrorCode.TASK_SPACE_USER_IN_CONTROL
    ? USER_CONTROL_MESSAGE
    : blocker.error;
}
