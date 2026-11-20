<#
.SYNOPSIS
  Sets up ego-edge for OpenCode on Windows: browser automation through
  Microsoft Edge, the OpenCode skill and the edge-devtools MCP server.

.DESCRIPTION
  Re-runnable; run it again to update. Steps:
    1. checks Node.js 22+, npm and Git
    2. clones (or updates) the ego-lite fork
    3. builds the ego-browser harness
    4. installs the ego-edge command (npm global link)
    5. installs chrome-devtools-mcp for the edge-devtools MCP server
    6. links the ego-edge skill into OpenCode's global skills folder
    7. adds the edge-devtools MCP server to OpenCode's config
    8. starts the agent Edge and runs `ego-edge doctor`

  Nothing needs administrator rights. Your everyday Edge is not changed:
  ego-edge runs its own Edge profile in %LOCALAPPDATA%\ego-edge.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$RepoUrl = "https://github.com/sharma0x/ego-lite.git",
  [string]$Branch = "feat/edge-backend",
  [string]$InstallDir = (Join-Path $env:USERPROFILE "ego-lite"),
  [string]$OpenCodeConfigDir = (Join-Path $env:USERPROFILE ".config\opencode"),
  [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "ok   $text" -ForegroundColor Green }
function Fail($text) { Write-Host "FAIL $text" -ForegroundColor Red; exit 1 }

# Native commands do not throw on failure; stop on a non-zero exit code.
function Invoke-Checked {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "$File $($Arguments -join ' ') exited with $LASTEXITCODE" }
}

function Write-Utf8NoBom($Path, $Text) {
  # Windows PowerShell 5.1 writes a BOM with -Encoding UTF8, which JSON readers reject.
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

# 1. Prerequisites ------------------------------------------------------------
Step "Checking prerequisites"
foreach ($tool in @("node", "npm", "git")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Fail "$tool is not installed or not on PATH. See README.md in this folder for how to install it."
  }
}
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { Fail "Node.js 22 or newer is required (found $(& node --version))." }
Ok "Node.js $(& node --version), npm $(& npm --version), $(& git --version)"

# 2. Source --------------------------------------------------------------------
Step "Getting ego-lite ($Branch) into $InstallDir"
if (Test-Path (Join-Path $InstallDir ".git")) {
  Invoke-Checked git @("-C", $InstallDir, "fetch", "origin", $Branch)
  Invoke-Checked git @("-C", $InstallDir, "checkout", $Branch)
  Invoke-Checked git @("-C", $InstallDir, "pull", "--ff-only", "origin", $Branch)
} else {
  Invoke-Checked git @("clone", "--branch", $Branch, $RepoUrl, $InstallDir)
}
$package = Join-Path $InstallDir "package\ego-brave"
Ok "source at $package"

# 3. Harness build -------------------------------------------------------------
Step "Building the ego-browser harness"
Push-Location $package
try { Invoke-Checked npm @("run", "build:harness") } finally { Pop-Location }
Ok "harness built"

