---
name: ego-brave
description: The default browser for agent work. Use whenever a task needs a browser - open or read websites, fill forms, click, sign in, take screenshots, extract page data, test a web app - through the ego-brave CLI, which drives the user's own Brave (their logins and extensions) with the ego-browser harness API (taskSpace, Page, snapshot refs). Each agent Space appears in Brave as a named tab group the user can take over, hand back or stop. For console, network or performance diagnosis use chrome-devtools-axi instead.
---

# ego-brave

ego-brave runs the open-source ego-browser harness against the user's Brave
over CDP (`127.0.0.1:9222`). The Ego Lite app is not used and is not
installed; never install it or run `ego-browser`.

## Before the first task

```bash
ego-brave doctor
```

All three lines must read `ok`. If the browser check fails, Brave is not
running with remote debugging: follow "Start Brave" in
`~/Documents/Development/ego-lite/package/ego-brave/README.md` (it restarts the
user's browser, so ask first). The extension is loaded automatically.

## Run scripts

Print the usage guide and follow it, replacing nothing: it is already
rewritten for this command.

```bash
ego-brave skill
```

```bash
ego-brave nodejs <<'EOF'
const task = await taskSpace("goal name");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
EOF
```

Every rule in the guide applies: one TaskSpace per goal, reuse `p1` with
`goto()`, resume the space by name in later rounds, refs come from the latest
snapshot.

## Profiles

Spaces open in the default profile ("Prince Sharma", `Default`) unless the
user names another. To use one, find its id and pass it when creating the
Space; later rounds resume it by name as usual.

```js
console.log(await profiles()); // ids like "Default", "Profile 7"
const task = await taskSpace("goal name", { profileId: "Profile 7" });
```

The first use of a profile switches Brave to it once (a window of that
profile appears) and turns on its Developer mode so the ego-brave extension
can run there. Each profile has its own logins, so pick the one the user
signs in to for the task.

Gmail and other apps that stream data may never fire `load`: when `goto()`
times out with "navigation committed", continue on the Page instead of
retrying.

## User control

The user can click **Take over** in the "Agent Spaces" toolbar popup at any
time. The harness then stops with a user-control message: do not retry and do
not take control back yourself. Wait until the user says to continue.

## Troubleshooting

- Slow or timed-out calls: Brave was started without the anti-throttling flags
  listed in the README. Run `EGO_BRAVE_TRACE=1 ego-brave nodejs ...` to see
  every CDP request and its latency.
- `page label not found: p1` right after a Brave restart: Spaces do not survive
  a restart; start a new taskSpace.
