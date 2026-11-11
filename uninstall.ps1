#Requires -Version 5.1
<#
.SYNOPSIS
  Remove petdex-overlay hooks and runtime.

.PARAMETER PurgeData
  Also delete %USERPROFILE%\.petdex (pets, loot progress, novels).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeData
#>
[CmdletBinding()]
param(
    [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
$HomeDir = $env:USERPROFILE
$PetdexHome = if ($env:PETDEX_HOME) { $env:PETDEX_HOME } else { Join-Path $HomeDir ".petdex" }
$OverlayDir = Join-Path $PetdexHome "overlay"
$CursorDir = Join-Path $HomeDir ".cursor"
$KimiDir = Join-Path $HomeDir ".kimi-code"
$CodexDir = Join-Path $HomeDir ".codex"

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  ok  $Text" -ForegroundColor Green }

Write-Host ""
Write-Host "petdex-overlay uninstaller" -ForegroundColor Magenta
Write-Host ""

$cli = Join-Path $OverlayDir "petdex.mjs"
if (Test-Path $cli) {
    Write-Step "Stopping overlay"
    & node $cli down 2>$null
}

$cursorHooks = Join-Path $CursorDir "hooks.json"
if (Test-Path $cursorHooks) {
    Write-Step "Removing Cursor hooks"
    $json = Get-Content $cursorHooks -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($json.PSObject.Properties["hooks"]) {
        foreach ($prop in @($json.hooks.PSObject.Properties)) {
            $current = @($prop.Value)
            $filtered = @($current | Where-Object {
                $_.command -notmatch 'petdex' -and $_.command -notmatch 'bridge\.mjs'
            })
            $json.hooks | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $filtered -Force
        }
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Copy-Item $cursorHooks "$cursorHooks.petdex-uninstall-$stamp" -Force
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($cursorHooks, ($json | ConvertTo-Json -Depth 20), $utf8)
        Write-Ok "Cursor hooks cleaned"
    }
    $cmd = Join-Path $CursorDir "commands\petdex.md"
    if (Test-Path $cmd) { Remove-Item $cmd -Force; Write-Ok "Cursor /petdex command removed" }
}

$kimiConfig = Join-Path $KimiDir "config.toml"
if (Test-Path $kimiConfig) {
    Write-Step "Removing Kimi Code hooks"
    $text = Get-Content $kimiConfig -Raw -Encoding UTF8
    $text = [regex]::Replace($text, '(?ms)^# >>> petdex.*?^# <<< petdex[^\r\n]*\r?\n?', '')
    $parts = [regex]::Split($text, '(?m)(?=^\[\[hooks\]\])')
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($part in $parts) {
        if ($part -match '(?m)^\[\[hooks\]\]' -and $part -match 'petdex') { continue }
        $kept.Add($part)
    }
    $text = ($kept -join "").TrimEnd() + "`r`n"
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $kimiConfig "$kimiConfig.petdex-uninstall-$stamp" -Force
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($kimiConfig, $text, $utf8)
    Write-Ok "Kimi Code hooks cleaned"
}

$codexHooks = Join-Path $CodexDir "hooks.json"
if (Test-Path $codexHooks) {
    Write-Step "Removing Codex hooks"
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $codexHooks "$codexHooks.petdex-uninstall-$stamp" -Force
    & node (Join-Path $PSScriptRoot "tools\codex-hooks.mjs") remove $codexHooks
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove Codex hooks from $codexHooks" }
    Write-Ok "Codex hooks cleaned"
}

if ($PurgeData) {
    Write-Step "Purging data"
    if (Test-Path $PetdexHome) {
        Remove-Item $PetdexHome -Recurse -Force
        Write-Ok "removed $PetdexHome (including pets and progress)"
    }
} else {
    Write-Step "Removing runtime code"
    if (Test-Path $OverlayDir) { Remove-Item $OverlayDir -Recurse -Force }
    foreach ($name in @("overlay.pid", "watchdog.pid")) {
        $p = Join-Path $PetdexHome $name
        if (Test-Path $p) { Remove-Item $p -Force }
    }
    $runtime = Join-Path $PetdexHome "runtime"
    if (Test-Path $runtime) {
        Get-ChildItem $runtime -File | Remove-Item -Force
    }
    Write-Ok "runtime removed; pets, loot saves, and novels kept in $PetdexHome"
}

Write-Host ""
Write-Host "Done. Restart Codex / Cursor / Kimi Code to drop the hook definitions." -ForegroundColor Green
