import { ErrorCode, errorResult, isErrorResult } from "../errors.mjs";
import { SPACE_ID_SPAN } from "../profiles/profile-catalog.mjs";

const DEFAULT_CONTROL_REASON = "manual_takeover";

/**
 * The selected Space for this invocation plus a cache of who controls each
 * Space. The extension pushes every ownership change, so the cache stays
 * current while the user clicks Take over / Hand back in the popup.
 */
export class SpaceControl {
  #rpc;
  #selectedId;
  #statusById = new Map();

  constructor(rpc) {
    this.#rpc = rpc;
    rpc.onEvent((event) => {
      if (event.type === "spaces") this.#replaceStatuses(event);
    });
  }

  get selectedId() {
    return this.#selectedId;
  }

  select(spaceId) {
    this.#selectedId = spaceId;
    return spaceId;
  }

  invalidate(spaceId = this.#selectedId) {
    this.#statusById.delete(spaceId);
  }

  /** @returns an error result when nothing is selected, otherwise undefined. */
  selectionBlocker() {
    if (this.#selectedId !== undefined) return undefined;
    return errorResult(
      ErrorCode.TASK_SPACE_NOT_SELECTED,
      "Task space not selected",
    );
  }

  /** @returns an error result when the agent may not automate the selected Space. */
  async agentBlocker() {
    const unselected = this.selectionBlocker();
    if (unselected) return unselected;
    const status = await this.#statusOf(this.#selectedId);
    if (isErrorResult(status)) return status;
    if (status.ownership === "agent") return undefined;
    return errorResult(
      ErrorCode.TASK_SPACE_USER_IN_CONTROL,
      status.reason ?? DEFAULT_CONTROL_REASON,
    );
  }

  async #statusOf(spaceId) {
    if (!this.#statusById.has(spaceId)) {
      this.#statusById.set(
        spaceId,
        await this.#rpc.call("spaceStatus", { spaceId }),
      );
    }
    return this.#statusById.get(spaceId);
  }

  /** Each profile reports only its own id block; leave other profiles' entries alone. */
  #replaceStatuses({ idBase = 0, spaces }) {
    for (const spaceId of [...this.#statusById.keys()]) {
      if (spaceId >= idBase && spaceId < idBase + SPACE_ID_SPAN) {
        this.#statusById.delete(spaceId);
      }
    }
    for (const space of spaces) {
      this.#statusById.set(space.id, {
        ownership: space.ownership,
        reason: space.reason,
      });
    }
  }
}
