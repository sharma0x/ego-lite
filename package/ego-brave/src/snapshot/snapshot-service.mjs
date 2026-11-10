import { renderAxSnapshot } from "./ax-snapshot.mjs";
import { createViewportFilter } from "./viewport-filter.mjs";

/** Captures one tab's accessibility tree and renders it in Ego Lite's format. */
export class SnapshotService {
  #client;

  constructor(client) {
    this.#client = client;
  }

  async capture(targetId, options = {}) {
    const sessionId = await this.#client.session(targetId);
    const [axTree, isVisible] = await Promise.all([
      this.#client.call("Accessibility.getFullAXTree", {}, sessionId),
      options.scope === "only_within_viewport"
        ? this.#viewportFilter(sessionId)
        : undefined,
    ]);
    return renderAxSnapshot(axTree.nodes, options, isVisible);
  }

  async #viewportFilter(sessionId) {
    const [domSnapshot, layoutMetrics, ratio] = await Promise.all([
      this.#client.call(
        "DOMSnapshot.captureSnapshot",
        { computedStyles: [] },
        sessionId,
      ),
      this.#client.call("Page.getLayoutMetrics", {}, sessionId),
      this.#client.call(
        "Runtime.evaluate",
        { expression: "devicePixelRatio", returnByValue: true },
        sessionId,
      ),
    ]);
    return createViewportFilter({
      domSnapshot,
      layoutMetrics,
      devicePixelRatio: ratio.result?.value,
    });
  }
}
