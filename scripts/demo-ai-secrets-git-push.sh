#!/usr/bin/env bash
# Trigger ai_secrets_git_push THROUGH the live TrustEdge Agent using REAL OS PIDs.
# - Resolves the live Cursor.app PID from the process table
# - Runs a real local-only `git push` (never GitHub) and captures that git PID
# - Drops events into the agent's inject/ folder for upload with the enrolled token
set -euo pipefail

BACKEND="${TRUSTEDGE_API_BASE_URL:-http://127.0.0.1:8000}"
REPO="${TRUSTEDGE_DEMO_GIT_REPO:-/tmp/trustedge-git-test}"
BARE="${TRUSTEDGE_DEMO_GIT_BARE:-/tmp/fake-origin.git}"
ENV_PATH="${REPO}/.env"

resolve_inject_dir() {
  if [[ -n "${TRUSTEDGE_AGENT_INJECT_DIR:-}" ]]; then
    echo "$TRUSTEDGE_AGENT_INJECT_DIR"
    return
  fi
  local te="$HOME/Library/Application Support/TrustEdge Agent"
  local twin="$HOME/Library/Application Support/TrustTwin"
  if [[ -f "$te/state.json" ]]; then
    echo "$te/inject"
  elif [[ -f "$twin/state.json" ]]; then
    echo "$twin/inject"
  else
    echo "$te/inject"
  fi
}

resolve_cursor_pid() {
  if [[ -n "${TRUSTEDGE_CURSOR_PID:-}" ]]; then
    echo "$TRUSTEDGE_CURSOR_PID"
    return
  fi
  # Main Cursor binary only (not helpers / crashpad / UI services).
  local pid
  pid="$(ps -axo pid=,args= \
    | awk '/\/Applications\/Cursor\.app\/Contents\/MacOS\/Cursor( |$)/ && $0 !~ /Helper/ { print $1; exit }')"
  if [[ -z "$pid" ]]; then
    pid="$(pgrep -f '/Applications/Cursor.app/Contents/MacOS/Cursor$' | head -1 || true)"
  fi
  echo "$pid"
}

ensure_local_git_demo() {
  mkdir -p "$REPO"
  if [[ ! -d "$BARE/objects" ]]; then
    git init --bare "$BARE" >/dev/null
  fi
  if [[ ! -d "$REPO/.git" ]]; then
    git -C "$REPO" init >/dev/null
    git -C "$REPO" remote add origin "$BARE"
  fi
  # Keep origin local-only (never rewrite to GitHub).
  git -C "$REPO" remote set-url origin "$BARE"
  git -C "$REPO" config user.email "demo@trustedge.local"
  git -C "$REPO" config user.name "TrustEdge Demo"
  printf 'DEMO_SECRET=not-a-real-credential\n' >"$ENV_PATH"
}

