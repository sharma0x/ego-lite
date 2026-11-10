---
name: ego-brave
description: Drive the user's own Brave browser with the ego-browser harness API (taskSpace, Page, snapshot refs) through the ego-brave CLI. Use when a browser task must run in the user's real Brave - its live tabs, logins and extensions - rather than in the separate ego lite app, or when the user asks for ego-brave. Each agent Space appears in Brave as a named tab group the user can take over, hand back or stop.
---

# ego-brave

ego-brave runs the same harness as `ego-browser`, but against Brave over CDP
(`127.0.0.1:9222`) instead of the ego lite app. The script API is identical.

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
