# Install Portfolio Lab autostart for the current user.
#
# Sets up TWO independent triggers that both launch the watchdog
# (scripts/watchdog.ps1), which then keeps backend + frontend + ngrok alive
# forever and self-heals dropped ngrok tunnels. The watchdog is a singleton,
# so having two triggers is harmless redundancy:
#
#   1. A per-user Scheduled Task at logon (more reliable than the Startup
#      folder; survives more edge cases, runs with a short delay so the
#      network is up before ngrok dials). No admin required — it runs only
#      when the user is logged on.
#   2. A shortcut in the Startup folder (belt-and-suspenders fallback).
#
# Run ONCE, interactively, from any PowerShell. Re-running updates both.

$ErrorActionPreference = "Stop"

$watchdog = Join-Path $PSScriptRoot "watchdog.ps1"
if (-not (Test-Path $watchdog)) {
    throw "watchdog.ps1 not found next to this script ($watchdog)"
}

$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`""

# ---------- 1. Scheduled Task at logon ----------
$taskName = "PortfolioLabWatchdog"
$taskOk = $false
try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    # 30s delay so Wi-Fi / Ethernet is up before ngrok tries to connect.
    $trigger.Delay = "PT30S"
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    # Run only when this user is logged on -> no admin / no stored password.
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    $taskOk = $true
    Write-Output "Scheduled Task '$taskName' registered (logon trigger, 30s delay)."
} catch {
    Write-Output "Could not register Scheduled Task ($($_.Exception.Message))."
    Write-Output "Falling back to the Startup-folder shortcut only."
}

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
Write-Output "Done. After every logon the watchdog launches and keeps all three"
Write-Output "services up, restarting any that die (including dropped ngrok tunnels)."
Write-Output ""
Write-Output "Start it now without rebooting:"
Write-Output "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$watchdog`""
Write-Output ""
Write-Output "To remove:"
if ($taskOk) { Write-Output "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" }
Write-Output "  Remove-Item '$shortcutPath'"
