@echo off
REM Portfolio Lab — first-time setup. Run once before start.bat.
REM Installs Python deps, npm deps, copies .env, seeds the database.

setlocal
cd /d "%~dp0"

echo ============================================================
echo  Portfolio Lab — first-time setup
echo  (this can take 5-10 minutes on first run)
echo ============================================================
echo.

REM ---------- Pick Python ----------
set "PY="
where py >nul 2>&1 && (
    py -3.11 --version >nul 2>&1 && set "PY=py -3.11"
)
if not defined PY (
    py -3.13 --version >nul 2>&1 && set "PY=py -3.13"
)
if not defined PY (
    echo ERROR: Python 3.11 or 3.13 not found. Install one of them and retry.
    exit /b 1
)
echo Using Python: %PY%
%PY% --version

REM ---------- Backend ----------
echo.
echo === Backend ===
cd backend

if exist .venv (
    echo Removing previous .venv to ensure a clean install...
    rmdir /s /q .venv
)

echo Creating Python venv...
%PY% -m venv .venv
if errorlevel 1 (
    echo ERROR: failed to create venv.
    exit /b 1
)

call .venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip wheel setuptools

echo Installing backend dependencies (uses prebuilt wheels only)...
python -m pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 (
    echo.
    echo Wheel-only install failed. Retrying without --only-binary...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: pip install failed. See messages above.
        exit /b 1
    )
)

if not exist .env (
    copy .env.example .env >nul
    echo Created .env from .env.example
)

echo Seeding database (admin user + Libertex universe)...
python seed.py
if errorlevel 1 (
    echo ERROR: seed.py failed.
    exit /b 1
)

cd ..

REM ---------- Frontend ----------
echo.
echo === Frontend ===
cd frontend

echo Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    exit /b 1
)

cd ..

echo.
echo ============================================================
echo  Setup complete.
echo  Next: run start.bat to launch backend + frontend + tunnel.
echo ============================================================
echo.
endlocal
