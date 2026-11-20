# ego-brave

Run the open-source `ego-browser` harness against **your own Brave**, **Microsoft
Edge**, Opera (or any Chromium) over CDP, instead of the Ego Lite app. Agents
keep the same scripts, the same `taskSpace()` / `Page` API and the same usage
guide. All agent work happens in **one agent window**, where each Space is a
named, coloured tab group you can watch, take over, hand back or stop.

```bash
ego-brave nodejs <<'EOF'
const task = await taskSpace("research");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
EOF
```

Scripts can also come from a file, which works in every shell including
PowerShell: `ego-brave nodejs task.mjs`.

## Microsoft Edge (Windows and macOS)

`ego-edge` is the same CLI and API driving Edge. Chromium 136+ refuses remote
debugging on a browser's default profile, so `ego-edge` always runs its own
**agent Edge**: a second Edge instance on its own user data dir, next to the
user's everyday Edge, which it never touches.

```bash
ego-edge launch      # start the agent Edge on port 9444 (or confirm it runs)
ego-edge doctor      # also reports company policies that block agents
ego-edge nodejs task.mjs
```

| Platform | Agent profile                                      | Edge found at                                                                                       |
| -------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\ego-edge\User Data`                | `msedge.exe` under Program Files (x86), Program Files or `%LOCALAPPDATA%`; `EGO_EDGE_EXE` overrides |
| macOS    | `~/Library/Application Support/ego-edge/User Data` | `/Applications` or `~/Applications`; `EGO_EDGE_APP` (an `.app` path) overrides                      |

- The extension is staged into the agent profile's folder (`ego-edge/extension`)
  on every launch: on macOS a browser reading the repo under `~/Documents`
  stops on a privacy prompt, and a fixed path keeps the extension id stable.
- Windows: the browser is spawned directly (no LaunchServices), found by its
  `--user-data-dir` through `Win32_Process`, and closed with `taskkill`
  (windows first, so the session is saved).
- `doctor` reads Edge's enterprise policies (registry on Windows, managed
  preferences on macOS) and names any that block agents:
  `RemoteDebuggingAllowed`, `DeveloperToolsAvailability = 2`,
  `ExtensionDeveloperModeSettings`, `ExtensionInstallBlocklist = *`,
  `ExtensionAllowedTypes`.
- `--restart` always restarts the agent Edge (it is the agent's own browser),
  for example to load an updated extension.
- The agent profile starts signed out; the user signs in to work accounts
  there once.

Windows onboarding with OpenCode (installer, skill, `edge-devtools` MCP
server): [`setup/windows/README.md`](setup/windows/README.md), which starts
with a prompt to paste into OpenCode so it sets everything up. The OpenCode
skill is [`skills/ego-edge/SKILL.md`](skills/ego-edge/SKILL.md).

## Opera

`ego-opera` is the same CLI and API driving Opera:

```bash
export EGO_OPERA_USER_DATA_DIR=~/opera-agent   # optional: its own profile, beside your everyday Opera
ego-opera launch     # starts Opera on port 9333 with the extension loaded (--load-extension)
ego-opera doctor
ego-opera nodejs -e 'const task = await taskSpace("research"); ...'
```

Opera accepts `chrome.tabs.group()` but keeps no tab groups, so there a Space
is a set of tabs in the shared agent window instead of a group
(`extension/space-container.js`); tell them apart in the Agent Spaces popup.
Everything else - ownership, hand-off, Take over, `finish()` - behaves the
same. Useful for Opera's built-in browser VPN.

## How it works

The harness reaches the browser only through `globalThis.ego`, the native
bindings Ego Lite injects (`docs/native-bindings-api.md`). ego-brave implements
that contract and leaves the harness untouched.

```
ego-brave CLI ── installs ──▶ globalThis.ego (BraveEgo)
                               ├─ HarnessCdpBridge  harness CDP → Brave :9222, in order;
                               │                    Target.activateTarget handled in the Space
                               ├─ SnapshotService   AX tree + DOMSnapshot layout → native snapshot format
                               └─ ExtensionRpc      Runtime.evaluate in the extension's offscreen page
Brave extension ── SpaceStore (chrome.storage) · one shared agent window, one tab group per Space
                   popup: Take over · Hand back · Show · Stop · toolbar badge
