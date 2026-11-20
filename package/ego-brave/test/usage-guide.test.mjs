import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { rewriteUsageGuide } from "../src/cli/usage-guide.mjs";

const BUILT_GUIDE = resolve(
  import.meta.dirname,
  "../../ego-browser/dist/out/ego-browser/SKILL.macos.md",
);

test(
  "the served guide never sends agents to the Ego Lite app",
  { skip: !existsSync(BUILT_GUIDE) && "harness not built" },
  () => {
    const guide = rewriteUsageGuide(readFileSync(BUILT_GUIDE, "utf8"));
    assert.doesNotMatch(
      guide,
      /Ego Lite|ego-browser upgrade|ego-browser nodejs|references\/install\.md/,
    );
    assert.match(guide, /ego-brave doctor/);
    assert.match(guide, /skills\/ego-browser\/references\/clearing-state\.md/);
    assert.match(guide, /\[ego-browser:skill\] end of guide/);
  },
);
