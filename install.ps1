#Requires -Version 5.1
<#
.SYNOPSIS
  Install petdex-overlay into %USERPROFILE%\.petdex and wire agent hooks.

.DESCRIPTION
  Copies the overlay runtime, seeds the sample pet + loot catalog (without
  touching existing saves), installs hook entries for Cursor and/or Kimi Code,
  and optionally starts the pet.

.PARAMETER Agents
  One or more of: cursor, kimi. Defaults to every supported agent found on
  this machine.

.PARAMETER NoStart
  Install files and hooks, but do not start the overlay.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents cursor -NoStart
#>
[CmdletBinding()]
param(
    [string[]]$Agents,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$HomeDir = $env:USERPROFILE
$PetdexHome = if ($env:PETDEX_HOME) { $env:PETDEX_HOME } else { Join-Path $HomeDir ".petdex" }
$OverlayDir = Join-Path $PetdexHome "overlay"
$PetsDir = Join-Path $PetdexHome "pets"
$DeltaDir = Join-Path $PetdexHome "delta"
$RuntimeDir = Join-Path $PetdexHome "runtime"
$CursorDir = Join-Path $HomeDir ".cursor"
$KimiDir = Join-Path $HomeDir ".kimi-code"

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  ok  $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Yellow }

function Find-NodeExe {
    $candidates = @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    $where = (& where.exe node 2>$null | Select-Object -First 1)
    if ($where -and (Test-Path $where)) { return $where }
    throw "node.exe not found. Install Node.js 18+ first: https://nodejs.org/"
}

function Find-Pythonw {
    if ($env:PETDEX_PYTHONW -and (Test-Path $env:PETDEX_PYTHONW)) {
        return $env:PETDEX_PYTHONW
    }
    $candidates = @()
    foreach ($base in @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python"),
        (Join-Path $HomeDir "miniconda3"),
        (Join-Path $HomeDir "anaconda3"),
        (Join-Path $env:LOCALAPPDATA "miniconda3"),
        (Join-Path $env:LOCALAPPDATA "anaconda3")
    )) {
        if (-not (Test-Path $base)) { continue }
        Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $p = Join-Path $_.FullName "pythonw.exe"
            if (Test-Path $p) { $candidates += $p }
        }
        $p = Join-Path $base "pythonw.exe"
        if (Test-Path $p) { $candidates += $p }
    }
    foreach ($p in $candidates) { return $p }
    $where = (& where.exe pythonw 2>$null | Select-Object -First 1)
    if ($where -and (Test-Path $where)) { return $where }
    return $null
}

