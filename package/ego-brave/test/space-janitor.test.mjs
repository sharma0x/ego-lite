import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IDLE_LIMITS_MS,
  expiredSpaces,
  idleLimit,
} from "../extension/space-janitor.js";

const agentSpace = (id, fields = {}) => ({
  id,
  createdBy: "agent",
  managed: true,
  ownership: "agent",
  status: "active",
  ...fields,
});

test("idle limits depend on who holds the Space", () => {
  assert.equal(idleLimit(agentSpace(1)), IDLE_LIMITS_MS.working);
  assert.equal(
    idleLimit(
      agentSpace(1, {
        status: "completed",
        ownership: "user",
        closeWhenIdle: true,
      }),
    ),
    IDLE_LIMITS_MS.finished,
  );
  assert.equal(
    idleLimit(agentSpace(1, { status: "completed", ownership: "user" })),
    IDLE_LIMITS_MS.done,
  );
  assert.equal(
    idleLimit(agentSpace(1, { ownership: "user", reason: "manual_takeover" })),
    IDLE_LIMITS_MS.user,
  );
  // The user's own tab groups, even when an agent claimed one, stay.
  assert.equal(
    idleLimit({ id: 1, createdBy: "user", managed: true, ownership: "agent" }),
    null,
  );
  assert.equal(idleLimit({ id: 1, createdBy: "user", managed: false }), null);
});

test("only Spaces idle past their limit expire, never the one in view", () => {
  const now = 10 * 60 * 60_000;
  const spaces = [
    agentSpace(1),
    agentSpace(2),
    agentSpace(3),
    agentSpace(4),
    agentSpace(5, { status: "completed", ownership: "user" }),
    { id: 6, createdBy: "user", managed: false, ownership: "user" },
  ];
  const activity = {
    1: now - IDLE_LIMITS_MS.working, // just expired
    2: now - IDLE_LIMITS_MS.working + 1, // still fresh
    // 3: never seen, so its clock has not started
    4: now - 2 * IDLE_LIMITS_MS.working, // expired, but the user looks at it
    5: now - IDLE_LIMITS_MS.working - 1, // done: has a longer limit
    6: 0,
  };
  assert.deepEqual(
    expiredSpaces(spaces, activity, now, 4).map((space) => space.id),
    [1],
  );
});
