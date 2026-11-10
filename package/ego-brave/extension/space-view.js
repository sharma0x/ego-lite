// How a Space shows up in Brave: its tab group title, colour and the toolbar
// badge. Only Spaces the agent created or claimed are decorated; a user's own
// tab groups keep their title until they are claimed.

const GROUP_COLORS = [
  "blue",
  "purple",
  "cyan",
  "green",
  "orange",
  "pink",
  "red",
  "yellow",
];

export function spaceLabel(space) {
  if (space.status === "completed") return { icon: "✓", text: "Done" };
  if (space.ownership === "agent") return { icon: "🤖", text: "Agent working" };
  return { icon: "✋", text: "You're in control" };
}

export async function decorateSpace(space) {
  if (!space.managed) return;
  const { icon } = spaceLabel(space);
  try {
    await chrome.tabGroups.update(space.groupId, {
      title: `${icon} ${space.name}`,
      color: GROUP_COLORS[space.id % GROUP_COLORS.length],
    });
  } catch {
    // The group was closed; the next listing prunes the Space.
  }
}

export async function renderBadge(spaces) {
  const working = spaces.filter(
    (space) =>
      space.managed &&
      space.ownership === "agent" &&
      space.status !== "completed",
  );
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setBadgeText({
    text: working.length ? String(working.length) : "",
  });
}
