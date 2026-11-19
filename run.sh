#!/usr/bin/env bash
# Pathshala exam app — one-command runner.
# Stops any previous server, verifies/repairs the database, builds the Rust
# release binary, starts the server and waits until it answers /api/health.
#
# Usage:
#   ./run.sh                 # build + start on port 8080
#   NO_BUILD=1 ./run.sh      # skip cargo build (faster restart)
#   PORT=9000 ./run.sh       # custom port

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
LOG="/tmp/opencode/pathshala.log"
PIDFILE="pathshala.pid"

echo "==> Stopping previous Pathshala sessions..."
OLD="$(pgrep -f 'target/release/pathshala' || true)"
if [ -n "$OLD" ]; then
  echo "$OLD" | xargs -r kill 2>/dev/null || true
  sleep 1
  STILL="$(pgrep -f 'target/release/pathshala' || true)"
  if [ -n "$STILL" ]; then
    echo "$STILL" | xargs -r kill -9 2>/dev/null || true
    sleep 1
  fi
  echo "    stopped: $OLD"
else
  echo "    none running"
fi

echo "==> Checking database..."
if [ ! -f data/pathshala.db ]; then
  echo "    DB missing — creating from refined source DB"
  python3 ../scripts/prepare_app_db.py
elif ! sqlite3 data/pathshala.db "PRAGMA integrity_check;" 2>/dev/null | grep -q '^ok$'; then
  echo "    DB is malformed — rebuilding from refined source DB"
  rm -f data/pathshala.db data/pathshala.db-wal data/pathshala.db-shm
  python3 ../scripts/prepare_app_db.py
else
  echo "    integrity ok"
fi

if [ "${NO_BUILD:-0}" != "1" ]; then
  echo "==> Building release binary..."
  cargo build --release
else
  echo "==> Skipping build (NO_BUILD=1)"
fi

echo "==> Starting server on port $PORT..."
mkdir -p "$(dirname "$LOG")"
PORT="$PORT" nohup ./target/release/pathshala > "$LOG" 2>&1 &
echo $! > "$PIDFILE"

echo "==> Waiting for health check..."
READY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: server did not become healthy. Last log lines:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

echo
echo "OK — Pathshala is running."
echo "  App:     http://localhost:${PORT}/"
echo "  Health:  http://localhost:${PORT}/api/health"
echo "  PID:     $(cat "$PIDFILE")"
echo "  Log:     $LOG"
