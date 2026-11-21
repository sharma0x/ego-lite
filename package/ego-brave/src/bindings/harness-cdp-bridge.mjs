import { ErrorCode, isErrorResult } from "../errors.mjs";

const USER_CONTROL_MESSAGE = "The task is under user control";
// Ids for the bridge's own commands, far above the harness's counter, so
// their replies can be told apart and kept from the harness.
const OWN_ID_BASE = 2 ** 30;

/**
 * Passes the harness's raw CDP traffic to the browser in send order, applying
 * the native rules: no traffic without a selected agent-owned Space, failures
 * reported through onSendCDPMessageError, and Target.activateTarget handled
 * by the extension so the agent never raises a window over the user's work.
 *
 * Agents share one window, so most of their tabs are in the background.
 * Every page the harness attaches to gets focus emulation: it then reports
 * itself visible and focused, so animation frames, lazy loading and focus
 * handlers keep working there, as in the selected tab.
 */
export class HarnessCdpBridge {
  #channel;
  #control;
  #activateTarget;
  #callbacks;
  #outbox = Promise.resolve();
  #nextOwnId = OWN_ID_BASE;

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
    const message = JSON.parse(rawMessage);
    if (message.id >= OWN_ID_BASE) return;
    if (
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.type === "page"
    )
      this.#emulateFocus(message.params.sessionId);
    const callback = this.#callbacks.onCDPMessage;
    if (typeof callback === "function") callback(rawMessage);
  }

  #emulateFocus(sessionId) {
    this.#nextOwnId += 1;
    this.#channel.send(
      JSON.stringify({
        id: this.#nextOwnId,
        method: "Emulation.setFocusEmulationEnabled",
        params: { enabled: true },
        sessionId,
      }),
    );
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
