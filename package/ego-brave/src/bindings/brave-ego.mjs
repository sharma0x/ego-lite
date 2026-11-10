import {
  ErrorCode,
  codedError,
  codedTypeError,
  errorResult,
  isErrorResult,
} from "../errors.mjs";
import { SnapshotRootNotFoundError } from "../snapshot/ax-snapshot.mjs";
import {
  expectArity,
  expectNumber,
  expectOptionalString,
  expectString,
} from "./arguments.mjs";
import { HarnessCdpBridge } from "./harness-cdp-bridge.mjs";
import { SpaceControl } from "./space-control.mjs";

// Brave has one profile from the adapter's point of view: the one it was
// started with. Spaces share its cookies and logins.
const BROWSER_PROFILE = Object.freeze({
  id: "Default",
  name: "Brave",
  isDefault: true,
});
const DEFAULT_PROFILE_ALIASES = new Set(["", "default", BROWSER_PROFILE.id]);

/**
 * Implements Ego Lite's `globalThis.ego` contract (docs/native-bindings-api.md)
 * on top of a CDP browser and the ego-brave extension. Facade over:
 *   - ExtensionRpc     Spaces, tabs, tab groups, ownership
 *   - SnapshotService  native-format page snapshots
 *   - HarnessCdpBridge the harness's raw CDP traffic
 */
export class BraveEgo {
  #rpc;
  #snapshots;
  #control;
  #cdp;
  #browserVersion;

  /** The plain object installed as globalThis.ego. */
  bindings;