# 4. ego-edge command ----------------------------------------------------------
Step "Installing the ego-edge command"
# A folder install is a link to the clone, so `git pull` updates the command.
Invoke-Checked npm @("install", "--global", $package)
$npmPrefix = (& npm prefix --global).Trim()
if (-not ($env:Path -split ";" | Where-Object { $_.TrimEnd("\") -eq $npmPrefix.TrimEnd("\") })) {
  $env:Path = "$npmPrefix;$env:Path"
  Write-Host "note $npmPrefix is not on PATH in this window; it is added for this run. New terminals get it from the Node.js installer." -ForegroundColor Yellow
}
Ok "ego-edge -> $(Join-Path $npmPrefix 'ego-edge.cmd')"

# 5. chrome-devtools-mcp -------------------------------------------------------
Step "Installing chrome-devtools-mcp (edge-devtools MCP server)"
Invoke-Checked npm @("install", "--global", "chrome-devtools-mcp@latest")
$npmRoot = (& npm root --global).Trim()
$mcpPackage = Get-Content (Join-Path $npmRoot "chrome-devtools-mcp\package.json") -Raw | ConvertFrom-Json
$mcpScript = Join-Path $npmRoot ("chrome-devtools-mcp\" + $mcpPackage.bin."chrome-devtools-mcp")
if (-not (Test-Path $mcpScript)) { Fail "chrome-devtools-mcp entry point not found at $mcpScript" }
Ok "chrome-devtools-mcp $($mcpPackage.version)"

# 6. OpenCode skill ------------------------------------------------------------
Step "Linking the ego-edge skill into OpenCode"
$skillsDir = Join-Path $OpenCodeConfigDir "skills"
$skillLink = Join-Path $skillsDir "ego-edge"
$skillSource = Join-Path $package "skills\ego-edge"
New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
if (Test-Path $skillLink) {
  $existing = Get-Item $skillLink -Force
  if ($existing.LinkType -eq "Junction") { $existing.Delete() }
  else { Fail "$skillLink exists and is not a link made by this script; move it away and rerun." }
}
# A junction needs no administrator rights and follows `git pull`.
New-Item -ItemType Junction -Path $skillLink -Target $skillSource | Out-Null
Ok "$skillLink -> $skillSource"

# 7. OpenCode MCP config -------------------------------------------------------
Step "Adding the edge-devtools MCP server to OpenCode"
$mcpEntry = [ordered]@{
  type    = "local"
  # No usage statistics to Google and no trace URLs to the CrUX API: on a
  # company laptop nothing should leave the machine unasked.
  command = @(
    "node", $mcpScript, "--browserUrl", "http://127.0.0.1:9444",
    "--no-usage-statistics", "--no-performance-crux"
  )
  enabled = $true
}
$jsonConfig = Join-Path $OpenCodeConfigDir "opencode.json"
$jsoncConfig = Join-Path $OpenCodeConfigDir "opencode.jsonc"
$snippet = ([ordered]@{ mcp = [ordered]@{ "edge-devtools" = $mcpEntry } } | ConvertTo-Json -Depth 10)
if (Test-Path $jsoncConfig) {
  Write-Host "note $jsoncConfig may contain comments, so it is not edited automatically. Add this to it:" -ForegroundColor Yellow
  Write-Host $snippet
} elseif (Test-Path $jsonConfig) {
  $raw = Get-Content $jsonConfig -Raw
  # PowerShell 7 parses // and /* */ comments but would drop them on rewrite.
  $hasComments = $raw -match '(^|[^:"\\])//|/\*'
  $config = $null
  if (-not $hasComments) {
    try { $config = $raw | ConvertFrom-Json } catch { $config = $null }
  }
  if ($null -eq $config) {
    Write-Host "note $jsonConfig has comments or could not be parsed, so it is not edited. Add this to it:" -ForegroundColor Yellow
    Write-Host $snippet
  } else {
    Copy-Item $jsonConfig "$jsonConfig.bak" -Force
    if (-not ($config.PSObject.Properties.Name -contains "mcp")) {
      $config | Add-Member -NotePropertyName mcp -NotePropertyValue ([pscustomobject]@{})
    }
    $config.mcp | Add-Member -NotePropertyName "edge-devtools" -NotePropertyValue ([pscustomobject]$mcpEntry) -Force
    Write-Utf8NoBom $jsonConfig ($config | ConvertTo-Json -Depth 20)
    Ok "updated $jsonConfig (previous version: opencode.json.bak)"
  }
} else {
  New-Item -ItemType Directory -Force -Path $OpenCodeConfigDir | Out-Null
  $config = [ordered]@{
    '$schema' = "https://opencode.ai/config.json"
    mcp       = [ordered]@{ "edge-devtools" = $mcpEntry }
  }
  Write-Utf8NoBom $jsonConfig ($config | ConvertTo-Json -Depth 10)
  Ok "created $jsonConfig"
}

# 8. Agent Edge ---------------------------------------------------------------
if ($SkipLaunch) {
  Write-Host "`nSkipped starting Edge. Run: ego-edge.cmd launch; ego-edge.cmd doctor"
} else {
  Step "Starting the agent Edge and checking everything"
  Invoke-Checked "ego-edge.cmd" @("launch")
  & "ego-edge.cmd" doctor
  if ($LASTEXITCODE -ne 0) {
    Fail "ego-edge doctor found a problem (see the FAIL lines above). README.md in this folder explains each one."
  }
}

Write-Host @"

Done. Next:
  1. In the agent Edge window that just opened, sign in to the work accounts
     agents should use (once; the agent profile keeps them).
  2. Restart OpenCode so it loads the ego-edge skill and the edge-devtools MCP.
  3. Try: "Use the ego-edge skill to open example.com and tell me its heading."

To update later, run this script again.
"@ -ForegroundColor Green
