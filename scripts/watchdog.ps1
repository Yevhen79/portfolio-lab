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
# Absolute path to the ngrok config that holds the authtoken (see Restart-Ngrok).
$NGROK_CONFIG = "C:\Users\Admin\AppData\Local\ngrok\ngrok.yml"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $wlog -Value "$ts  $msg"
}

# ---- Singleton guard: a session-local named mutex ----
# Process-cmdline scanning is unreliable here — any launcher or diagnostic
# command that merely MENTIONS "watchdog.ps1" matches and produces a false
# "already running" positive, so the real watchdog kept exiting on startup.
# A named mutex is race-free and auto-releases when this process dies.
#
# GLOBAL namespace (not Local\): the scheduled task can fire in a different
# session than an already-running interactive watchdog (e.g. after a sleep/wake
# before interactive logon). A session-local mutex wouldn't see the other one,
# so TWO watchdogs would run and both restart ngrok — and the free tier allows
# only ONE agent session, so they'd fight endlessly (ERR_NGROK auth/limit +
# constant tunnel churn). Global\ enforces a single watchdog machine-wide. All
# instances run as the same user (the task has no /ru SYSTEM), so there are no
# cross-user ACL issues opening the global mutex.
$me = $PID
$script:_mutex = New-Object System.Threading.Mutex($false, "Global\PortfolioLabWatchdog")
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

function Test-Cmdline([string]$procName, [string]$needle, [string]$exclude = $null) {
    # $exclude lets a check target ONE edition's process: the Full and Libertex
    # instances both run "uvicorn" and "vite", so an un-excluded needle matches
    # either — which masked a dead Full service whenever Libertex was alive and
    # left the Full frontend/backend unsupervised. Full checks exclude the
    # Libertex port/config; Libertex checks use their own distinct needles.
    $hit = Get-CimInstance Win32_Process -Filter "Name='$procName'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and $_.CommandLine -like "*$needle*" -and
            (-not $exclude -or $_.CommandLine -notlike "*$exclude*")
        }
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
    # Point ngrok at an EXPLICIT config path holding the authtoken. Without this
    # ngrok reads %LOCALAPPDATA%\ngrok\ngrok.yml, which resolves differently
    # depending on the launching context (scheduled task S4U token, a non-loaded
    # profile, SYSTEM, etc.) — and if it can't find the token it dies instantly
    # with ERR_NGROK_4018, so the watchdog just respawns a doomed process every
    # cycle. An absolute --config makes auth deterministic regardless of context.
    $ngrokArgs = @("http","--domain=$NGROK_DOMAIN","5173","--log=stdout")
    if (Test-Path $NGROK_CONFIG) { $ngrokArgs += @("--config", $NGROK_CONFIG) }
    Start-Process -FilePath $ngrokExe -ArgumentList $ngrokArgs `
        -WindowStyle Hidden -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Log "[ngrok] (re)started"
}

function Start-Libertex {
    # Libertex edition (8001 backend + 5174 frontend). Delegated to
    # run-libertex.ps1 so its env setup (EDITION=libertex, separate DB, CORS)
    # lives in ONE place and stays idempotent (it skips a port already up).
    #
    # CRITICAL: launched in a CHILD powershell, NOT dot-sourced. run-libertex.ps1
    # sets $env:EDITION=libertex, and env vars are process-global — dot-sourcing
    # would poison THIS watchdog's environment, so the next Full backend restart
    # would inherit EDITION=libertex and serve the wrong edition on :8000/ngrok.
    # A child process contains that pollution and dies immediately after.
    $script = Join-Path $root "scripts\run-libertex.ps1"
    if (-not (Test-Path $script)) { Log "[libertex] run-libertex.ps1 missing"; return }
    $lp = Join-Path $logDir "libertex-launch.log"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NonInteractive","-ExecutionPolicy","Bypass","-File",$script `
        -WindowStyle Hidden -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Log "[libertex] (re)started via run-libertex.ps1"
}

# ---------------------------- monitor loop ----------------------------
$ngrokFails = 0   # consecutive public-URL failures (debounce against blips)
while ($true) {
    try {
        # Full checks EXCLUDE the Libertex instance (:8001 backend, vite.libertex
        # frontend) so a dead Full service isn't masked by a live Libertex one.
        if (-not ((Test-Port 8000) -or (Test-Cmdline "python.exe" "uvicorn" "8001"))) {
            Log "[backend] DOWN -> starting"
            Start-Backend
            Start-Sleep 8   # give uvicorn its cold-start before the next checks
        }
        if (-not ((Test-Port 5173) -or (Test-Cmdline "node.exe" "vite" "libertex"))) {
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
        # Libertex edition (8001 backend + 5174 frontend). Independent of the
        # Full instance and its ngrok tunnel. Needles are edition-specific
        # ("8001", "vite.libertex") so they NEVER match the Full processes —
        # keeping this block from interfering with Full's own supervision. The
        # cmdline fallback covers the cold-start window (process alive, port not
        # yet bound) so we don't double-launch.
        $libBackUp  = (Test-Port 8001) -or (Test-Cmdline "python.exe" "8001")
        $libFrontUp = (Test-Port 5174) -or (Test-Cmdline "node.exe" "vite.libertex")
        if (-not $libBackUp -or -not $libFrontUp) {
            Log "[libertex] down (backend=$libBackUp frontend=$libFrontUp) -> starting"
            Start-Libertex
            Start-Sleep 12
        }
    } catch {
        Log "loop error: $_"
    }
    Start-Sleep $CHECK_INTERVAL
}
