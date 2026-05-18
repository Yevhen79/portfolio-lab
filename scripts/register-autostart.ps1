# Install Portfolio Lab autostart for the current user.
#
# Drops a shortcut into the user's Startup folder that runs
# start-services.ps1 at every login. Idempotent - re-running it overwrites
# the existing shortcut. Does NOT require admin privileges (uses the
# per-user Startup folder, not the all-users one).
#
# Run ONCE, interactively, from any PowerShell. After that, every reboot
# (or wake-from-locked) will bring backend + frontend + ngrok back up
# automatically - no manual steps.
#
# To remove later, delete:
#   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PortfolioLab.lnk

$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "start-services.ps1"
if (-not (Test-Path $script)) {
    throw "start-services.ps1 not found next to this script ($script)"
}

# Per-user Startup folder - Windows runs everything in here at login.
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "PortfolioLab.lnk"

# We point the shortcut at powershell.exe with -WindowStyle Hidden so
# users don't see a console flash every time they log in. The script
# itself handles its own logging via Start-Process redirects.
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)
$sc.TargetPath = "powershell.exe"
$sc.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$sc.WorkingDirectory = Split-Path -Parent $script
$sc.Description = "Portfolio Lab - start backend, frontend, ngrok at login"
$sc.WindowStyle = 7   # 7 = minimised (matches -WindowStyle Hidden intent)
$sc.Save()

Write-Output "Installed autostart shortcut:"
Write-Output "  $shortcutPath"
Write-Output ""
Write-Output "Target: powershell.exe $($sc.Arguments)"
Write-Output ""
Write-Output "To test without rebooting, run start-services.ps1 directly."
Write-Output ""
Write-Output "To remove:"
Write-Output "  Remove-Item '$shortcutPath'"
