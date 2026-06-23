# Kill any running watchdog and launch a fresh one (picks up code changes).
# The watchdog's mutex guarantees a single instance, but to load NEW code you
# must restart the process — this does that deterministically.
$ErrorActionPreference = "Continue"
$wd = Join-Path $PSScriptRoot "watchdog.ps1"

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*watchdog.ps1*" -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$wd `
    -WindowStyle Hidden
Start-Sleep -Seconds 6

$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*watchdog.ps1*" -and $_.ProcessId -ne $PID }
Write-Output ("watchdog instances running: {0}" -f @($procs).Count)
@($procs) | ForEach-Object { Write-Output ("  PID {0}  started {1}" -f $_.ProcessId, $_.CreationDate) }
Write-Output "--- recent watchdog.log ---"
Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) "logs\watchdog.log") -Tail 4 -ErrorAction SilentlyContinue
