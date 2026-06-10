# Portfolio Lab watchdog — keeps backend + frontend + ngrok alive forever.
#
# Why this exists: the Startup-folder shortcut fires ONCE at logon with no
# recovery. ngrok on the free tier drops tunnels (and can fail to connect if
# the network isn't ready right after boot), so the public URL goes offline
# (ERR_NGROK_3200) and nothing brings it back. This script runs continuously,
# checks every CHECK_INTERVAL seconds, and restarts whatever is down —
# including the case where ngrok's PROCESS is alive but its TUNNEL has
# dropped (detected via the local ngrok API on :4040).
#
# Singleton: if another watchdog is already running it exits immediately, so
# launching it from multiple triggers (Startup shortcut + scheduled task) is
# harmless.
#
# Launched at logon by register-autostart.ps1. Logs to logs/watchdog.log.

$ErrorActionPreference = "Continue"

$root = "C:\Users\Admin\Desktop\Nobel\portfolio-lab"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$wlog = Join-Path $logDir "watchdog.log"

$CHECK_INTERVAL = 30   # seconds between health checks
$NGROK_DOMAIN = "portfolio-lab-yevhen.ngrok-free.dev"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $wlog -Value "$ts  $msg"
}

# ---- Singleton guard: a session-local named mutex ----
# Process-cmdline scanning is unreliable here — any launcher or diagnostic
# command that merely MENTIONS "watchdog.ps1" matches and produces a false
# "already running" positive, so the real watchdog kept exiting on startup.
# A named mutex is race-free and auto-releases when this process dies.
$me = $PID
$script:_mutex = New-Object System.Threading.Mutex($false, "Local\PortfolioLabWatchdog")
$acquired = $false
try { $acquired = $script:_mutex.WaitOne(0) } catch { $acquired = $true }  # AbandonedMutex = prior died -> we own it
if (-not $acquired) {
    Log "Another watchdog already holds the mutex; exiting (PID $me)."
    exit 0
}

Log "==== Watchdog started (PID $me) ===="

# ---- Resolve ngrok binary (winget install path; not on PATH for tasks) ----
$ngrokExe = $null
$cmd = Get-Command ngrok -ErrorAction SilentlyContinue
if ($cmd) { $ngrokExe = $cmd.Source }
else {
    $p = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    if (Test-Path $p) { $ngrokExe = $p }
}

function Test-Port([int]$port) {
    $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-Cmdline([string]$procName, [string]$needle) {
    $hit = Get-CimInstance Win32_Process -Filter "Name='$procName'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$needle*" }
    return $null -ne $hit
}

function Test-NgrokTunnel {
    # Process alive AND the local API reports a tunnel for our domain.
    if (-not (Get-Process ngrok -ErrorAction SilentlyContinue)) { return $false }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:4040/api/tunnels" -UseBasicParsing -TimeoutSec 4
        return $r.Content -like "*$NGROK_DOMAIN*"
    } catch {
        return $false
    }
}

function Start-Backend {
    $py = Join-Path $root "backend\.venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { Log "[backend] venv python missing at $py"; return }
    $args = @("-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000","--reload")
    $lp = Join-Path $logDir "uvicorn.log"
    Start-Process -FilePath $py -ArgumentList $args -WorkingDirectory (Join-Path $root "backend") `
        -WindowStyle Hidden -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Log "[backend] (re)started"
}

function Start-Frontend {
    $lp = Join-Path $logDir "vite.log"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev" `
        -WorkingDirectory (Join-Path $root "frontend") `
        -WindowStyle Hidden -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Log "[frontend] (re)started"
}

function Restart-Ngrok {
    if (-not $ngrokExe) { Log "[ngrok] binary not found"; return }
    # Kill any stale ngrok first so a half-dead process doesn't hold :4040.
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    $lp = Join-Path $logDir "ngrok.log"
    Start-Process -FilePath $ngrokExe `
        -ArgumentList "http","--domain=$NGROK_DOMAIN","5173","--log=stdout" `
        -WindowStyle Hidden -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Log "[ngrok] (re)started"
}

# ---------------------------- monitor loop ----------------------------
while ($true) {
    try {
        if (-not ((Test-Port 8000) -or (Test-Cmdline "python.exe" "uvicorn"))) {
            Log "[backend] DOWN -> starting"
            Start-Backend
            Start-Sleep 8   # give uvicorn its cold-start before the next checks
        }
        if (-not ((Test-Port 5173) -or (Test-Cmdline "node.exe" "vite"))) {
            Log "[frontend] DOWN -> starting"
            Start-Frontend
            Start-Sleep 5
        }
        # ngrok only matters once the frontend it points at is up.
        if (Test-Port 5173) {
            if (-not (Test-NgrokTunnel)) {
                Log "[ngrok] tunnel DOWN -> restarting"
                Restart-Ngrok
                Start-Sleep 6
            }
        }
    } catch {
        Log "loop error: $_"
    }
    Start-Sleep $CHECK_INTERVAL
}
