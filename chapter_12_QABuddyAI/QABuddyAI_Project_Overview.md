# QABuddyAI — Project Overview

**A self-hosted "QA knowledge brain" that answers any QA question with one cited answer, grounded in our own documents, test cases, tickets, code and build logs.**

---

## 1. Executive Summary

QABuddyAI is an internal, self-hosted AI assistant built specifically for our QA team. It indexes the entire QA "paper trail" — requirements documents, test cases, Jira tickets, source code, UI designs, meeting notes and Jenkins build logs — into a searchable knowledge base. A QA engineer asks a question in plain English and gets back a **single, grounded answer with citations** pointing to the exact source file or ticket.

The key idea is **Hybrid RAG (Retrieval-Augmented Generation)**: instead of relying on a general-purpose chatbot that may hallucinate, QABuddyAI retrieves the most relevant pieces of *our* real documents first, then generates an answer **only** from those retrieved pieces. It combines keyword search (for exact matches like ticket IDs and test-case names) with semantic search (for meaning-based questions), unions both results, and ranks them together.

**Why it matters:** today, answering a question like *"Why did TC-LOGIN-007 fail?"* means digging through Jenkins logs, a Jira ticket, the requirements doc and the source code by hand. QABuddyAI answers it in seconds, with proof for every claim.

---

## 2. The Problem We Are Solving

QA knowledge is fragmented. The answer to a single question is usually spread across **twelve different kinds of artifact**, owned by different people, stored in different tools:

| # | Source | Example artifact |
|---|---|---|
| 1 | PRD — Product Requirements Doc | `PRD_VWO_Login_v2.md` |
| 2 | BRD — Business Requirements Doc | `BRD_Login_Revamp.md` |
| 3 | FRD — Functional Requirements Doc | `FRD_Authentication.md` |
| 4 | SRS — Software Requirements Spec | `SRS_Login_Module.md` |
| 5 | Company Docs | `QA_Process_Handbook.md` (severity/priority rules) |
| 6 | Meeting Notes | `2026-09-18_Login_Sprint_Notes.md` |
| 7 | Test Cases | `TC_Login_Pack.csv` (TC-LOGIN-001 … 011) |
| 8 | Jira Tickets | `VWO-125_login_error_banner.json` |
| 9 | Source Code | `login_validation.ts` |
| 10 | Jenkins Logs | `build_1421_login_suite.log` |
| 11 | Figma Designs | `FIG-login-desktop_v3.md` |
| 12 | Lucid Charts | `LUC-login-flow_v2.md` |

**Consequences of the current way of working:**

- **Onboarding is slow** — new testers ask the same questions repeatedly.
- **RCA is manual** — correlating a failed test across log + ticket + code + requirement takes hours.
- **Duplicate effort** — the same knowledge is rediscovered instead of reused.
- **No single source of truth** — answers depend on who you ask.

**One real example the system is built to solve:** the VWO-125 login defect. The failing test is `TC-LOGIN-007` on build `1421`; the bug is in `submitLogin()` in `login_validation.ts`; the requirement is FR-03; the Jira ticket documents it. Today that link is pieced together by hand. QABuddyAI retrieves all of it in one query and cites each piece.

---

## 3. What QABuddyAI Is

QABuddyAI is a **multi-source Hybrid RAG system**. In plain terms:

- **Multi-source** — it understands twelve different document formats and treats each one intelligently.
- **Hybrid retrieval** — it searches by **meaning** (semantic/dense search) *and* by **exact text** (keyword/BM25 search), then merges the two ranked lists.
- **RAG** — the AI writes its answer strictly from the retrieved documents, so answers stay factual and traceable.
- **Self-hosted & local-first** — everything runs on our own server. Documents never leave our infrastructure except the final answer-generation call, which only receives the few retrieved snippets (never the whole corpus).

### Why "Hybrid" and not just a chatbot?

A single semantic (meaning-based) search is not enough for our content:

- Ask *"how do users sign in?"* → there is **no shared word** between the question and a document that says *"authentication"*. This needs **semantic** search.
- Ask *"why did TC-LOGIN-007 fail?"* → the exact string `TC-LOGIN-007` must be found verbatim in a log. This needs **keyword** (BM25) search.

QABuddyAI runs **both** and fuses the results, so it handles both kinds of questions. The UI even lets a user switch between the two modes to *see* why one fails where the other succeeds — this makes the system explainable rather than a black box.

---

## 4. Why We Built It

