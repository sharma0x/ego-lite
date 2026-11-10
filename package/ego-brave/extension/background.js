import { SpaceRegistry } from "./space-registry.js";
import { SpaceStore } from "./space-store.js";
import { SpaceTabs } from "./space-tabs.js";
import { decorateSpace, renderBadge } from "./space-view.js";

const REQUEST_CHANNEL = "ego-brave";
const EVENT_CHANNEL = "ego-brave-event";

const store = new SpaceStore();
const registry = new SpaceRegistry(store);
const tabs = new SpaceTabs(registry, store);

// The allowlist of operations reachable from the CLI bridge and the popup.
const OPERATIONS = {
  listSpaces: () => registry.list(),
  createSpace: (args) => registry.create(args),
  claimSpace: (args) => registry.claim(args),
  spaceStatus: (args) => registry.status(args),
  closeSpace: (args) => registry.close(args),
  completeSpace: (args) => registry.complete(args),
  handOff: (args) => registry.handOff(args),
  takeOver: (args) => registry.takeOver(args),
  setState: (args) => registry.setState(args),
  focusSpace: (args) => registry.focus(args),
  listTabs: (args) => tabs.list(args),
  createTab: (args) => tabs.create(args),
  activateTab: (args) => tabs.activate(args),
  activeTarget: (args) => tabs.activeTarget(args),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.channel !== REQUEST_CHANNEL) return false;
  const operation = OPERATIONS[message.op];
  if (!operation) {
    sendResponse({ ok: false, message: `Unknown operation: ${message.op}` });
    return false;
  }
  Promise.resolve()
    .then(() => operation(message.args ?? {}))
    .then(
      (value) => sendResponse({ ok: true, value }),
      (error) =>
        sendResponse({ ok: false, message: error?.message ?? String(error) }),
    );
  return true;
});

// Every Space change re-renders the tab groups and badge, and is pushed to
// running ego-brave processes so Take over stops the agent immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.egoBrave)
    void publish(changes.egoBrave.newValue?.spaces ?? []);
});

chrome.tabGroups.onRemoved.addListener((group) => {
  void store.removeWhere((space) => space.groupId === group.id);
});

async function publish(spaces) {
  await Promise.all([renderBadge(spaces), ...spaces.map(decorateSpace)]);
  const summary = spaces.map(({ id, ownership, reason }) => ({
    id,
    ownership,
    reason,
  }));
  chrome.runtime
    .sendMessage({
      channel: EVENT_CHANNEL,
      event: { type: "spaces", spaces: summary },
    })
    .catch(() => {});
}

// The offscreen document is the CLI's entry point: unlike this worker it is
// always running, so it is always visible as a CDP target.
async function ensureBridge() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification:
      "Stable CDP target that lets the ego-brave CLI reach this extension.",
  });
}

chrome.runtime.onStartup.addListener(ensureBridge);
chrome.runtime.onInstalled.addListener(ensureBridge);
void ensureBridge();
