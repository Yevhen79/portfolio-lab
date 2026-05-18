# Portfolio Lab - start backend + frontend + ngrok tunnel.
#
# Idempotent: if a service is already listening on its port it's left alone,
# so the script is safe to run repeatedly. Designed to be triggered by a
# scheduled task at user logon (see register-autostart.ps1) and also
# runnable on demand from an interactive PowerShell.
#
# Logs:
#   logs/uvicorn.log  - backend stdout+stderr
#   logs/vite.log     - frontend dev server
#   logs/ngrok.log    - tunnel agent
#
# Exit codes are NOT meaningful - the script always tries to bring up all
# three services and reports what happened on stdout, but doesn't return
# non-zero if one fails. The scheduled task should ignore exit codes.

$ErrorActionPreference = "Continue"

# Project root is two levels up from this script (scripts/ -> project root).
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\backend\app\main.py")) {
    # Fallback: hard-coded path if invoked in an odd way.
    $root = "C:\Users\Admin\Desktop\Nobel\portfolio-lab"
}
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Wall-clock marker so a fresh log file run is easy to find in the tail.
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Output "============================================================"
Write-Output " Portfolio Lab startup @ $stamp"
Write-Output " Root: $root"
Write-Output "============================================================"

function Test-PortListening([int]$port) {
    # Get-NetTCPConnection throws when no match; suppress to a boolean.
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

function Test-ProcessRunning([string]$name) {
    $proc = Get-Process -Name $name -ErrorAction SilentlyContinue
    return $null -ne $proc
}

# Resolve ngrok binary - winget install puts it under LOCALAPPDATA so
# `ngrok` isn't on PATH for non-interactive scheduled tasks.
$ngrokExe = $null
$cmd = Get-Command ngrok -ErrorAction SilentlyContinue
if ($cmd) {
    $ngrokExe = $cmd.Source
} else {
    $wingetPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    if (Test-Path $wingetPath) { $ngrokExe = $wingetPath }
}

# ---------- 1. Backend (uvicorn on :8000) ----------
if (Test-PortListening 8000) {
    Write-Output "[backend] already listening on 8000, skipping"
} else {
    $pyExe = Join-Path $root "backend\.venv\Scripts\python.exe"
    if (-not (Test-Path $pyExe)) {
        Write-Output "[backend] ERROR: venv python not found at $pyExe"
    } else {
        $args = @("-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--reload")
        $logPath = Join-Path $logDir "uvicorn.log"
        Start-Process -FilePath $pyExe `
            -ArgumentList $args `
            -WorkingDirectory (Join-Path $root "backend") `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logPath `
            -RedirectStandardError "$logPath.err" | Out-Null
        Write-Output "[backend] launched, log: $logPath"
    }
}

# ---------- 2. Frontend (Vite on :5173) ----------
if (Test-PortListening 5173) {
    Write-Output "[frontend] already listening on 5173, skipping"
} else {
    # npm on Windows is a .cmd shim - launch via cmd.exe so Start-Process
    # resolves it correctly even when the scheduled task has a stripped PATH.
    $logPath = Join-Path $logDir "vite.log"
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c","npm","run","dev" `
        -WorkingDirectory (Join-Path $root "frontend") `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError "$logPath.err" | Out-Null
    Write-Output "[frontend] launched via cmd, log: $logPath"
}

# ---------- 3. ngrok tunnel ----------
# The reserved domain `portfolio-lab-yevhen.ngrok-free.dev` is pinned to the
# free-tier account in $env:LOCALAPPDATA\ngrok\ngrok.yml. We pass the domain
# explicitly so the same dev URL survives reboots and reconnects.
if (Test-ProcessRunning "ngrok") {
    Write-Output "[ngrok] already running, skipping"
} elseif (-not $ngrokExe) {
    Write-Output "[ngrok] ERROR: ngrok binary not found (run 'winget install Ngrok.Ngrok')"
} else {
    $logPath = Join-Path $logDir "ngrok.log"
    Start-Process -FilePath $ngrokExe `
        -ArgumentList "http","--domain=portfolio-lab-yevhen.ngrok-free.dev","5173","--log=stdout" `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError "$logPath.err" | Out-Null
    Write-Output "[ngrok] launched, log: $logPath"
}

Write-Output ""
Write-Output "All services kicked off. Wait ~15s for uvicorn cold-start, then:"
Write-Output "  http://localhost:8000/api/health"
Write-Output "  http://localhost:5173/"
Write-Output "  https://portfolio-lab-yevhen.ngrok-free.dev/"
