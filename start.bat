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
    start "Portfolio Lab — Backend" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
)

REM ---------- Frontend ----------
if not "%ONLY%"=="backend" (
    echo Starting Vite dev server on http://localhost:5173 ...
    start "Portfolio Lab — Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
)

REM ---------- Public Tunnel (ngrok) ----------
REM Uses ngrok with a reserved subdomain so the URL is stable across restarts.
REM Make sure `ngrok config add-authtoken <YOUR_TOKEN>` was run once on this machine.
REM Cloudflare quick tunnel is intentionally NOT used because some ISPs block
REM api.trycloudflare.com.
if "%TUNNEL%"=="1" if not "%ONLY%"=="backend" if not "%ONLY%"=="frontend" (
    where ngrok >nul 2>&1
    if errorlevel 1 (
        echo NOTE: ngrok not found on PATH. Skipping public tunnel.
        echo Install via:  winget install Ngrok.Ngrok
        echo Then: ngrok config add-authtoken YOUR_TOKEN
    ) else (
        echo Starting ngrok tunnel on portfolio-lab-yevhen.ngrok-free.dev ...
        timeout /t 4 /nobreak >nul
        start "Portfolio Lab — Public Tunnel" cmd /k "ngrok http 5173 --domain=portfolio-lab-yevhen.ngrok-free.dev"
    )
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
echo  Public URL: https://portfolio-lab-yevhen.ngrok-free.dev
echo  (the "Public Tunnel" window shows the connected status)
echo ============================================================
echo.
endlocal
