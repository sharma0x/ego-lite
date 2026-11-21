import assert from "node:assert/strict";
import { test } from "node:test";

import { HarnessCdpBridge } from "../src/bindings/harness-cdp-bridge.mjs";

test("pages the harness attaches to get focus emulation, unseen by the harness", () => {
  let receive;
  const sent = [];
  const delivered = [];
  const channel = {
    isOpen: true,
    onMessage: (listener) => (receive = listener),
    send: (raw) => sent.push(JSON.parse(raw)),
  };
  const callbacks = { onCDPMessage: (raw) => delivered.push(JSON.parse(raw)) };
  new HarnessCdpBridge({
    channel,
    control: {},
    activateTarget: () => ({}),
    callbacks,
  });

  const attached = (type, sessionId) =>
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: { sessionId, targetInfo: { type } },
    });
  receive(attached("page", "S1"));
  receive(attached("iframe", "S2"));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "Emulation.setFocusEmulationEnabled");
  assert.deepEqual(sent[0].params, { enabled: true });
  assert.equal(sent[0].sessionId, "S1");

  receive(JSON.stringify({ id: sent[0].id, result: {}, sessionId: "S1" }));
  receive(JSON.stringify({ id: 7, result: {} }));
  assert.deepEqual(
    delivered.map((message) => message.method ?? message.id),
    ["Target.attachedToTarget", "Target.attachedToTarget", 7],
  );
});
