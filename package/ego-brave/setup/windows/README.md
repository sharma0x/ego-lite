# ego-edge on a Windows laptop with OpenCode

This sets up OpenCode to drive **Microsoft Edge**: agents open pages, click,
fill forms and read signed-in web apps the way you would, in an Edge window
you can watch and take over at any time.

What you get:

| Piece                      | What it is                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ego-edge` command         | Starts the agent Edge and runs browser scripts for the agent.                                                                |
| **agent Edge**             | A separate Edge with its own profile (`%LOCALAPPDATA%\ego-edge`). Your everyday Edge, its tabs and its logins are untouched. |
| **Agent Spaces** extension | Loaded into the agent Edge only. Shows every agent task as a named tab group and lets you take over, hand back or stop.      |
| `ego-edge` OpenCode skill  | Tells OpenCode when and how to use the browser.                                                                              |
| `edge-devtools` MCP server | chrome-devtools-mcp attached to the agent Edge, for console, network and performance diagnosis.                              |

All agent work happens in **one agent window**. Each task is a coloured tab
group titled `🤖 name` while the agent works, `✋ name` when you are in
control and `✓ name` when it is done.

## Quick start: let OpenCode set it up

Install Node.js 22+ and Git first (section 1), start OpenCode, and paste this
prompt. OpenCode clones the repo, runs the installer, checks the result and
stops if your company blocks something. The same text is in
[`opencode-setup-prompt.txt`](opencode-setup-prompt.txt).

```text
Set up browser automation for yourself on this Windows laptop, so you can drive Microsoft Edge the way the user's personal setup drives Brave. Everything you need is in a public GitHub repo; follow it rather than improvising.

Repo: https://github.com/sharma0x/ego-lite (branch feat/edge-backend)
Guide: package/ego-brave/setup/windows/README.md (read it fully first)
Installer: package/ego-brave/setup/windows/install.ps1

Steps:
1. Check prerequisites: `node --version` must be 22 or newer, and `git --version` must work. If either is missing, stop and tell me exactly what to install. Do not install system software yourself.
2. Clone the repo:
   git clone --branch feat/edge-backend https://github.com/sharma0x/ego-lite.git $env:USERPROFILE\ego-lite
   If it already exists, run `git -C $env:USERPROFILE\ego-lite pull` instead.
3. Run the installer from PowerShell:
   powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\ego-lite\package\ego-brave\setup\windows\install.ps1
   It builds the harness, installs the `ego-edge` command and chrome-devtools-mcp, links the `ego-edge` skill into ~/.config/opencode/skills, adds the `edge-devtools` MCP server to opencode.json, starts the agent Edge and runs `ego-edge doctor`.
4. Read the output. Every step should print `ok`. If something fails, use the troubleshooting table in the guide. In particular:
   - If `doctor` prints `FAIL policy: ...`, the company's IT blocks remote debugging or unpacked extensions. Stop and tell me which policy. Never try to get around an IT policy.
   - If PowerShell says running scripts is disabled, use `ego-edge.cmd` in place of `ego-edge`.
   - If npm or git fail with network errors, ask me for the company proxy or npm registry. Do not guess one.
   - If opencode.json has comments or is a .jsonc file, the installer prints a snippet instead of editing it. Add that `edge-devtools` entry yourself, keeping the existing comments.
5. When `ego-edge doctor` is all `ok`, tell me to:
   a) sign in to my work accounts once in the agent Edge window that opened (it is separate from my normal Edge),
   b) restart OpenCode so it loads the ego-edge skill and the edge-devtools MCP server.

