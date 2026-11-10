# ego-brave

Run the open-source `ego-browser` harness against **your own Brave** (or any
Chromium) over CDP, instead of the Ego Lite app. Agents keep the same scripts,
the same `taskSpace()` / `Page` API and the same usage guide, and your browser
shows each agent Space as a named tab group you can watch, take over, hand
back or stop.

```bash
ego-brave nodejs <<'EOF'
const task = await taskSpace("research");
const page = task.page("p1");
await page.goto("https://example.com");
console.log(await page.snapshot());
EOF
```

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
Brave extension ── SpaceStore (chrome.storage) · one unfocused window + tab group per Space
                   popup: Take over · Hand back · Show · Stop · toolbar badge
```

| Ego Lite              | ego-brave                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space                 | A tab group. Agent Spaces get their own unfocused window, so the agent never switches or focuses your tabs. Your own tab groups are listed as user Spaces the agent can claim.                                         |
| Space sidebar         | Tab group title `🤖 name` (agent working), `✋ name` (you're in control), `✓ name` (done), plus the toolbar popup.                                                                                                     |
| Take over / hand back | Popup buttons. Ownership changes are pushed to running agents; a take-over hard-stops the agent with the harness's own user-control message.                                                                           |
| Native snapshot       | `Accessibility.getFullAXTree`, rendered in the native format (`root`, two-space indent, `[ref=<backendNodeId>, loc=...]`); viewport scope uses DOMSnapshot bounds.                                                     |
| Profiles              | Every Brave profile. `taskSpace(name, { profileId })` opens the Space in that profile; without one it uses the default (`Default`, or `EGO_BRAVE_PROFILE`). Space ids encode their profile (`Profile 7` owns 700001…). |

## Setup

1. Start Brave with remote debugging and without background throttling. The
   flags matter: without them, renderers in windows behind other apps stall
   for seconds and CDP calls time out.

   ```bash
   osascript -e 'tell application "Brave Browser" to quit'; sleep 3
   open -a "Brave Browser" --args \
     --remote-debugging-port=9222 \
     --disable-renderer-backgrounding \
     --disable-backgrounding-occluded-windows \
     --disable-background-timer-throttling \
     --profile-directory=Default
   ```

   Launch through `open -a`, never by running the binary from a shell
   (`nohup …/Brave Browser &`). A binary started that way shows its windows
   and takes clicks, but macOS never registers it as a foreground app, so it
   gets no keyboard focus and typing goes to the previous app.
   `--profile-directory` skips the profile picker that opens when there are
   several profiles. If Apple Events cannot quit a mis-launched Brave, close it
   over CDP with `Browser.close`.

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

| Command                                          | Does                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `ego-brave nodejs <<'EOF' … EOF` / `-e '<code>'` | Run a browser script with the harness API                             |
| `ego-brave skill`                                | Print the harness usage guide, with commands rewritten to `ego-brave` |
| `ego-brave doctor`                               | Check the harness build, CDP and the extension bridge                 |

Environment: `EGO_BRAVE_CDP_URL` (default `http://127.0.0.1:9222`),
`EGO_BRAVE_SDK_PATH` (harness bundle), `EGO_BRAVE_TRACE=1` (log every CDP
request, its latency and any request that never got a reply).

## Limitations

- Snapshots cover the top-level document; iframe content is listed as
  `iframe [ref=N]` without its inner nodes.
- `animationHighlightMouseToPosition` is a no-op.
- Agent Spaces do not survive a browser restart: tab group ids change, so a
  restored group comes back as a user Space you can claim.
- Spaces claimed from your own tab groups live in your window; new tabs there
  open in the background so your selected tab is left alone.

## Tests

`npm test` runs the unit tests (snapshot rendering, viewport filtering and the
native binding contract) without a browser.
