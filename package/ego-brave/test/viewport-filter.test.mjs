import assert from "node:assert/strict";
import { test } from "node:test";

import { createViewportFilter } from "../src/snapshot/viewport-filter.mjs";

// Values measured against Brave on a 2x display: a link at CSS y=1500 reports
// device bounds y=3000 while the window is scrolled to pageY=1200.
function filterFor(bounds, pageY) {
  return createViewportFilter({
    domSnapshot: {
      documents: [
        {
          nodes: { backendNodeId: [7, 8] },
          layout: { nodeIndex: [0, 1], bounds },
        },
      ],
    },
    layoutMetrics: {
      cssVisualViewport: {
        pageX: 0,
        pageY,
        clientWidth: 1440,
        clientHeight: 789,
      },
    },
    devicePixelRatio: 2,
  });
}

test("divides device-pixel document bounds by devicePixelRatio before testing the viewport", () => {
  const isVisible = filterFor(
    [
      [0, 3000, 250, 74],
      [0, 200, 250, 74],
    ],
    1200,
  );
  assert.equal(isVisible(7), true);
  assert.equal(isVisible(8), false);
});

test("zero-sized boxes are not visible and unknown nodes are undecided", () => {
  const isVisible = filterFor(
    [
      [0, 3000, 0, 0],
      [0, 3000, 250, 74],
    ],
    1200,
  );
  assert.equal(isVisible(7), false);
  assert.equal(isVisible(8), true);
  assert.equal(isVisible(99), undefined);
});

test("missing capture data leaves every node undecided", () => {
  const isVisible = createViewportFilter({
    domSnapshot: { documents: [] },
    layoutMetrics: {},
    devicePixelRatio: 2,
  });
  assert.equal(isVisible(7), undefined);
});
