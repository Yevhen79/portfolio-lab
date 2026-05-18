# Portfolio Lab - kill backend + frontend + ngrok.
# Useful when you want to manually restart the stack without rebooting.
#
# Strategy: match by CommandLine instead of relying on port owners.
# uvicorn --reload spawns a multiprocessing child that keeps listening
# even after the parent dies; npm spawns node children that survive its
# cmd shim. Walking the whole python/node/ngrok set by CommandLine
# substring catches every member of the tree regardless of PID hierarchy.

$ErrorActionPreference = "Continue"
Write-Output "Stopping Portfolio Lab services..."

$root = "C:\Users\Admin\Desktop\Nobel\portfolio-lab"
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Stop-ByCommandLine {
    param(
        [string]$processName,
        [string[]]$cmdLineNeedles,
        [string]$label
    )
    $hits = Get-CimInstance Win32_Process -Filter "Name='$processName'" -ErrorAction SilentlyContinue |
        Where-Object {
            if (-not $_.CommandLine) { return $false }
            foreach ($n in $cmdLineNeedles) {
                if ($_.CommandLine -like "*$n*") { return $true }
            }
            return $false
        }
    if (-not $hits) {
        Write-Output "  $label : no matching processes"
        return
    }
    foreach ($p in $hits) {
        Write-Output "  killing $label PID $($p.ProcessId)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# Backend: any python whose cmdline references uvicorn + app.main, OR
# anything launched from the backend venv. The multiprocessing-fork
# children carry the parent_pid in their cmdline but not the script
# name, so we also catch python processes started under backend\.venv.
Stop-ByCommandLine -processName "python.exe" `
    -cmdLineNeedles @("uvicorn","app.main:app","backend\.venv","multiprocessing-fork") `
    -label "backend (python)"

# Frontend: node processes whose cwd or args point at our frontend.
Stop-ByCommandLine -processName "node.exe" `
    -cmdLineNeedles @($frontend,"vite") `
    -label "frontend (node)"

# Also kill the cmd shim that npm sits behind, if any are still hanging.
Stop-ByCommandLine -processName "cmd.exe" `
    -cmdLineNeedles @("npm run dev") `
    -label "frontend (cmd shim)"

# ngrok runs out of a process name we can target directly.
$ngrok = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($ngrok) {
    foreach ($p in $ngrok) {
        Write-Output "  killing ngrok PID $($p.Id)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Output "  ngrok : not running"
}

Start-Sleep -Milliseconds 500

# Verify ports really released.
foreach ($port in 8000, 5173) {
    $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Output "  WARN: port ${port} still has a listener (PID $($still.OwningProcess))"
    }
}

Write-Output "Done."
