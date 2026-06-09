#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

NGROK=1
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --no-ngrok)  NGROK=0 ;;
    --backend)   ONLY=backend ;;
    --frontend)  ONLY=frontend ;;
  esac
done

if [ "$ONLY" != "frontend" ]; then
  echo "=== Backend setup ==="
  cd backend
  if [ ! -d .venv ]; then
    python3 -m venv .venv
  fi
  # shellcheck source=/dev/null
  source .venv/bin/activate
  [ ! -f .env ] && cp .env.example .env
  python -m pip install --upgrade pip -q
  python -m pip install -r requirements.txt -q
  python seed.py
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
  BACKEND_PID=$!
  cd ..
fi

if [ "$ONLY" != "backend" ]; then
  echo "=== Frontend setup ==="
  cd frontend
  [ ! -d node_modules ] && npm install
  npm run dev &
  FRONTEND_PID=$!
  cd ..
fi

if [ "$NGROK" = "1" ] && [ -z "$ONLY" ] && command -v ngrok >/dev/null 2>&1; then
  ngrok http 5173 &
  NGROK_PID=$!
fi

echo "Portfolio Lab running. Press Ctrl+C to stop."
wait
