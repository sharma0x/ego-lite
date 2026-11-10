import { spaceLabel } from "./space-view.js";

const list = document.getElementById("spaces");
const empty = document.getElementById("empty");

function call(op, args) {
  return chrome.runtime.sendMessage({ channel: "ego-brave", op, args });
}

function chipClass(space) {
  if (space.status === "completed") return "done";
  return space.ownership === "agent" ? "agent" : "user";
}

function actionsFor(space) {
  const spaceId = space.id;
  const actions = [{ label: "Show", op: "focusSpace" }];
  if (space.ownership === "agent")
    actions.unshift({ label: "Take over", op: "handOff", primary: true });
  else actions.unshift({ label: "Hand back", op: "takeOver", primary: true });
  actions.push({
    label: "Stop",
    op: "closeSpace",
    danger: true,
    confirm: `Close "${space.name}" and its tabs?`,
  });
  return actions.map((action) => ({ ...action, args: { spaceId } }));
}

function renderButton(action) {
  const button = document.createElement("button");
  button.textContent = action.label;
  if (action.primary) button.className = "primary";
  if (action.danger) button.className = "danger";
  button.addEventListener("click", async () => {
    if (action.confirm && !confirm(action.confirm)) return;
    await call(action.op, action.args);
    if (action.op === "focusSpace") window.close();
  });
  return button;
}

function renderSpace(space) {
  const item = document.createElement("li");
  const title = document.createElement("div");
  title.className = "title";
  const name = document.createElement("span");
  name.textContent = space.name;
  const chip = document.createElement("span");
  chip.className = `chip ${chipClass(space)}`;
  chip.textContent = spaceLabel(space).text;
  title.append(name, chip);

  const state = document.createElement("div");
  state.className = "state";
  state.textContent = space.state || "No status yet";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(...actionsFor(space).map(renderButton));
  item.append(title, state, actions);
  return item;
}

async function render() {
  const { egoBrave } = await chrome.storage.local.get("egoBrave");
  const spaces = (egoBrave?.spaces ?? []).filter((space) => space.managed);
  list.replaceChildren(...spaces.map(renderSpace));
  empty.hidden = spaces.length > 0;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.egoBrave) void render();
});
void render();