Rules:
- No administrator rights, no permanent execution-policy changes, no changes to my everyday Edge or its profile.
- Never type my passwords or MFA codes. When a site needs a login, hand the window to me and wait.
- Report exactly what happened, including any failure output. Don't summarise a failure as success.
```

When it is done, sign in once in the agent Edge window, restart OpenCode and
test it with:

```text
Use the ego-edge skill: open example.com and tell me the page heading.
```

To set it up by hand instead, follow sections 1 to 3.

## 1. Prerequisites

Install these first. None need administrator rights if your company's
software portal is not available.

- **Node.js 22 or newer**: the LTS installer from nodejs.org, or
  `winget install OpenJS.NodeJS.LTS`. Check with `node --version`.
- **Git**: `winget install Git.Git`, or Git for Windows from git-scm.com.
- **OpenCode**: installed the usual way.
- **Microsoft Edge**: already on every Windows laptop.

Behind a company proxy, point npm and Git at it first:

```powershell
npm config set proxy http://proxy.example:8080
npm config set https-proxy http://proxy.example:8080
git config --global http.proxy http://proxy.example:8080
```

## 2. Install

In PowerShell:

```powershell
git clone --branch feat/edge-backend https://github.com/sharma0x/ego-lite.git $env:USERPROFILE\ego-lite
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\ego-lite\package\ego-brave\setup\windows\install.ps1
```

`-ExecutionPolicy Bypass` applies to that one run only; it does not change
your machine's policy. The script prints `ok` for each step and ends by
starting the agent Edge and running `ego-edge doctor`.

It installs into:

- `%USERPROFILE%\ego-lite`: the source (a Git clone).
- `%APPDATA%\npm`: the `ego-edge` and `chrome-devtools-mcp` commands.
- `%USERPROFILE%\.config\opencode\skills\ego-edge`: a link to the skill.
- `%USERPROFILE%\.config\opencode\opencode.json`: the `edge-devtools` MCP
  server is added (the previous file is kept as `opencode.json.bak`). If your
  config is `opencode.jsonc` or has comments, the script prints the snippet to
  paste instead of editing it.
- `%LOCALAPPDATA%\ego-edge`: the agent Edge profile and its extension copy.

## 3. First run

1. **Sign in once in the agent Edge.** It starts signed out. Sign in to the
   work accounts agents should use (Microsoft 365, Jira and so on) in that
   window; the agent profile keeps the sessions. Agents never type your
   passwords: when a site asks for a login or MFA, the agent hands the window
   to you and waits.
2. **Restart OpenCode** so it loads the skill and the MCP server.
3. **Try it:** ask OpenCode
   _"Use the ego-edge skill to open example.com and tell me its heading."_
   A `🤖` tab group appears in the agent Edge window.

## 4. Everyday use

- Ask for browser tasks in plain words; the skill makes OpenCode use the
  browser only when a web search, a fetch or an API cannot do the job.
- The **Agent Spaces** toolbar button in the agent Edge lists the agent's
  tasks: **Take over** stops the agent on that task, **Hand back** lets it
  continue, **Show** brings the task forward, **Stop** closes it.
- If the agent Edge is closed, the agent reopens it with `ego-edge launch`.
- Commands, if you want them yourself:

  ```powershell
  ego-edge launch            # start the agent Edge (or confirm it runs)
  ego-edge launch --restart  # restart it, e.g. after an update; tabs come back
  ego-edge doctor            # check everything
  ego-edge nodejs task.mjs   # run a browser script file
  ```

## 5. Update

Run the install script again. It pulls the latest code, rebuilds, and then:

```powershell
ego-edge launch --restart
```

so the agent Edge loads the new extension. `ego-edge doctor` tells you when
that restart is still needed.

## 6. Troubleshooting

| You see                                                                                                   | Do                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FAIL policy: RemoteDebuggingAllowed` or `DeveloperToolsAvailability = 2`                                 | Your IT department has blocked remote control of Edge. Agents cannot work in Edge until they allow it for your machine; check `edge://policy` and ask them. Do not try to work around it. |
| `FAIL policy: ExtensionDeveloperModeSettings`, `ExtensionInstallBlocklist = *` or `ExtensionAllowedTypes` | Unpacked extensions are blocked, so the Agent Spaces extension cannot load. Same as above: IT has to allow it.                                                                            |
| `running scripts is disabled on this system` when typing `ego-edge`                                       | PowerShell's execution policy blocks npm's `.ps1` shims. Use `ego-edge.cmd` (same arguments). OpenCode's skill knows this.                                                                |
| `Microsoft Edge was not found`                                                                            | Edge is installed in an unusual place. Set `EGO_EDGE_EXE` to the full path of `msedge.exe`.                                                                                               |
| `node`, `npm` or `ego-edge` not found                                                                     | Open a new terminal after installing Node.js, so PATH includes `%APPDATA%\npm`.                                                                                                           |
| `npm ci` fails with network errors                                                                        | Set the npm proxy (section 1), or your company's npm registry: `npm config set registry <url>`.                                                                                           |
| The agent says the extension is out of date                                                               | `ego-edge launch --restart`.                                                                                                                                                              |

## 7. Uninstall

Close the agent Edge window first (your everyday Edge can stay open), then:

```powershell
npm uninstall --global ego-brave chrome-devtools-mcp
# rmdir removes only the link; Remove-Item could follow it into the source.
cmd /c rmdir "$env:USERPROFILE\.config\opencode\skills\ego-edge"
Remove-Item -Recurse $env:LOCALAPPDATA\ego-edge    # agent profile and its logins
Remove-Item -Recurse -Force $env:USERPROFILE\ego-lite
```

Then remove the `edge-devtools` entry from `opencode.json`.