function Test-PythonDeps([string]$Pythonw) {
    $python = Join-Path (Split-Path -Parent $Pythonw) "python.exe"
    if (-not (Test-Path $python)) { $python = $Pythonw }
    & $python -c "import PIL, win32gui, win32con" 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Backup-File([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $dest = "$Path.petdex-backup-$stamp"
    Copy-Item $Path $dest -Force
    Write-Host "  backup: $dest" -ForegroundColor DarkGray
}

function Write-JsonFile([string]$Path, $Object) {
    $json = $Object | ConvertTo-Json -Depth 20
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8)
}

function Install-CursorHooks([string]$NodeExe, [string]$Bridge) {
    New-Item -ItemType Directory -Force -Path $CursorDir | Out-Null
    $hooksPath = Join-Path $CursorDir "hooks.json"
    $events = [ordered]@{
        workspaceOpen       = @{ event = "workspace-open"; timeout = 10 }
        sessionStart        = @{ event = "boot"; timeout = 10 }
        sessionEnd          = @{ event = "session-end"; timeout = 5 }
        beforeSubmitPrompt  = @{ event = "user-prompt"; timeout = 5 }
        preToolUse          = @{ event = "pre"; timeout = 5 }
        postToolUse         = @{ event = "post"; timeout = 5 }
        postToolUseFailure  = @{ event = "post"; timeout = 5 }
        afterAgentResponse  = @{ event = "ensure-idle"; timeout = 5 }
        stop                = @{ event = "stop"; timeout = 5 }
    }

    $existing = $null
    if (Test-Path $hooksPath) {
        Backup-File $hooksPath
        try {
            $existing = Get-Content $hooksPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            throw "Cannot parse $hooksPath. Fix or remove it, then re-run install.ps1"
        }
    } else {
        $existing = [pscustomobject]@{}
    }
    if (-not $existing.PSObject.Properties["version"]) {
        $existing | Add-Member -NotePropertyName version -NotePropertyValue 1 -Force
    }
    if (-not $existing.PSObject.Properties["hooks"]) {
        $existing | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
    }

    foreach ($name in $events.Keys) {
        $spec = $events[$name]
        $command = '"' + $NodeExe + '" "' + $Bridge + '" cursor ' + $spec.event
        $entry = [pscustomobject]@{
            command = $command
            timeout = $spec.timeout
        }
        $current = @()
        if ($existing.hooks.PSObject.Properties[$name]) {
            $current = @($existing.hooks.$name)
        }
        $filtered = @($current | Where-Object {
            $_.command -notmatch 'petdex' -and $_.command -notmatch 'bridge\.mjs'
        })
        $merged = @($filtered + $entry)
        $existing.hooks | Add-Member -NotePropertyName $name -NotePropertyValue $merged -Force
    }

    Write-JsonFile $hooksPath $existing
    Write-Ok "Cursor hooks merged into $hooksPath"
}

function Install-KimiHooks([string]$NodeExe, [string]$Bridge) {
    $configPath = Join-Path $KimiDir "config.toml"
    New-Item -ItemType Directory -Force -Path $KimiDir | Out-Null
    if (Test-Path $configPath) { Backup-File $configPath }
    $text = ""
    if (Test-Path $configPath) {
        $text = Get-Content $configPath -Raw -Encoding UTF8
    }

    # Drop a previous generated block, then any hook block that references petdex.
    $text = [regex]::Replace($text, '(?ms)^# >>> petdex.*?^# <<< petdex[^\r\n]*\r?\n?', '')
    $parts = [regex]::Split($text, '(?m)(?=^\[\[hooks\]\])')
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($part in $parts) {
        if ($part -match '(?m)^\[\[hooks\]\]' -and $part -match 'petdex') { continue }
        $kept.Add($part)
    }
    $text = ($kept -join "").TrimEnd()

    $nodeToml = $NodeExe.Replace('\', '/')
    $bridgeToml = $Bridge.Replace('\', '/')
    $events = @(
        @{ toml = "SessionStart"; event = "workspace-open"; timeout = 15 },
        @{ toml = "SessionEnd"; event = "session-end"; timeout = 5 },
        @{ toml = "UserPromptSubmit"; event = "user-prompt"; timeout = 15 },
        @{ toml = "PreToolUse"; event = "pre"; timeout = 5 },
        @{ toml = "PostToolUse"; event = "post"; timeout = 5 },
        @{ toml = "PostToolUseFailure"; event = "post"; timeout = 5 },
        @{ toml = "Stop"; event = "stop"; timeout = 15 },
        @{ toml = "Interrupt"; event = "interrupt"; timeout = 15 },
        @{ toml = "StopFailure"; event = "stop-failure"; timeout = 15 },
        @{ toml = "Notification"; event = "notification"; timeout = 5 }
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("")
    $lines.Add("# >>> petdex overlay >>>")
    foreach ($spec in $events) {
        $cmd = 'node \"' + $nodeToml + '\" \"' + $bridgeToml + '\" kimi ' + $spec.event
        $lines.Add("[[hooks]]")
        $lines.Add('event = "' + $spec.toml + '"')
        $lines.Add('command = "' + $cmd + '"')
        $lines.Add('timeout = ' + $spec.timeout)
        $lines.Add("")
    }
    $lines.Add("# <<< petdex overlay <<<")
    $text = $text + "`r`n" + ($lines -join "`r`n") + "`r`n"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $text, $utf8)
    Write-Ok "Kimi Code hooks merged into $configPath"
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "petdex-overlay installer" -ForegroundColor Magenta
Write-Host "repo:    $Repo"
Write-Host "data:    $PetdexHome"
Write-Host ""

if (-not $Agents -or $Agents.Count -eq 0) {
    $Agents = @()
    if (Test-Path $CursorDir) { $Agents += "cursor" }
    if (Test-Path $KimiDir) { $Agents += "kimi" }
    if ($Agents.Count -eq 0) {
        Write-Warn "No Cursor / Kimi Code config folder found; installing the overlay only."
        $Agents = @()
    }
}
$Agents = @(
    $Agents |
        ForEach-Object { $_ -split "," } |
        ForEach-Object { $_.Trim().ToLower() } |
        Where-Object { $_ } |
        Select-Object -Unique
)
foreach ($a in $Agents) {
    if ($a -notin @("cursor", "kimi")) { throw "Unknown agent: $a (expected cursor or kimi)" }
}

$node = Find-NodeExe
Write-Ok "node: $node"

Write-Step "Copying overlay runtime"
New-Item -ItemType Directory -Force -Path $OverlayDir, $RuntimeDir, $PetsDir, $DeltaDir | Out-Null
Copy-Item (Join-Path $Repo "overlay\*") $OverlayDir -Recurse -Force
Copy-Item (Join-Path $Repo "hooks\bridge.mjs") $OverlayDir -Force
Copy-Item (Join-Path $Repo "hooks\delay-down.mjs") $OverlayDir -Force
Write-Ok "runtime -> $OverlayDir"

Write-Step "Seeding data (existing saves are kept)"
$itemsDst = Join-Path $DeltaDir "items.json"
if (-not (Test-Path $itemsDst)) {
    Copy-Item (Join-Path $Repo "data\items.json") $itemsDst -Force
    Write-Ok "loot catalog installed"
} else {
    Write-Ok "loot catalog already exists, kept"
}
$activePath = Join-Path $PetdexHome "active.json"
if (-not (Test-Path $activePath)) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($activePath, '{"slug":"sample"}', $utf8)
}
$existingPets = @(Get-ChildItem $PetsDir -Directory -ErrorAction SilentlyContinue)
if ($existingPets.Count -eq 0) {
    Copy-Item (Join-Path $Repo "pets\sample") $PetsDir -Recurse -Force
    Write-Ok "sample pet installed"
} else {
    Write-Ok "$($existingPets.Count) pet(s) already installed, kept"
}
New-Item -ItemType Directory -Force -Path (Join-Path $PetdexHome "novel") | Out-Null

Write-Step "Checking Python overlay dependencies"
$pythonw = Find-Pythonw
if (-not $pythonw) {
    Write-Warn "pythonw.exe not found. Install Python 3.10+ and run: python -m pip install pillow pywin32"
    $pythonOk = $false
} elseif (Test-PythonDeps $pythonw) {
    Write-Ok "Pillow + pywin32 OK ($pythonw)"
    $pythonOk = $true
} else {
    Write-Warn "$pythonw is missing Pillow / pywin32. Run: python -m pip install pillow pywin32"
    $pythonOk = $false
}

$bridge = Join-Path $OverlayDir "bridge.mjs"
if ($Agents -contains "cursor") {
    Write-Step "Installing Cursor hooks"
    Install-CursorHooks -NodeExe $node -Bridge $bridge
    $cmdSrc = Join-Path $Repo "integrations\cursor\commands\petdex.md"
    $cmdDir = Join-Path $CursorDir "commands"
    New-Item -ItemType Directory -Force -Path $cmdDir | Out-Null
    Copy-Item $cmdSrc $cmdDir -Force
    Write-Ok "Cursor /petdex command installed"
}
if ($Agents -contains "kimi") {
    Write-Step "Installing Kimi Code hooks"
    Install-KimiHooks -NodeExe $node -Bridge $bridge
}

if (-not $NoStart) {
    if ($pythonOk) {
        Write-Step "Starting overlay"
        & $node (Join-Path $OverlayDir "petdex.mjs") up
    } else {
        Write-Warn "Skipped start: Python dependencies are missing."
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Check:  node `"$OverlayDir\petdex.mjs`" doctor"
Write-Host "  Status: node `"$OverlayDir\petdex.mjs`" status"
Write-Host ""
Write-Host "Open Cursor / Kimi Code and send a prompt. The pet reacts to hook events."
Write-Host "Right-click the pet to close it; double-click opens one pending crate."
