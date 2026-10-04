#!/usr/bin/env bash
# Starts everything QABuddyAI needs. Ctrl+C stops the servers it started.
set -e
cd "$(dirname "$0")"

pgrep -qx ollama || { echo "starting ollama…"; (ollama serve >/tmp/ollama.log 2>&1 &); sleep 3; }

# Prefer the best model; fall back if the pull fails. The app also auto-picks at runtime.
if ! ollama list | grep -q -E 'qwen3-embedding:0.6b|bge-m3|nomic-embed-text'; then
  ollama pull qwen3-embedding:0.6b || ollama pull nomic-embed-text
fi

[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q -r requirements.txt

echo "backend  -> http://localhost:8101"
./.venv/bin/uvicorn server.app:app --port 8101 &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT

cd ui
[ -d node_modules ] || npm install
echo "frontend -> http://localhost:5191"
npm run dev
