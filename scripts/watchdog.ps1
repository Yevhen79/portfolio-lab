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

function Test-NgrokProcess {
    return $null -ne (Get-Process ngrok -ErrorAction SilentlyContinue)
}

function Test-PublicUrl {
    # AUTHORITATIVE end-to-end check: hit the PUBLIC url and confirm our
    # backend answers. ngrok's LOCAL api (:4040) keeps reporting the tunnel
    # as present even after its edge connection to the ngrok cloud has
    # dropped (that is exactly ERR_NGROK_3200) — so the old local-only check
    # was blind to the real failure. Going out through the public edge and
    # back is the only reliable signal that users can actually reach the app.
    try {
        $r = Invoke-WebRequest -Uri "https://$NGROK_DOMAIN/api/health" -UseBasicParsing -TimeoutSec 8
        return ($r.StatusCode -eq 200 -and $r.Content -like "*Portfolio Lab*")
    } catch {
        return $false
    }
}

function Start-Backend {
    $py = Join-Path $root "backend\.venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { Log "[backend] venv python missing at $py"; return }
    # NO --reload for the always-on deploy: --reload spawns a watcher +
    # subprocess worker, and on this box the worker resolved to SYSTEM python
    # (not the venv), so stale system-python uvicorns kept fighting over :8000
    # and serving old code. A single plain process uses exactly this venv
    # interpreter. Code changes are picked up on the next restart (crash-
    # restart by the watchdog, or a manual kill).
    $args = @("-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000")
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
$ngrokFails = 0   # consecutive public-URL failures (debounce against blips)
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
        # ngrok only matters once the frontend it points at is up locally —
        # otherwise a public-URL failure would just reflect the local app
        # being down, not the tunnel.
        if (Test-Port 5173) {
            if (-not (Test-NgrokProcess)) {
                # No agent at all -> restart immediately.
                Log "[ngrok] process down -> restarting"
                Restart-Ngrok
                $ngrokFails = 0
                Start-Sleep 8
            }
            elseif (-not (Test-PublicUrl)) {
                # Process alive but the public edge isn't serving us. Could be
                # a transient network blip, so require 2 consecutive failures
                # before recycling to avoid thrashing.
                $ngrokFails++
                Log "[ngrok] public URL unreachable (strike $ngrokFails/2)"
                if ($ngrokFails -ge 2) {
                    Log "[ngrok] edge down -> restarting tunnel"
                    Restart-Ngrok
                    $ngrokFails = 0
                    Start-Sleep 8
                }
            }
            else {
                $ngrokFails = 0
            }
        }
    } catch {
        Log "loop error: $_"
    }
    Start-Sleep $CHECK_INTERVAL
}
