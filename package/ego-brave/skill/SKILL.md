---
name: ego-brave
description: The default browser for interacting with a website through the user's own Brave (their logins, cookies and extensions) - signing in, clicking, filling and submitting forms, posting, buying, uploading, navigating a logged-in web app like Gmail, or reading a page that only renders for the signed-in user or only after JavaScript runs. Use it only when native tools cannot do the job. Do NOT use it for research, looking things up or reading public pages - use web search, web fetch, APIs, CLIs (gh) or MCP tools for those. Not for console/network/performance debugging either (use chrome-devtools-axi).
---

# ego-brave

ego-brave drives the user's real Brave browser over CDP with the open-source
ego-browser harness. All agent work happens in one unfocused **agent window**,
so the user's tabs are never touched; each task is a **Space** in it, a named,
coloured tab group (`🤖 name` working, `✋ name` user in control, `✓ name`
done).

## First decide: do you need a browser at all?

Use the cheapest tool that gets the job done, in this order:

1. **Research, current facts, "find out about X"** - your web search tool.
2. **Read a known public page** - your web fetch tool (or `curl`).
3. **A service with an API, CLI or MCP tool** - GitHub (`gh`), Notion, Linear
   and so on. These are faster and more reliable than any page.
4. **Only then ego-brave**, when the task needs:
   - an action on a site: sign in, click, fill or submit a form, post, buy,
     upload, change a setting;
   - the user's logged-in session (their Gmail, dashboards, admin panels);
   - content the tools above cannot get: pages that need JavaScript, a
     login, or that block fetchers.

If a fetch returns the content you need, stop there. Never open a browser just
to read something a fetch already returned.

## Before the first task

```bash
ego-brave doctor
```

All lines must read `ok`. If the browser check fails:

- Brave is closed: run `ego-brave launch`.
- Brave is open without debugging (`ego-brave launch` exits with code 3):
  **ask the user first**, then run `ego-brave launch --restart`. It quits and
  reopens Brave; windows and tabs come back.
- Never start Brave any other way (no `nohup ".../Brave Browser"`): a Brave
  started from a shell gets no keyboard focus, no Dock entry and no Quit
  menu, so the user cannot type in it.

## Run scripts

```bash
ego-brave skill    # the full API guide; read it once per session
```

```bash
ego-brave nodejs <<'EOF'
const task = await taskSpace("goal name");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
EOF
```

- One script per step; one TaskSpace per goal. Resume it by name in later
  rounds (`taskSpace("goal name")`) and reuse `p1` with `goto()`.
- Never open windows yourself (`window.open`, `chrome.windows`, CDP
  `Target.createTarget`, new windows from a page): every page belongs to a
  Space in the shared agent window. For more tabs in the same goal, call
  `await task.newPage()` (later: `task.page("p2")`).
  Another goal: another `taskSpace("other name")`, which becomes another tab
  group in the same window. Each browser profile has its own agent window,
  so tasks in two profiles show two windows; keep a goal in one profile.
- Act on refs from the latest snapshot (`@21`) or stable locators
  (`loc=role:button[name="Send"]`).
- Finish every goal before your final answer, also when it failed or you
  stop early: `await task.finish({ keep: [] })` marks the Space done (`✓`) and
  its tabs close after 10 idle minutes, so the user can still glance at the
  result. Use `keep: "all"` only when the user has to look at the page itself
  (it stays up to 1 hour). If you forget, an idle `🤖` Space closes after 30
  minutes and a `✋` one after 8 hours (a page loading or the user selecting a
  tab resets the clock). If a Space you were using is gone ("task space not
  found"), start a new one with `taskSpace(name)`.
- Apps that stream data (Gmail and similar) may never fire `load`: when
  `goto()` times out with "navigation committed", continue on the page
  instead of retrying.

## Profiles

Spaces open in the user's main profile, "Prince Sharma" (`Default`). Use
another profile only when the user asks or the task needs that profile's
logins:

```js
console.log(await profiles()); // ids like "Profile 7"
const task = await taskSpace("goal", { profileId: "Profile 7" });
```

The first use of a profile switches Brave to it once and turns on its
Developer mode so the ego-brave extension can run there.

## The user is in control

- The user can take over, hand back or stop any Space from the "Agent Spaces"
  toolbar button. After a take-over the harness stops with a user-control
  message: stop, tell the user, and wait until they say continue. Never take
  control back yourself.
- Sign-ins, 2FA, CAPTCHAs and payments: hand the Space to the user with
  `await task.handOff()` and ask them to finish; do not type their passwords.
- Ask before anything irreversible or public: sending, posting, buying,
  deleting.

## Microsoft Edge (`ego-edge`)

Same commands and API, driving Microsoft Edge: `ego-edge launch`,
`ego-edge doctor`, `ego-edge nodejs`. It runs its own agent Edge profile on
port 9444 (Edge refuses remote debugging on the everyday profile). Use it only
when a task needs Edge. Windows setup with OpenCode:
`package/ego-brave/setup/windows/README.md` in the fork below.

## Opera (`ego-opera`)

Same commands and API, driving Opera instead of Brave: `ego-opera launch`,
`ego-opera doctor`, `ego-opera nodejs`. Use it only when a task needs Opera,
mainly its built-in browser VPN (a US IP for one site without changing the
Mac's network). It runs its own Opera profile (`EGO_OPERA_USER_DATA_DIR`, set
by the `~/.local/bin/ego-opera` wrapper) on port 9333; Opera keeps no tab
groups, so there a Space is a set of tabs in the agent window.

## Troubleshooting

- Slow or timed-out calls: run `EGO_BRAVE_TRACE=1 ego-brave nodejs ...` to log
  every CDP request and its latency.
- `page label not found: p1` after Brave restarted: Spaces do not survive a
  restart; start a new taskSpace.
- Source and design notes: `~/Documents/Development/ego-lite/package/ego-brave`
  (fork `sharma0x/ego-lite`, branch `feat/edge-backend`). The Ego Lite app is
  not used; never install it or run `ego-browser`.
