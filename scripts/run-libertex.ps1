# Launch the LIBERTEX edition alongside the primary (full) instance.
#
#   full     : backend :8000  +  vite :5173   (the monetised, generic product)
#   libertex : backend :8001  +  vite :5174   (this script — Libertex-branded)
#
# Same codebase, selected by EDITION=libertex (drives features + branding +
# red theme). Uses its OWN SQLite copy so the two instances don't contend on
# writes. Env vars set here override .env (pydantic-settings precedence);
# SECRET_KEY / ADMIN_* still come from backend/.env.
#
# Idempotent: skips a service that's already listening.

$ErrorActionPreference = "Continue"
$root = "C:\Users\Admin\Desktop\Nobel\portfolio-lab"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Port([int]$p) { $null -ne (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }

# --- one-time DB copy so libertex has an independent database ---
$fullDb = Join-Path $root "backend\data\portfolio_lab.db"
$libDb  = Join-Path $root "backend\data\portfolio_lab_libertex.db"
if (-not (Test-Path $libDb)) {
    Copy-Item $fullDb $libDb -ErrorAction SilentlyContinue
    Write-Output "Created libertex DB copy: $libDb"
}

# --- backend :8001, EDITION=libertex ---
if (Test-Port 8001) {
    Write-Output "[libertex backend] already on :8001, skipping"
} else {
    $py = Join-Path $root "backend\.venv\Scripts\python.exe"
    $env:EDITION = "libertex"
    $env:DATABASE_URL = "sqlite:///./data/portfolio_lab_libertex.db"
    $env:CORS_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
    $lp = Join-Path $logDir "libertex-backend.log"
    Start-Process -FilePath $py `
        -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8001" `
        -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden `
        -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Write-Output "[libertex backend] launched on :8001 (EDITION=libertex)"
}

# --- frontend :5174, proxying /api -> :8001 (dedicated config, deterministic) ---
if (Test-Port 5174) {
    Write-Output "[libertex frontend] already on :5174, skipping"
} else {
    $lp = Join-Path $logDir "libertex-frontend.log"
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c","npx","vite","--config","vite.libertex.config.ts" `
        -WorkingDirectory (Join-Path $root "frontend") -WindowStyle Hidden `
        -RedirectStandardOutput $lp -RedirectStandardError "$lp.err"
    Write-Output "[libertex frontend] launched on :5174 (proxy -> :8001)"
}

Write-Output ""
Write-Output "Libertex edition (wait ~15s for cold start):  http://localhost:5174"
Write-Output "Full edition (unchanged):                     http://localhost:5173  /  ngrok"
