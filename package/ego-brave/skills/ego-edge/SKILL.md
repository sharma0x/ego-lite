---
name: ego-edge
description: The browser for interacting with a website through Microsoft Edge - signing in, clicking, filling and submitting forms, posting, uploading, navigating a logged-in web app (Outlook, Teams web, SharePoint, Jira, internal dashboards), or reading a page that only renders for a signed-in user or only after JavaScript runs. Use it only when native tools cannot do the job. Do NOT use it for research, looking things up or reading public pages - use web search, web fetch, APIs, CLIs or MCP tools for those. For console, network or performance diagnosis use the edge-devtools MCP tools.
---

# ego-edge

`ego-edge` drives Microsoft Edge over the Chrome DevTools Protocol with the
open-source ego-browser harness. It runs its own **agent Edge**: a separate
Edge instance with its own profile, next to the user's everyday Edge, which it
never touches. (Edge refuses remote control of the everyday profile, so the
separate profile is required, not a choice.)

All agent work happens in **one agent window**. Each task is a **Space**: a
named, coloured tab group in that window, titled `🤖 name` while the agent
works, `✋ name` when the user is in control and `✓ name` when done.

## First decide: do you need a browser at all?

Use the cheapest tool that gets the job done, in this order:

1. **Research, current facts, "find out about X"**: web search.
2. **Read a known public page**: web fetch (or `curl`).
3. **A service with an API, CLI or MCP tool** (GitHub, Jira, Confluence and
   so on): use that. It is faster and more reliable than any page.
4. **Only then ego-edge**, when the task needs an action on a site, the
   user's signed-in session, or content the tools above cannot get.

If a fetch returns the content you need, stop there.

## Before the first task in a session

```bash
ego-edge launch     # starts the agent Edge, or confirms it is running
ego-edge doctor     # every line must read "ok"
```

- `doctor` reports a `policy:` FAIL: the company's IT policy blocks remote
  debugging or unpacked extensions in Edge. Stop and tell the user exactly
  which policy; do not try to work around it.
- `doctor` says the extension is out of date (after an update), or `launch`
  prints a `note`: run `ego-edge launch --restart`. It restarts only the agent
  Edge, and its tabs come back.
- Never start Edge yourself (`msedge.exe`, `start msedge`, `open -a`).
  `ego-edge launch` adds the flags the harness needs.

The agent Edge starts signed out. The first time a task needs a work account,
hand the Space to the user (below) and ask them to sign in once in that
window; the agent profile keeps the session afterwards.

## Run scripts

```bash
ego-edge skill    # the full API guide; read it once per session
```

A script runs with the harness API. Pick the form that suits your shell. A
script file works in every shell, including PowerShell and cmd:

```bash
ego-edge nodejs task.mjs
```

bash or Git Bash:

```bash
ego-edge nodejs <<'EOF'
const task = await taskSpace("goal name");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
EOF
```

PowerShell (a here-string piped to stdin; `'@` must start its line):

```powershell
@'
const task = await taskSpace("goal name");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
'@ | ego-edge nodejs
```

- One script per step; one Space per goal. Resume it by name in later rounds
  (`taskSpace("goal name")`) and reuse `p1` with `goto()`. More tabs in the
  same Space: `await task.newPage()`.
- Act on refs from the latest snapshot (`@21`) or stable locators
  (`loc=role:button[name="Send"]`).
- When the goal is done: `await task.finish({ keep: [] })` closes the Space's
  tabs; `keep: "all"` leaves them open, marked `✓`, for the user to look at.
- Apps that stream data (Outlook, Teams and similar) may never fire `load`:
  when `goto()` times out with "navigation committed", continue on the page
  instead of retrying.

## The user is in control

- The user can take over, hand back or stop any Space from the "Agent Spaces"
  toolbar button in the agent Edge. After a take-over the harness stops with a
  user-control message: stop, tell the user, and wait until they say continue.
  Never take control back yourself.
- Sign-ins, MFA prompts, CAPTCHAs and payments: hand the Space to the user
  with `await task.handOff()` and ask them to finish; never type their
  passwords.
- Ask before anything irreversible or public: sending, posting, buying,
  deleting, approving.

## Diagnosing a page (edge-devtools MCP)

For console errors, network requests, Lighthouse audits and performance
traces, use the `edge-devtools` MCP tools (chrome-devtools-mcp attached to the
agent Edge on port 9444). Run `ego-edge launch` first. Use them to diagnose,
not to browse: browsing and form filling go through `ego-edge nodejs`.

## Troubleshooting

- `No browser is listening for CDP at http://127.0.0.1:9444`: run
  `ego-edge launch`.
- PowerShell says "running scripts is disabled on this system": company
  policy blocks npm's `ego-edge.ps1` shim. Call `ego-edge.cmd` instead (same
  arguments); never change the execution policy yourself.
- `Microsoft Edge was not found`: Edge is installed somewhere unusual. Set
  `EGO_EDGE_EXE` (Windows, full path of `msedge.exe`) or `EGO_EDGE_APP`
  (macOS, path of `Microsoft Edge.app`).
- Slow or timed-out calls: rerun with the environment variable
  `EGO_BRAVE_TRACE=1` to log every CDP request and its latency.
- `page label not found: p1` after the agent Edge restarted: Spaces do not
  survive a restart; start a new `taskSpace`. Spaces from before the restart
  come back as the user's (`✋`/`✓`) and can be claimed by name.
- Agent profile location: `%LOCALAPPDATA%\ego-edge\User Data` on Windows,
  `~/Library/Application Support/ego-edge/User Data` on macOS.