```

| Ego Lite              | ego-brave                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space                 | A tab group. All agent Spaces of a profile share one unfocused agent window, so the agent never switches or focuses your tabs and you see every task in one place. Your own tab groups are listed as user Spaces the agent can claim. In a dedicated agent browser (Edge, Opera on its own profile) the existing window is the agent window. |
| Space sidebar         | Tab group title `🤖 name` (agent working), `✋ name` (you're in control), `✓ name` (done), plus the toolbar popup.                                                                                                                                                                                                                           |
| Take over / hand back | Popup buttons. Ownership changes are pushed to running agents; a take-over hard-stops the agent with the harness's own user-control message.                                                                                                                                                                                                 |
| Native snapshot       | `Accessibility.getFullAXTree`, rendered in the native format (`root`, two-space indent, `[ref=<backendNodeId>, loc=...]`); viewport scope uses DOMSnapshot bounds.                                                                                                                                                                           |
| Profiles              | Every Brave profile. `taskSpace(name, { profileId })` opens the Space in that profile; without one it uses the default (`Default`, or `EGO_BRAVE_PROFILE`). Space ids encode their profile (`Profile 7` owns 700001…).                                                                                                                       |

## Setup

1. Start Brave with remote debugging and without background throttling:

   ```bash
   ego-brave launch            # starts Brave correctly, or confirms it already is
   ego-brave launch --restart  # Brave is open without debugging: quit and reopen it
   ```

   It launches through LaunchServices (`open -a`) with
   `--remote-debugging-port=9222`, the three `--disable-*` throttling flags
   (without them, renderers behind other apps stall and CDP calls time out)
   and `--profile-directory=Default`. Never run the Brave binary from a shell:
   macOS then never registers it as an app, so it gets no keyboard focus, no
   Dock entry and no Quit menu.

   To have this happen at every login, load a LaunchAgent that runs
   `ego-brave launch` once (`RunAtLoad`); it never restarts a Brave the user
   already opened. See `~/Library/LaunchAgents/com.sharma0x.ego-brave.launch.plist`.

2. Build the harness once: `npm run build:harness`.

3. Run `ego-brave doctor`. The extension is loaded automatically over CDP
   (`Extensions.loadUnpacked`) whenever it is missing, for example after a
   browser restart. To keep it permanently, load `package/ego-brave/extension`
   from `brave://extensions` (Developer mode › Load unpacked).

## Profiles

```js
console.log(await profiles()); // [{ id: "Default", name: "Prince Sharma", isDefault: true }, ...]
const work = await taskSpace("jira", { profileId: "Profile 7" });
```

The first time a profile is used, ego-brave sets it up once:

1. switches Brave to it (`--profile-directory`, handled by the running
   instance) and confirms the switch from `chrome://version`, because CDP can
   only open tabs in the most recently active profile and cannot name profiles;
2. installs the extension there (`Extensions.loadUnpacked`) and turns on that
   profile's **Developer mode**, which Chromium now requires for unpacked
   extensions (otherwise it disables them with reason `1 << 24`);
3. tells the extension which profile it serves; the tag lives in the
   extension's storage, so later runs find the profile without switching.

`ego-brave doctor` sets up the default profile and lists every profile.

## Commands

| Command                                                     | Does                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ego-brave nodejs <<'EOF' … EOF` / `<file>` / `-e '<code>'` | Run a browser script with the harness API                                                                                                       |
| `ego-brave skill`                                           | Print the harness usage guide, with commands rewritten to `ego-brave`                                                                           |
| `ego-brave doctor`                                          | Check the harness build, policies, CDP and the extension bridge; set up the default profile (reloading the extension there if its code changed) |
| `ego-brave launch [--restart]`                              | Start Brave with remote debugging the macOS way                                                                                                 |

Environment: `EGO_BRAVE_CDP_URL` (default `http://127.0.0.1:9222`, 9444 for
Edge, 9333 for Opera), `EGO_EDGE_EXE`, `EGO_EDGE_APP`, `EGO_EDGE_USER_DATA_DIR`,
`EGO_BRAVE_SDK_PATH` (harness bundle), `EGO_BRAVE_TRACE=1` (log every CDP
request, its latency and any request that never got a reply).

## Limitations

- Snapshots cover the top-level document; iframe content is listed as
  `iframe [ref=N]` without its inner nodes.
- `animationHighlightMouseToPosition` is a no-op.
- Agent Spaces do not survive a browser restart: tab group ids change, so a
  restored group comes back as a user Space (relabelled `✋`, or kept `✓`)
  that an agent can claim by name.
- Chromium keeps an unpacked extension's service worker cached across
  restarts and version changes, separately in every profile. The CLI reloads
  a profile's copy the first time it uses that profile after the extension
  code changed (tracked per profile in `~/.cache/ego-brave`), so no profile
  keeps running old code. A staged copy (Edge) changes only on
  `launch --restart`.
- Spaces claimed from your own tab groups live in your window; new tabs there
  open in the background so your selected tab is left alone.

## Tests

`npm test` runs the unit tests (snapshot rendering, viewport filtering and the
native binding contract) without a browser.