| Driver | Explanation |
|---|---|
| **Reduce time spent hunting for information** | One question returns the answer with its source, instead of searching four tools by hand. |
| **Faster, more accurate RCA** | Correlates failure logs, Jira tickets, code and requirements automatically. |
| **Self-serve onboarding** | New team members get answers without interrupting senior engineers. |
| **Reuse, not rediscover** | The team's accumulated knowledge becomes searchable and durable. |
| **Lower AI cost / token efficiency** | Only the most relevant snippets are sent to the AI model, keeping token usage (and cost) low. |
| **Trust through citations** | Every answer points to its source; if the knowledge base doesn't cover something, the tool says so instead of inventing an answer. |
| **Own our data** | Runs entirely on internal infrastructure; no third party ingests our documents. |

### Expected impact on test coverage

Per the project brief, combining the assistant with our ticket IDs is expected to raise effective test coverage substantially versus a plain coding assistant:

| Setup | Expected test coverage |
|---|---|
| Coding assistant + Jira ID only | ~30–40% |
| Coding assistant + **RAG assistant** + Jira ID | **~70–80%** |

---

## 5. How It Works

### 5.1 High-level architecture

| Layer | Technology | Where it runs |
|---|---|---|
| Frontend | React + Vite (3 tabs: **Corpus**, **Search**, **Chat**) | Local / internal server |
| Backend API | Python FastAPI (port 8101) | Local / internal server |
| Embeddings (AI) | Ollama serving an open-source model (`qwen3-embedding:0.6b`), fallbacks `bge-m3`, `nomic-embed-text` | **Local** |
| Vector database | Qdrant (local mode — a folder, no server or Docker to manage) | **Local** |
| Keyword index | BM25 | **Local** (in-process) |
| Result fusion | Reciprocal Rank Fusion (RRF) | **Local** |
| Answer generation | Groq `openai/gpt-oss-120b` | Remote — **Chat tab only** |

All retrieval and indexing are **100% local**. The only outbound call is the final answer step, and only the retrieved snippets are sent.

### 5.2 Two pipelines

**Indexing (done once, then refreshed):**

```
data/ (12 source folders)
  -> read each file (PDF via pypdf, everything else as text)
  -> chunk it according to its type  (prose | code | log | cases | ticket)
  -> embed the chunks locally        (Ollama)
  -> store vectors + metadata        (Qdrant local)
  -> build the keyword index         (BM25)
```

**Answering a question:**

```
question
  -> embed the question            (Ollama)
  -> retrieve from BOTH engines    (semantic Qdrant + keyword BM25)
  -> fuse the two ranked lists     (Reciprocal Rank Fusion)
  -> take the top-k most relevant chunks
  -> generate a grounded answer    (GPT-OSS, answers only from those chunks)
  -> return the answer WITH citations to the source files
```

### 5.3 Smart, per-source chunking

Different documents need to be split differently. QABuddyAI does this automatically:

| Source type | How it is chunked | Why |
|---|---|---|
| Prose (PRD/BRD/FRD/SRS/docs/notes) | Heading-aware word windows, heading kept on every chunk | Each piece stays self-describing |
| Source code | One chunk per top-level function / class | A symbol is never split in half |
| Jenkins logs | Fixed line windows (with line numbers) | Logs have no paragraphs |
| Test cases (CSV) | One chunk per row | A single test case is retrievable on its own |
| Jira tickets | One chunk per field | "Acceptance criteria" becomes its own retrievable unit |

### 5.4 The three tabs in the UI

1. **Corpus** — index the documents; inspect every chunk created and which source it came from.
2. **Search** — retrieval only (no AI); shows the semantic score, the keyword score, and the fused score for every hit, so you can see exactly *why* something ranked where it did.
3. **Chat** — asks the AI for a grounded answer, shows the citations, the token usage, and the exact prompt that was sent.

---

## 6. How It Will Be Used for Testing (QA Workflows)

This is where the project delivers day-to-day value. Concrete scenarios:

### 6.1 Test-failure analysis / Root Cause Analysis (RCA)

> **Ask:** *"Why did TC-LOGIN-007 fail in build 1421?"*

QABuddyAI pulls the log line for the failure, the Jira ticket describing the defect, the relevant source code, and the requirement it violates — and returns a single explanation with all four citations. What used to be a manual cross-tool investigation becomes one query.

### 6.2 Test design — creating and reviewing test cases

> **Ask:** *"What test cases cover login error handling, and what's missing?"*

Because test cases are chunked one-per-row and carry traceability to requirements, the assistant can summarise existing coverage and highlight gaps.

### 6.3 Requirements traceability

> **Ask:** *"Which test cases trace to FR-03?"*

Returns the requirement and every linked test case — useful for an RTM (Requirements Traceability Matrix) and for review sign-off.

### 6.4 Onboarding and self-serve knowledge base

New team members ask process and framework questions and get answers grounded in the QA handbook, meeting notes and code — without pulling a senior engineer away from work.

### 6.5 Bug triage support

> **Ask:** *"What is the severity policy for a broken login?"*

