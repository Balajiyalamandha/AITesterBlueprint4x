#!/usr/bin/env bash
# Starts everything the RAG Explorer needs. Ctrl+C stops the servers it started.
set -e
cd "$(dirname "$0")"

pgrep -qx ollama || { echo "starting ollama…"; (ollama serve >/tmp/ollama.log 2>&1 &); sleep 3; }
ollama list | grep -q nomic-embed-text || ollama pull nomic-embed-text

[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q fastapi uvicorn pypdf chromadb groq python-dotenv httpx

echo "backend  -> http://localhost:8100"
./.venv/bin/uvicorn server.app:app --port 8100 &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT

cd ui
[ -d node_modules ] || npm install
echo "frontend -> http://localhost:5190"
npm run dev
