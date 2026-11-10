import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const CLEARING_STATE_DOC = resolve(
  REPO_ROOT,
  "skills/ego-browser/references/clearing-state.md",
);

// The harness guide is written for the Ego Lite app. These rewrites point
// its app-specific passages at ego-brave so agents never look for the app,
// its Skill directory or its updater.
const REWRITES = [
  [
    /For installation or connection problems, read `references\/install\.md` in the ego-browser Skill directory and follow its link for your operating system\./g,
    "For installation or connection problems, run `ego-brave doctor` and follow its output.",
  ],
  [/\n*If the final output contains `\[ego-browser:notice\]`[^\n]*\n/g, "\n"],
  [
    /read `references\/clearing-state\.md` in the ego-browser Skill directory\. Some clears reach the whole browser profile\./g,
    `read \`${CLEARING_STATE_DOC}\`. Some clears reach the whole browser profile, which here is the user's own Brave profile.`,
  ],
  [
    /a particular Ego Lite profile/g,
    "a particular browser profile (ego-brave exposes only the running Brave profile)",
  ],
  [/ego-browser nodejs/g, "ego-brave nodejs"],
  [/asks for ego-browser/g, "asks for ego-brave"],
];

export function rewriteUsageGuide(guide) {
  return REWRITES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    guide,
  );
}
