---
name: ego-brave
description: The default browser for interacting with a website through the user's own Brave (their logins, cookies and extensions) - signing in, clicking, filling and submitting forms, posting, buying, uploading, navigating a logged-in web app like Gmail, or reading a page that only renders for the signed-in user or only after JavaScript runs. Use it only when native tools cannot do the job. Do NOT use it for research, looking things up or reading public pages - use web search, web fetch, APIs, CLIs (gh) or MCP tools for those. Not for console/network/performance debugging either (use chrome-devtools-axi).
---

# ego-brave

ego-brave drives the user's real Brave browser over CDP with the open-source
ego-browser harness. Each agent works in its own **Space**: a named tab group
in its own unfocused window, so the user's tabs are never touched.

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
- Act on refs from the latest snapshot (`@21`) or stable locators
  (`loc=role:button[name="Send"]`).
- When the goal is done, `await task.finish({ keep: [] })` closes the
  Space's window; use `keep: "all"` when the user should see the result.
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

## Troubleshooting

- Slow or timed-out calls: run `EGO_BRAVE_TRACE=1 ego-brave nodejs ...` to log
  every CDP request and its latency.
- `page label not found: p1` after Brave restarted: Spaces do not survive a
  restart; start a new taskSpace.
- Source and design notes: `~/Documents/Development/ego-lite/package/ego-brave`
  (fork `sharma0x/ego-lite`, branch `feat/brave-backend`). The Ego Lite app is
  not used; never install it or run `ego-browser`.
