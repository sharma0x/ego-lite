import { SpaceJanitor } from "./space-janitor.js";
import { SpaceRegistry } from "./space-registry.js";
import { SpaceStore } from "./space-store.js";
import { SpaceTabs } from "./space-tabs.js";
import { decorateSpace, renderBadge } from "./space-view.js";

const REQUEST_CHANNEL = "ego-brave";
const EVENT_CHANNEL = "ego-brave-event";

const store = new SpaceStore();
const registry = new SpaceRegistry(store);
const tabs = new SpaceTabs(registry, store);
const janitor = new SpaceJanitor(registry, store);
const SWEEP_ALARM = "close-idle-spaces";

// The allowlist of operations reachable from the CLI bridge and the popup.
const OPERATIONS = {
  whoami: () => registry.whoami(),
  setProfile: (args) => registry.setProfile(args),
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
      (value) => {
        sendResponse({ ok: true, value });
        void recordActivity(message.op, message.args, value);
      },
      (error) =>
        sendResponse({ ok: false, message: error?.message ?? String(error) }),
    );
  return true;
});

// Every Space change re-renders the tab groups and badge, and is pushed to
// running ego-brave processes so Take over stops the agent immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.egoBrave)
    void publish(changes.egoBrave.newValue ?? {});
});

chrome.tabGroups.onRemoved.addListener((group) => {
  void store.removeWhere((space) => space.groupId === group.id);
});

// Any call on a Space keeps it open; see space-janitor.js for the limits.
function recordActivity(op, args, value) {
  const spaceId = op === "createSpace" ? value?.id : args?.spaceId;
  if (Number.isInteger(spaceId)) return janitor.touch(spaceId).catch(() => {});
}

// Pages loading (the agent navigating) and the user selecting a tab count
// as activity too.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete")
    void janitor.touchTab(tabId).catch(() => {});
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void janitor.touchTab(tabId).catch(() => {});
});

// Closes Spaces an agent forgot to finish. Created only when missing:
// re-creating it on every worker start would keep pushing the first run back.
async function scheduleSweep() {
  if (!(await chrome.alarms.get(SWEEP_ALARM)))
    await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SWEEP_ALARM) void janitor.sweep().catch(() => {});
});

// Tab-set Spaces (browsers without working tab groups) end with their last tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  void store.forgetTab(tabId);
});

// idBase tells the CLI which id range this profile owns, so an update from
// one profile only replaces that profile's cached ownership.
async function publish({ spaces = [], profile }) {
  await Promise.all([renderBadge(spaces), ...spaces.map(decorateSpace)]);
  const summary = spaces.map(({ id, ownership, reason }) => ({
    id,
    ownership,
    reason,
  }));
  chrome.runtime
    .sendMessage({
      channel: EVENT_CHANNEL,
      event: { type: "spaces", idBase: profile?.idBase ?? 0, spaces: summary },
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

// Session restore recreates agent Spaces as plain groups still titled
// "🤖 name", often before this worker listens for tab group events. Once per
// browser session (storage.session is cleared on restart), list a few times
// while the restore settles: listing adopts those groups as the user's and
// relabels them, so no stale "agent working" label stays up.
const RESTORE_SETTLE_DELAYS_MS = [0, 2000, 5000];

async function adoptRestoredSpaces() {
  const { restoreAdopted } = await chrome.storage.session.get("restoreAdopted");
  if (restoreAdopted) return;
  await chrome.storage.session.set({ restoreAdopted: true });
  for (const delay of RESTORE_SETTLE_DELAYS_MS) {
    await new Promise((settle) => setTimeout(settle, delay));
    await registry.list().catch(() => {});
  }
}

void adoptRestoredSpaces();
chrome.runtime.onInstalled.addListener(ensureBridge);
void ensureBridge();
void scheduleSweep();