  constructor({ harnessChannel, rpc, snapshots, browserVersion }) {
    this.#rpc = rpc;
    this.#snapshots = snapshots;
    this.#browserVersion = browserVersion;
    this.#control = new SpaceControl(rpc);
    this.bindings = this.#createBindings();
    this.#cdp = new HarnessCdpBridge({
      channel: harnessChannel,
      control: this.#control,
      callbacks: this.bindings,
      activateTarget: (targetId) =>
        this.#spaceCall("activateTab", { targetId }),
    });
  }

  #createBindings() {
    // Own enumerable function properties: the harness wraps and re-exposes
    // them by iterating Object.keys(ego).
    return {
      getBrowserVersion: (...args) => this.#getBrowserVersion(args),
      useTaskSpace: (...args) => this.#useTaskSpace(args),
      listProfiles: (...args) => this.#listProfiles(args),
      createTab: (...args) => this.#createTab(args),
      listTabs: (...args) => this.#listTabs(args),
      snapshot: (...args) => this.#snapshot(args),
      listTaskSpaces: (...args) => this.#listTaskSpaces(args),
      createTaskSpace: (...args) => this.#createTaskSpace(args),
      claimTaskSpace: (...args) => this.#claimTaskSpace(args),
      closeTaskSpace: (...args) =>
        this.#lifecycle("closeTaskSpace", "closeSpace", args),
      completeTaskSpace: (...args) =>
        this.#lifecycle("completeTaskSpace", "completeSpace", args),
      handOffTaskSpace: (...args) =>
        this.#transferControl("handOffTaskSpace", "handOff", args),
      takeOverTaskSpace: (...args) =>
        this.#transferControl("takeOverTaskSpace", "takeOver", args),
      setAgentTaskState: (...args) => this.#setAgentTaskState(args),
      animationHighlightMouseToPosition: (...args) => this.#highlight(args),
      sendCDPMessage: (...args) => this.#sendCDPMessage(args),
      onCDPMessage: undefined,
      onSendCDPMessageError: undefined,
    };
  }

  async #getBrowserVersion(args) {
    expectArity("getBrowserVersion", args, 0);
    return { currentVersion: this.#browserVersion, updateAvailable: false };
  }

  #useTaskSpace(args) {
    expectArity("useTaskSpace", args, 1);
    expectNumber("useTaskSpace", "id", args[0]);
    return this.#control.select(args[0]);
  }

  async #listProfiles(args) {
    expectArity("listProfiles", args, 0);
    return { profiles: [{ ...BROWSER_PROFILE }] };
  }

  async #createTab(args) {
    expectArity("createTab", args, 1);
    expectString("createTab", "url", args[0]);
    return this.#asAgent(() => this.#spaceCall("createTab", { url: args[0] }));
  }

  async #listTabs(args) {
    expectArity("listTabs", args, 0);
    return this.#asAgent(() => this.#spaceCall("listTabs"));
  }

  async #snapshot(args) {
    expectArity("snapshot", args, 0, 1);
    const blocker = await this.#control.agentBlocker();
    if (blocker) throw codedError(blocker.error_code, blocker.error);
    const active = await this.#spaceCall("activeTarget");
    if (isErrorResult(active))
      throw codedError(active.error_code, active.error);
    try {
      return await this.#snapshots.capture(active.targetId, args[0] ?? {});
    } catch (error) {
      const code =
        error instanceof SnapshotRootNotFoundError
          ? ErrorCode.SNAPSHOT_FAILED
          : ErrorCode.WEB_CONTENTS_UNAVAILABLE;
      throw codedError(error.error_code ?? code, error.message);
    }
  }

  async #listTaskSpaces(args) {
    expectArity("listTaskSpaces", args, 0);
    return this.#rpc.call("listSpaces");
  }

  async #createTaskSpace(args) {
    expectArity("createTaskSpace", args, 1, 2);
    const [name, profileId] = args;
    expectString("createTaskSpace", "name", name, { nonEmpty: true });
    expectOptionalString("createTaskSpace", "profileId", profileId);
    if (profileId !== undefined && !DEFAULT_PROFILE_ALIASES.has(profileId)) {
      return errorResult(ErrorCode.PROFILE_NOT_FOUND, "Profile not found");
    }
    return this.#rpc.call("createSpace", { name });
  }

  async #claimTaskSpace(args) {
    expectArity("claimTaskSpace", args, 1, 2);
    const [spaceId, name] = args;
    expectNumber("claimTaskSpace", "id", spaceId);
    expectOptionalString("claimTaskSpace", "name", name);
    const result = await this.#rpc.call("claimSpace", { spaceId, name });
    this.#control.invalidate(spaceId);
    return result;
  }

  async #lifecycle(method, operation, args) {
    expectArity(method, args, 0);
    const result = await this.#asAgent(() => this.#spaceCall(operation));
    this.#control.invalidate();
    return result;
  }

  async #transferControl(method, operation, args) {
    expectArity(method, args, 0);
    const unselected = this.#control.selectionBlocker();
    if (unselected) return unselected;
    const result = await this.#spaceCall(operation);
    this.#control.invalidate();
    return result;
  }

  async #setAgentTaskState(args) {
    expectArity("setAgentTaskState", args, 1);
    expectString("setAgentTaskState", "state", args[0]);
    return this.#asAgent(() => this.#spaceCall("setState", { state: args[0] }));
  }

  async #highlight(args) {
    expectArity("animationHighlightMouseToPosition", args, 2);
    expectNumber("animationHighlightMouseToPosition", "x", args[0]);
    expectNumber("animationHighlightMouseToPosition", "y", args[1]);
    return this.#asAgent(
      async () => `${this.#control.selectedId} mouse highlight shown.`,
    );
  }

  #sendCDPMessage(args) {
    expectArity("sendCDPMessage", args, 1);
    expectString("sendCDPMessage", "message", args[0]);
    if (!this.#cdp.isOpen)
      throw codedTypeError(
        ErrorCode.CDP_CHANNEL_UNAVAILABLE,
        "CDP channel is not connected",
      );
    this.#cdp.send(args[0]);
  }

  async #asAgent(operation) {
    const blocker = await this.#control.agentBlocker();
    return blocker ?? operation();
  }

  #spaceCall(operation, args = {}) {
    return this.#rpc.call(operation, {
      spaceId: this.#control.selectedId,
      ...args,
    });
  }
}
