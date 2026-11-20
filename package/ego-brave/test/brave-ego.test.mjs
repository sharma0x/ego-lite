import assert from "node:assert/strict";
import { test } from "node:test";

import { BraveEgo } from "../src/bindings/brave-ego.mjs";
import { ProfileCatalog } from "../src/profiles/profile-catalog.mjs";

class FakeChannel {
  sent = [];
  isOpen = true;
  #listener;
  onMessage(listener) {
    this.#listener = listener;
  }
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
  receive(message) {
    this.#listener(JSON.stringify(message));
  }
}

class FakeRpc {
  calls = [];
  ownership = "agent";
  #listener;
  onEvent(listener) {
    this.#listener = listener;
  }
  push(event) {
    this.#listener(event);
  }
  async call(operation, args) {
    this.calls.push([operation, args]);
    if (operation === "spaceStatus")
      return {
        ownership: this.ownership,
        reason: this.ownership === "user" ? "manual_takeover" : undefined,
      };
    if (operation === "activeTarget") return { targetId: "T1" };
    if (operation === "activateTab") return {};
    return { ok: true };
  }
}

function setup({ dedicatedBrowser } = {}) {
  const channel = new FakeChannel();
  const rpc = new FakeRpc();
  const snapshots = {
    capture: async (targetId, options) => ({
      content: `root for ${targetId}`,
      refs: [],
      options,
    }),
  };
  const profiles = new ProfileCatalog(
    [
      { id: "Default", name: "Prince Sharma" },
      { id: "Profile 7", name: "Prince - Clow" },
    ],
    "Default",
  );
  const ego = new BraveEgo({
    harnessChannel: channel,
    rpc,
    profiles,
    snapshots,
    browserVersion: "test",
    dedicatedBrowser,
  }).bindings;
  const delivered = [];
  const failures = [];
  ego.onCDPMessage = (raw) => delivered.push(JSON.parse(raw));
  ego.onSendCDPMessageError = (message, code) => failures.push([message, code]);
  return { ego, channel, rpc, delivered, failures };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("exposes the native surface as own enumerable functions", () => {
  const { ego } = setup();
  for (const method of [
    "useTaskSpace",
    "createTaskSpace",
    "createTab",
    "listTabs",
    "snapshot",
    "sendCDPMessage",
  ]) {
    assert.equal(typeof ego[method], "function", method);
    assert.ok(Object.keys(ego).includes(method), method);
  }
});

test("validates arguments synchronously with EGO_INVALID_ARGUMENT", () => {
  const { ego } = setup();
  assert.throws(() => ego.useTaskSpace("7"), {
    name: "TypeError",
    error_code: "EGO_INVALID_ARGUMENT",
  });
  assert.throws(() => ego.useTaskSpace(7, 8), {
    error_code: "EGO_INVALID_ARGUMENT",
  });
  assert.throws(() => ego.sendCDPMessage({}), {
    error_code: "EGO_INVALID_ARGUMENT",
  });
  assert.equal(ego.useTaskSpace(7), 7);
});

test("task-scoped calls without a selected space resolve EGO_TASK_SPACE_NOT_SELECTED", async () => {
  const { ego } = setup();
  assert.deepEqual(await ego.listTabs(), {
    error: "Task space not selected",
    error_code: "EGO_TASK_SPACE_NOT_SELECTED",
  });
  await assert.rejects(ego.snapshot(), {
    error_code: "EGO_TASK_SPACE_NOT_SELECTED",
  });
});

test("forwards raw CDP in order once a space is selected and passes replies back", async () => {
  const { ego, channel, delivered } = setup();
  ego.useTaskSpace(7);
  ego.sendCDPMessage(JSON.stringify({ id: 1, method: "Page.enable" }));
  ego.sendCDPMessage(JSON.stringify({ id: 2, method: "Runtime.enable" }));
  await settle();
  assert.deepEqual(
    channel.sent.map((message) => message.id),
    [1, 2],
  );
  channel.receive({ id: 1, result: {} });
  assert.deepEqual(delivered, [{ id: 1, result: {} }]);
});

test("Target.activateTarget is handled by the extension, not raised in the browser", async () => {
  const { ego, channel, rpc, delivered } = setup();
  ego.useTaskSpace(7);
  ego.sendCDPMessage(
    JSON.stringify({
      id: 5,
      method: "Target.activateTarget",
      params: { targetId: "T9" },
    }),
  );
  await settle();
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(rpc.calls.at(-1), [
    "activateTab",
    { spaceId: 7, targetId: "T9" },
  ]);
  assert.deepEqual(delivered, [{ id: 5, result: {} }]);
});

test("a user take-over pushed by the extension blocks CDP and reports the reason", async () => {
  const { ego, channel, rpc, failures } = setup();
  ego.useTaskSpace(7);
  rpc.push({
    type: "spaces",
    spaces: [{ id: 7, ownership: "user", reason: "manual_takeover" }],
  });
  ego.sendCDPMessage(JSON.stringify({ id: 1, method: "Page.enable" }));
  await settle();
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(failures, [
    ["The task is under user control", "EGO_TASK_SPACE_USER_IN_CONTROL"],
  ]);
  assert.deepEqual(await ego.setAgentTaskState("Waiting for the user"), {
    error: "manual_takeover",
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
});

test("snapshot captures the Space's active target", async () => {
  const { ego } = setup();
  ego.useTaskSpace(7);
  const result = await ego.snapshot({ scope: "full_page" });
  assert.equal(result.content, "root for T1");
  assert.deepEqual(result.options, { scope: "full_page" });
});

test("createTaskSpace rejects unknown profiles like Ego Lite", async () => {
  const { ego } = setup();
  assert.deepEqual(await ego.createTaskSpace("demo", "Profile 9"), {
    error: "Profile not found",
    error_code: "EGO_PROFILE_NOT_FOUND",
  });
});

test("createTaskSpace opens the Space in the requested profile, or the default one", async () => {
  const { ego, rpc } = setup();
  await ego.createTaskSpace("work", "Profile 7");
  assert.deepEqual(rpc.calls.at(-1), [
    "createSpace",
    { name: "work", profileId: "Profile 7" },
  ]);
  await ego.createTaskSpace("personal");
  assert.deepEqual(rpc.calls.at(-1), [
    "createSpace",
    { name: "personal", profileId: "Default" },
  ]);
});

test("listProfiles reports the browser's profiles and the default", async () => {
  const { ego } = setup();
  assert.deepEqual((await ego.listProfiles()).profiles, [
    { id: "Default", name: "Prince Sharma", isDefault: true },
    { id: "Profile 7", name: "Prince - Clow", isDefault: false },
  ]);
});

test("an ownership update from one profile leaves other profiles' Spaces alone", async () => {
  const { ego, channel, rpc, failures } = setup();
  ego.useTaskSpace(700001);
  ego.sendCDPMessage(JSON.stringify({ id: 1, method: "Page.enable" }));
  await settle();
  rpc.push({
    type: "spaces",
    idBase: 0,
    spaces: [{ id: 3, ownership: "user", reason: "manual_takeover" }],
  });
  ego.sendCDPMessage(JSON.stringify({ id: 2, method: "Page.enable" }));
  await settle();
  assert.deepEqual(
    channel.sent.map((message) => message.id),
    [1, 2],
  );
  assert.deepEqual(failures, []);
  const statusLookups = rpc.calls.filter(
    ([operation]) => operation === "spaceStatus",
  );
  assert.equal(
    statusLookups.length,
    1,
    "Profile 7's cached status survived the Default update",
  );
});

test("only a dedicated agent browser lets a new Space reuse its window", async () => {
  for (const dedicatedBrowser of [false, true]) {
    const { ego, rpc } = setup({ dedicatedBrowser });
    await ego.createTaskSpace("work");
    assert.equal(
      rpc.calls.at(-1)[1].dedicatedBrowser,
      dedicatedBrowser ? true : undefined,
    );
  }
});
