import { resolve } from "node:path";

import { BROWSER } from "./browser.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const CLEARING_STATE_DOC = resolve(
  REPO_ROOT,
  "skills/ego-browser/references/clearing-state.md",
);

// The harness guide is written for the Ego Lite app. These rewrites point
// its app-specific passages at this CLI (ego-brave, ego-edge or ego-opera) so
// agents never look for the app, its Skill directory or its updater.
const rewrites = ({ command, app }) => [
  [
    /For installation or connection problems, read `references\/install\.md` in the ego-browser Skill directory and follow its link for your operating system\./g,
    `For installation or connection problems, run \`${command} doctor\` and follow its output.`,
  ],
  [/\n*If the final output contains `\[ego-browser:notice\]`[^\n]*\n/g, "\n"],
  [
    /read `references\/clearing-state\.md` in the ego-browser Skill directory\. Some clears reach the whole browser profile\./g,
    `read \`${CLEARING_STATE_DOC}\`. Some clears reach the whole browser profile, which here is the user's own ${app} profile.`,
  ],
  [
    /a particular Ego Lite profile/g,
    `a particular browser profile (${command} exposes only the running ${app} profile)`,
  ],
  [/ego-browser nodejs/g, `${command} nodejs`],
  [/asks for ego-browser/g, `asks for ${command}`],
];

export function rewriteUsageGuide(guide, browser = BROWSER) {
  return rewrites(browser).reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    guide,
  );
}
