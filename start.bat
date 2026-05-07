@echo off
REM Portfolio Lab — launches backend, frontend, and (optionally) Cloudflare Tunnel.
REM Usage:
REM   start.bat               -> backend + frontend + Cloudflare quick tunnel
REM   start.bat --no-tunnel   -> backend + frontend only
REM   start.bat --backend     -> backend only
REM   start.bat --frontend    -> frontend only

setlocal
cd /d "%~dp0"

set TUNNEL=1
if /I "%~1"=="--no-tunnel" set TUNNEL=0
if /I "%~1"=="--backend"   set ONLY=backend
if /I "%~1"=="--frontend"  set ONLY=frontend

REM ---------- Sanity check ----------
if not exist backend\.venv\Scripts\activate.bat (
    echo .venv not found. Run setup.bat first.
    exit /b 1
)
if not exist frontend\node_modules (
    echo node_modules not found. Run setup.bat first.
    exit /b 1
)

REM ---------- Backend ----------
if not "%ONLY%"=="frontend" (
    echo Starting FastAPI backend on http://localhost:8000 ...
    start "Portfolio Lab — Backend" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
)

REM ---------- Frontend ----------
if not "%ONLY%"=="backend" (
    echo Starting Vite dev server on http://localhost:5173 ...
    start "Portfolio Lab — Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
)

REM ---------- Public Tunnel (localtunnel) ----------
REM We use localtunnel because Cloudflare's quick-tunnel API is unreachable
REM from some Russian ISPs. localtunnel works through different infra (loca.lt).
if "%TUNNEL%"=="1" if not "%ONLY%"=="backend" if not "%ONLY%"=="frontend" (
    echo Starting localtunnel (gives you a public *.loca.lt URL)...
    timeout /t 4 /nobreak >nul
    start "Portfolio Lab — Public Tunnel" cmd /k "npx -y localtunnel --port 5173"
)

echo.
echo ============================================================
echo  Portfolio Lab is starting in separate windows.
echo.
echo  Local URLs:
echo    Backend:  http://localhost:8000
echo    Frontend: http://localhost:5173
echo    LAN:      http://%COMPUTERNAME%:5173  (or your local IP)
echo.
echo  Login (admin):
echo    email:    evgenij.shakotko@gmail.com
echo    password: 12345
echo.
echo  Public URL appears in the "Public Tunnel" window
echo  after a few seconds. Look for "your url is:" line.
echo  First-time visitors will see a "tunnel password" gate;
echo  the password shown there is the public IP from the gate page itself.
echo ============================================================
echo.
endlocal
