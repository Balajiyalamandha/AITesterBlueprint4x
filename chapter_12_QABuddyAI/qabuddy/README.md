# QABuddyAI — multi-source retrieval for QA

One question, twelve kinds of document. QABuddyAI indexes a QA team's whole paper trail
and lets you retrieve across all of it at once:

| # | Source | Chunked as |
|---|---|---|
| 1 | PRD | heading-aware windows |
| 2 | BRD | heading-aware windows |
| 3 | FRD | heading-aware windows |
| 4 | SRS | heading-aware windows |
| 5 | Company docs | heading-aware windows |
| 6 | Meeting notes | heading-aware windows |
| 7 | Test cases | one chunk per CSV row |
| 8 | Jira tickets | one chunk per field |
| 9 | Source code | one chunk per top-level block |
| 10 | Jenkins logs | fixed line windows (sparse-first) |
| 11 | Figma designs | extracted text/tokens |
| 12 | Lucid charts | extracted diagram text |

```
data/ (12 source types)
   -> chunk per kind        (prose | code | log | cases | ticket)
   -> embed locally         (Ollama, qwen3-embedding:0.6b)
   -> store                 (Qdrant local: dense vectors + payload metadata)
   -> index                 (BM25 over the same chunk texts)

question
   -> embed                 (Ollama)
   -> retrieve              (dense cosine  +  BM25)
   -> fuse                  (Reciprocal Rank Fusion)
   -> answer                (Groq gpt-oss-120b, grounded on the top-k chunks only)
```

## Why hybrid, and why it matters here

A single dense embedder is not enough for this corpus. Ask *"why did TC-LOGIN-007 fail?"*
and the answer needs an exact string match on `TC-LOGIN-007` in a Jenkins log — that is a
BM25 job. Ask *"how do users sign in?"* and it must find the chunk about *authentication*
with no words in common — that is a dense job. QABuddyAI runs both and fuses them:

```
dense  = Qdrant cosine search     (meaning)
lexical = BM25 over chunk texts   (exact strings)
fused  = Reciprocal Rank Fusion   score = Σ 1/(60 + rank) across both lists
```

The Search tab shows all three scores per hit and lets you switch to Dense-only or
BM25-only so you can watch each side fail on its own.

## The stack

| Layer | Choice | Where |
|---|---|---|
| Embeddings | `qwen3-embedding:0.6b` (1024d), fallback `bge-m3`, `nomic-embed-text` | **local** (Ollama) |
| Vector store | Qdrant, **local mode** (a folder, no server/Docker) | **local** |
| Lexical | BM25 (`rank_bm25`), in-process | **local** |
| Fusion | Reciprocal Rank Fusion | **local** |
| Answer | `openai/gpt-oss-120b` via Groq | remote, chat tab only |

Qdrant runs in local mode via `QdrantClient(path=".qdrant")`, so there is no container to
start. At scale you would move the sparse side into Qdrant's native sparse vectors and
keep the same RRF step.

## Run it

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File run.ps1
```

```bash
# macOS / Linux
./run.sh
```

Then open <http://localhost:5191>: **tab 1** index the corpus, **tab 2** search,
**tab 3** ask. The run script starts Ollama, pulls an embedding model if none is present,
installs the backend and UI deps, and starts both servers.

## Layout

```
qabuddy/
├── run.ps1 / run.sh        # ollama + backend + frontend
├── .env                    # GROQ_API_KEY, OLLAMA_URL, EMBED_MODEL (git-ignored)
├── requirements.txt
├── data/                   # the 12 source types, one folder each
├── server/
│   ├── config.py           # env + the source registry
│   ├── chunkers.py         # the per-source chunking rules
│   ├── embedding.py        # Ollama embed + runtime model pick
│   ├── store.py            # Qdrant(local) + BM25 + RRF
│   ├── pipeline.py         # walk -> chunk -> embed -> store
│   └── app.py              # FastAPI routes
└── ui/src/App.jsx          # Corpus / Search / Chat
```

## Things worth demonstrating

**Semantic vs lexical, side by side.** Search `"why did the login test fail"` in Hybrid,
then Dense, then BM25. Dense finds the concept, BM25 finds the ticket key; the fusion gets
both.

**Source filtering.** The same question, filtered to *Jira tickets* vs *Jenkins logs*,
returns different evidence for the same event — which is the point of indexing the whole
paper trail rather than one document.

**Chunking is per-source.** Test cases chunk per row so a single case is retrievable;
code chunks per function so a symbol is never split; logs chunk per line window because
they have no paragraphs.

**Grounding holds.** Ask something the corpus does not cover and the model says so instead
of inventing an answer. That comes from the system prompt in `server/app.py`.

## Requirements

- Ollama with one embedding model (`ollama pull qwen3-embedding:0.6b`)
- Python 3.10+
- Node 18+
- `GROQ_API_KEY` in `.env` (only for the Chat tab)
