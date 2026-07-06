# Install Portfolio Lab autostart for the current user.
#
# The durable mechanism is a REPEATING scheduled task that runs the watchdog
# (scripts/watchdog.ps1) every 5 minutes. The watchdog is a singleton (named
# mutex), so each tick is a no-op while it's alive — but if the watchdog ever
# dies (crash, kill, sleep/wake glitch), the next tick RESURRECTS it. No admin
# and no fresh logon required: a time-based task runs in the logged-on user's
# session without a stored password.
#
# Why not a logon trigger: this machine sleeps/wakes for weeks between full
# reboots, so a logon-only trigger (Startup folder or /sc ONLOGON) almost
# never fires. Also, /sc ONLOGON needs elevation on this host (Access Denied),
# while /sc MINUTE does not.
#
# A Startup-folder shortcut is kept as a belt-and-suspenders fallback.
#
# Run ONCE, interactively. Re-running updates both. Requires no admin.

$ErrorActionPreference = "Continue"

$watchdog = Join-Path $PSScriptRoot "watchdog.ps1"
if (-not (Test-Path $watchdog)) { throw "watchdog.ps1 not found ($watchdog)" }

$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`""
$taskName = "PortfolioLabWatchdog"

# ---------- 1. Repeating scheduled task (primary, self-resurrecting) ----------
$tr = "powershell.exe $psArgs"
$out = schtasks /create /sc minute /mo 5 /tn $taskName /tr $tr /f 2>&1
Write-Output ($out | Select-Object -First 1)
# Kick it once now so the watchdog comes up immediately (detached under the
# Task Scheduler service, so it survives this shell exiting).
schtasks /run /tn $taskName 2>&1 | Select-Object -First 1

# ---------- 2. Startup-folder shortcut (fallback) ----------
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "PortfolioLab.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)
$sc.TargetPath = "powershell.exe"
$sc.Arguments = $psArgs
$sc.WorkingDirectory = Split-Path -Parent $watchdog
$sc.Description = "Portfolio Lab watchdog - keeps backend, frontend, ngrok alive"
$sc.WindowStyle = 7
$sc.Save()
Write-Output "Startup shortcut installed: $shortcutPath"

Write-Output ""
Write-Output "Done. The watchdog now runs continuously and is re-launched every 5"
Write-Output "minutes if it ever dies. It keeps backend + frontend + ngrok up and"
Write-Output "self-heals dropped ngrok tunnels (end-to-end public-URL check)."
Write-Output ""
Write-Output "To remove:"
Write-Output "  schtasks /delete /tn '$taskName' /f"
Write-Output "  Remove-Item '$shortcutPath'"