run_real_git_and_capture_pid() {
  # Stage .env then push to local bare repo; print the real git PID.
  git -C "$REPO" add .env >/dev/null
  python3 - "$REPO" <<'PY'
import subprocess, sys, time

repo = sys.argv[1]
# Keep git alive briefly so the PID is a real live process while we inject.
p = subprocess.Popen(
    ["/usr/bin/git", "-C", repo, "push", "origin", "HEAD:main"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
print(p.pid, flush=True)
# Hold the process handle until parent continues inject (~2s is enough).
time.sleep(2.5)
rc = p.wait(timeout=30)
sys.exit(rc if isinstance(rc, int) else 0)
PY
}

INJECT_DIR="$(resolve_inject_dir)"
mkdir -p "$INJECT_DIR"

if ! pgrep -f 'exe/trustedge-agent|cmd/trustedge-agent' >/dev/null 2>&1; then
  echo "ERROR: TrustEdge Agent is not running."
  echo "Start it first:"
  echo "  cd ../TrustEdge-Agent && make run-agent-local"
  exit 1
fi

CURSOR_PID="$(resolve_cursor_pid)"
if [[ -z "$CURSOR_PID" ]]; then
  echo "ERROR: Could not find a live Cursor.app PID."
  echo "Open Cursor, or set TRUSTEDGE_CURSOR_PID=<pid>."
  exit 1
fi
if ! ps -p "$CURSOR_PID" >/dev/null 2>&1; then
  echo "ERROR: Cursor PID $CURSOR_PID is not alive."
  exit 1
fi

ensure_local_git_demo

STAMP="$(date +%s)"
CURSOR_EXE="/Applications/Cursor.app/Contents/MacOS/Cursor"
CURSOR_COMM="Cursor"
CURSOR_CMDLINE="$CURSOR_EXE"

drop() {
  local name="$1"
  local body="$2"
  local path="$INJECT_DIR/${name}_${STAMP}.json"
  printf '%s\n' "$body" >"$path"
  echo "dropped $path"
}

echo "inject_dir=$INJECT_DIR"
echo "REAL cursor_pid=$CURSOR_PID ($(ps -p "$CURSOR_PID" -o comm= 2>/dev/null || echo '?'))"
echo "Running REAL local git push (origin=$BARE)..."

# Start real git in background capture; PID is first line of output.
GIT_OUT="$(mktemp)"
run_real_git_and_capture_pid >"$GIT_OUT" &
GIT_WRAPPER_BG=$!
# First line is the real /usr/bin/git PID.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -s "$GIT_OUT" ]]; then
    break
  fi
  sleep 0.1
done
GIT_PID="$(head -1 "$GIT_OUT" | tr -d '[:space:]')"
if [[ -z "$GIT_PID" || ! "$GIT_PID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: failed to capture real git PID"
  cat "$GIT_OUT" || true
  wait "$GIT_WRAPPER_BG" || true
  rm -f "$GIT_OUT"
  exit 1
fi

echo "REAL git_pid=$GIT_PID (alive=$(ps -p "$GIT_PID" >/dev/null 2>&1 && echo yes || echo exited))"

# Real process was `git -C ... push`; alert cmdline must include "git push" + .env
# for the live detector (and matches how Cursor shell demos look).
GIT_CMDLINE="git add .env && git push origin main"

drop "cursor" "$(cat <<EOF
{"type":"process_start","payload":{"pid":${CURSOR_PID},"ppid":1,"comm":"${CURSOR_COMM}","executable":"${CURSOR_EXE}","cmdline":"${CURSOR_CMDLINE}"}}
EOF
)"
sleep 0.4

drop "fopen" "$(cat <<EOF
{"type":"file_open","payload":{"pid":${CURSOR_PID},"ppid":1,"comm":"${CURSOR_COMM}","executable":"${CURSOR_EXE}","path":"${ENV_PATH}","operation":"open"}}
EOF
)"
sleep 0.4

drop "git" "$(cat <<EOF
{"type":"process_start","payload":{"pid":${GIT_PID},"ppid":${CURSOR_PID},"comm":"git","executable":"/usr/bin/git","cmdline":"${GIT_CMDLINE}"}}
EOF
)"

wait "$GIT_WRAPPER_BG" || true
rm -f "$GIT_OUT"

echo "Waiting for agent flush + detection-engine..."
sleep 8

DEVICE_ID=""
if [[ -f "$HOME/Library/Application Support/TrustEdge Agent/state.json" ]]; then
  DEVICE_ID="$(python3 -c 'import json; print(json.load(open("'"$HOME"'/Library/Application Support/TrustEdge Agent/state.json"))["device_id"])')"
elif [[ -f "$HOME/Library/Application Support/TrustTwin/state.json" ]]; then
  DEVICE_ID="$(python3 -c 'import json; print(json.load(open("'"$HOME"'/Library/Application Support/TrustTwin/state.json"))["device_id"])')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "Could not read device_id from agent state; check /alerts manually."
  echo "Expected alert PIDs: cursor=${CURSOR_PID} git=${GIT_PID}"
  exit 0
fi

echo "device_id=$DEVICE_ID"
curl -sS "${BACKEND}/security/alerts?device_id=${DEVICE_ID}&page_size=8" \
  | python3 -c 'import json,sys
cursor=int("'"$CURSOR_PID"'")
git_pid=int("'"$GIT_PID"'")
d=json.load(sys.stdin)
items=d.get("items") or []
found=False
for i in items:
  at=i.get("alert_type")
  msg=(i.get("message") or "")[:100]
  detail={}
  try:
    detail=json.loads(i.get("detail") or "{}")
  except Exception:
    pass
  print(i.get("id"), at, "cursor_pid=", detail.get("cursor_pid") or detail.get("parent_pid"), "git_pid=", detail.get("git_pid") or detail.get("child_pid"), msg)
  if at=="ai_secrets_git_push":
    found=True
    cp=detail.get("cursor_pid") or detail.get("parent_pid")
    gp=detail.get("git_pid") or detail.get("child_pid")
    if cp==cursor and gp==git_pid:
      print("OK: REAL PIDs match — Cursor", cursor, "→ git", git_pid)
    else:
      print("WARN: alert found but PIDs differ (got cursor=%r git=%r)" % (cp, gp))
print()
if found:
  print("Look for chip \"AI secrets git push\" on http://localhost:3001/alerts")
else:
  print("MISSING ai_secrets_git_push — is agent logging \"inject event enqueued\"?")
  raise SystemExit(1)'
