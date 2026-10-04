"""QABuddyAI configuration.

Everything that decides *where* things live and *which* models run sits here, so the
rest of the app can stay about the pipeline itself.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")

# Blank means "auto-pick". We probe Ollama and take the first model that exists,
# walking this list in order. See embedding.pick_model().
EMBED_MODEL = os.getenv("EMBED_MODEL", "").strip()
EMBED_PREFERENCE = ["qwen3-embedding:0.6b", "bge-m3", "nomic-embed-text"]

LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
GROQ_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_URL = os.getenv("GROQ_URL", "https://api.groq.com/openai/v1/chat/completions")

DATA_DIR = ROOT / "data"
QDRANT_PATH = ROOT / ".qdrant"
COLLECTION = "qabuddy"

# The 12 source types from the chapter plan. `kind` selects a chunker:
#   prose  - heading-aware windows (PRD/BRD/FRD/SRS, docs, notes, designs, diagrams)
#   code   - symbol/block windows (source code)
#   log    - fixed line windows (Jenkins logs)
#   cases  - one chunk per row (test cases CSV)
#   ticket - one chunk per field (Jira JSON)
SOURCES = [
    {"dir": "prd", "label": "PRD", "kind": "prose", "blurb": "Product requirements", "color": "#2563eb"},
    {"dir": "brd", "label": "BRD", "kind": "prose", "blurb": "Business requirements", "color": "#1d4ed8"},
    {"dir": "frd", "label": "FRD", "kind": "prose", "blurb": "Functional requirements", "color": "#0ea5e9"},
    {"dir": "srs", "label": "SRS", "kind": "prose", "blurb": "Software requirements", "color": "#0891b2"},
    {"dir": "company_docs", "label": "Company docs", "kind": "prose", "blurb": "Process and policy", "color": "#64748b"},
    {"dir": "meeting_notes", "label": "Meeting notes", "kind": "prose", "blurb": "Standups and reviews", "color": "#7c3aed"},
    {"dir": "test_cases", "label": "Test cases", "kind": "cases", "blurb": "Manual and automated cases", "color": "#16a34a"},
    {"dir": "jira_tickets", "label": "Jira tickets", "kind": "ticket", "blurb": "Bugs and stories", "color": "#4f46e5"},
    {"dir": "source_code", "label": "Source code", "kind": "code", "blurb": "Repository under test", "color": "#db2777"},
    {"dir": "jenkins_logs", "label": "Jenkins logs", "kind": "log", "blurb": "CI build and test logs", "color": "#b45309"},
    {"dir": "figma_designs", "label": "Figma designs", "kind": "prose", "blurb": "Extracted design specs", "color": "#a21caf"},
    {"dir": "lucid_charts", "label": "Lucid charts", "kind": "prose", "blurb": "Extracted diagram flows", "color": "#ca8a04"},
]

SOURCE_BY_DIR = {s["dir"]: s for s in SOURCES}
