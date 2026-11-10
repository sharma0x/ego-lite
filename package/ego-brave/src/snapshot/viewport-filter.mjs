/**
 * Build a visibility lookup from a DOMSnapshot capture.
 *
 * DOMSnapshot layout bounds are document coordinates in device pixels, while
 * Page.getLayoutMetrics reports the visual viewport in CSS pixels, so bounds
 * are divided by devicePixelRatio before the intersection test. Scrolling
 * inside nested containers is already reflected in the absolute bounds.
 *
 * @returns {(backendNodeId: number) => boolean | undefined} undefined when the
 *   node has no layout box (the caller decides from its descendants).
 */
export function createViewportFilter({
  domSnapshot,
  layoutMetrics,
  devicePixelRatio,
}) {
  const document = domSnapshot?.documents?.[0];
  const viewport = layoutMetrics?.cssVisualViewport;
  if (!document?.layout || !viewport) return () => undefined;

  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const visibility = new Map();
  const { nodeIndex, bounds } = document.layout;
  const backendNodeIds = document.nodes.backendNodeId;
  for (let index = 0; index < nodeIndex.length; index += 1) {
    const backendNodeId = backendNodeIds[nodeIndex[index]];
    const visible = intersectsViewport(bounds[index], ratio, viewport);
    visibility.set(backendNodeId, visibility.get(backendNodeId) || visible);
  }
  return (backendNodeId) => visibility.get(backendNodeId);
}

function intersectsViewport(deviceBounds, ratio, viewport) {
  const [x, y, width, height] = deviceBounds.map((value) => value / ratio);
  if (width <= 0 || height <= 0) return false;
  const right = viewport.pageX + viewport.clientWidth;
  const bottom = viewport.pageY + viewport.clientHeight;
  return (
    x < right &&
    x + width > viewport.pageX &&
    y < bottom &&
    y + height > viewport.pageY
  );
}