Retrieves the severity/priority definitions from the QA process handbook and applies them to the described situation.

### 6.6 Flaky-test history

Once build/run data is fed in, the team can retrieve the historical behaviour of a given test and spot patterns over time.

### 6.7 Framework coding help

> **Ask:** *"Show me the pattern our framework uses for X."*

Retrieves real examples from our Selenium and Playwright frameworks so answers match our own conventions.

### 6.8 The same event, from different angles

Filter the same question to **Jira tickets** vs **Jenkins logs** and you get *different evidence* for the *same event* — which is exactly why indexing the whole paper trail (not a single document) is the point. Every answer carries its source, so findings are defensible in a defect report.

---

## 7. How to Run It (Demo)

The whole system starts with a single command — it launches the local embedding service, installs dependencies, and starts both the backend and the UI.

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File run.ps1
```

```bash
# macOS / Linux
./run.sh
```

Then open **http://localhost:5191** and use the three tabs: index, search, ask.

**Requirements:** Ollama with one embedding model, Python 3.10+, Node 18+, and a `GROQ_API_KEY` in a `.env` file (used only for the Chat tab). Secrets are supplied via `.env` and never hardcoded.

---

## 8. Design Decisions (and Justification)

| Decision | Choice | Why |
|---|---|---|
| Embedding model | Open-source (`qwen3-embedding:0.6b`, with fallbacks) | Open-source constraint; runs locally via Ollama |
| Vector database | Qdrant (local mode) | Open-source; runs as a folder — no server or Docker to operate |
| Keyword search | BM25 | Catches exact strings (IDs, test names) that semantic search misses |
| Combining results | Reciprocal Rank Fusion | Robust, well-understood way to merge two ranked lists |
| Answer model | `openai/gpt-oss-120b` (only for Chat) | Keeps answers grounded; only retrieved snippets are sent |
| Deployment | Self-hosted on a VPS (e.g. DigitalOcean) | Internal 24×7 use; data stays in-house |
| Chunking | Per source type | Each document type is retrievable in its most useful unit |

---

## 9. Current Status & What's Next

**Working today**

- Full ingestion pipeline across the twelve source types.
- Hybrid retrieval (semantic + keyword + fusion) with scores visible in the UI.
- Grounded answers with citations in the Chat tab.
- A self-contained demo scenario built around the **VWO-125 login defect** (the failing `TC-LOGIN-007` on build `1421`), which exercises every workflow above end to end.

**Roadmap (Phase 2)**

- **Hourly auto-ingestion** — automatically detect new test cases, new repo commits and new documents, and re-index every hour.
- **Figma design ingestion** — ER diagrams, wireframes and user guides.
- Ingestion of the full real repositories (Selenium + Playwright frameworks) and the complete test-case repository, replacing the curated demo set.

---

## 10. Glossary (for quick reference)

| Term | Meaning |
|---|---|
| **RAG** | Retrieval-Augmented Generation — retrieve real documents first, then let the AI answer only from them. |
| **Hybrid retrieval** | Combining semantic (meaning) search with keyword (exact match) search. |
| **Embedding** | A numeric representation of text that lets computers search by meaning. |
| **Vector database** | A database that stores and searches embeddings (Qdrant). |
| **BM25** | A classic keyword-ranking algorithm — strong at exact strings. |
| **RRF** | Reciprocal Rank Fusion — merges two ranked result lists into one. |
| **Chunk** | A small, retrievable slice of a document. |
| **Grounding** | Restricting the AI to answer only from retrieved evidence. |

---

## 11. Technical Appendix — Tools & Components

The complete set of tools and components used, grouped by layer.

### Backend / API

| Component | Role |
|---|---|
| **Python 3.13** (3.10+ required) | Backend runtime |
| **FastAPI** | REST API — `/api/health`, `/api/sources`, `/api/models`, `/api/ingest`, `/api/chunks`, `/api/search`, `/api/chat` |
| **Uvicorn** | ASGI server, port **8101** |
| **Pydantic** | Request/response data models |
| **python-dotenv** | Loads configuration and secrets from `.env` |
| **httpx** | HTTP client used to call Ollama and Groq |

### AI / Retrieval (the RAG core)

| Component | Role |
|---|---|
| **Ollama** | Local model server on `127.0.0.1:11434` |
| **`qwen3-embedding:0.6b`** (1024-d) | Primary embedding model; fallbacks `bge-m3` (1024-d) and `nomic-embed-text` (768-d) |
| **Qdrant** (`qdrant-client`) | Vector database in **local mode** (a folder, no Docker); collection `qabuddy`, Cosine distance |
| **rank_bm25** (`BM25Okapi`) | Keyword / lexical index, held in-process |
| **Reciprocal Rank Fusion** | Custom result-fusion logic in `store.py` |
| **Groq API → `openai/gpt-oss-120b`** (temp 0.2) | Answer generation — **Chat tab only** |

### Document processing

| Component | Role |
|---|---|
| **pypdf** | Reads PDF sources |
| **Custom chunkers** (`chunkers.py`) | Per-source chunking: prose / code / log / cases / ticket |
| **`.qabuddy_chunks.json`** | Chunk + BM25 snapshot — re-warms the index on restart without re-ingest |

### Frontend

| Component | Role |
|---|---|
| **React 18.3** + **React DOM** | UI framework |
| **Vite 6** | Dev server on port **5191**, proxies `/api` → `127.0.0.1:8101` |
| **@vitejs/plugin-react** | React support for Vite |
| **Plain CSS** | Styling (no UI kit, router or state library) |
| **Three tabs** | Corpus / Search / Chat |

### Networking & operations

| Component | Role |
|---|---|
| **`run.ps1`** (Windows) | One-command launcher — starts Ollama, pulls an embedding model, installs deps, starts both servers |
| **`run.sh`** (macOS/Linux) | POSIX equivalent |
| **Docker** | **Not used** — Qdrant runs in local mode |
| **`.env`** | Supplies `GROQ_API_KEY`, `OLLAMA_URL`, `EMBED_MODEL`, `LLM_MODEL` (git-ignored) |

### On-disk data stores

| Path | Contents |
|---|---|
| `.qdrant/` | Vector storage (`meta.json` + SQLite) |
| `.qabuddy_chunks.json` | Chunk / BM25 snapshot (88 chunks in the demo corpus) |

---

## 12. Future Improvements

### 12.1 How ingestion works today (and why it needs improving)

Adding documents is currently a **manual, two-step** process:

1. Copy files into the matching folder under `qabuddy/data/` (e.g. `data/prd/`, `data/jira_tickets/`).
2. Open the Corpus tab and click **Index** (this calls the `POST /api/ingest` endpoint).

Two limitations:

- **No auto-detection** — there is no file watcher, scheduler or connector. New files sit unnoticed until someone manually re-indexes.
- **Full rebuild every time** — each ingest drops and re-embeds the **entire** corpus, so re-indexing gets slower and more expensive as the corpus grows, even if only one file changed.

### 12.2 Ingestion automation (removes the manual step)

| Improvement | Benefit |
|---|---|
| **Incremental / delta ingest** | Hash each file and re-embed only changed or new files; delete chunks for removed files. Biggest single win. |
| **Filesystem watcher** (`watchdog`) | Auto-ingest the moment a file is dropped into `data/`. |
| **Scheduled re-index** (cron / APScheduler) | Automated hourly re-indexing (the "Phase 2" item from the original brief). |
| **Jira live pull via MCP + JQL** | Replace manual JSON exports with a live ticket feed. |
| **Git webhook** | Re-index the Selenium / Playwright repos automatically on push. |
| **Document connectors** (Confluence / Drive / SharePoint) | Pull company docs directly instead of manual drops. |

### 12.3 Retrieval quality

- **Reranking** — add a cross-encoder reranker after the RRF fusion step to reorder the top hits.
- **Native sparse vectors in Qdrant** — replace the in-process BM25 index for better scale.
- **Metadata filtering** — filter by date, author, version or ticket status.
- **Query rewriting / multi-query** — improve recall on vague or broad questions.

### 12.4 Answer quality & trust

- **Clickable citations** — link `[chunk N]` references to the actual source file or ticket.
- **Multi-turn conversation memory** — the Chat tab is currently single-shot.
- **Feedback capture** (thumbs up / down) to learn what a good answer looks like.
- **RAG evaluation harness** — measure faithfulness, answer relevancy, and context precision/recall (the DeepEval material in chapters 22–23 fits this well).

### 12.5 Security & operations

- **Rotate the exposed Groq key** and move secrets into a managed secret store.
- **Add authentication** — the API currently has open CORS (`allow_origins=["*"]`) and no auth.
- **Containerize** (Docker) and run under a process manager on the VPS; add logging and metrics.

### 12.6 User experience

- **Streaming answers** (server-sent events) instead of waiting for the full response.
- **Admin view** to add sources and trigger ingest without touching the filesystem.
- **Larger-format support** — docx, xlsx, pptx, and OCR for Figma/image sources.

**Top three priorities for real-world use:** incremental ingest, a scheduled/watched auto-index, and the Jira live pull. Together these eliminate the manual upload step entirely.

---

*Prepared from the QABuddyAI codebase and build brief in `chapter_12_QABuddyAI`. This document is intentionally non-technical in the early sections so it can be shared with stakeholders, with the architecture details available for engineering review.*
