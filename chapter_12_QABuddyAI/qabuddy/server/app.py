"""QABuddyAI backend.

One small API over server/pipeline.py (ingest) and server/store.py (retrieve).

    corpus -> chunk (per source kind) -> embed (Ollama, local) -> Qdrant (local)
    question -> embed -> dense + BM25 -> RRF fuse -> top-k -> Groq (grounded answer)

Retrieval is 100% local. The network is only touched in /api/chat, and only the
retrieved chunks are sent.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, embedding, pipeline, store

STATE: dict = {"ingest": None, "config": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Rebuild the BM25 index from the last snapshot so a restart does not require re-ingest.
    store.load_snapshot()
    yield


app = FastAPI(title="QABuddyAI", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------- health / meta

@app.get("/api/health")
def health() -> dict:
    model, reason = embedding.pick_model()
    inv = pipeline.discover()
    return {
        "ollama": embedding.ollama_up(),
        "embed_model": model,
        "embed_model_reason": reason,
        "preference": config.EMBED_PREFERENCE,
        "llm_model": config.LLM_MODEL,
        "groq_key_loaded": bool(config.GROQ_KEY),
        "vector_db": "qdrant (local)",
        "points": store.count(),
        "indexed": bool(store.meta()),
        "chunks": len(store.meta()),
        "corpus_files": inv["total_files"],
        "sources": len(config.SOURCES),
    }


@app.get("/api/sources")
def sources() -> dict:
    inv = pipeline.discover()
    by_dir = {s["dir"]: s for s in inv["sources"]}
    for s in inv["sources"]:
        s["indexed_chunks"] = sum(1 for c in store.meta() if c["source_type"] == s["dir"])
    return {"sources": sorted(by_dir.values(), key=lambda s: [x["dir"] for x in config.SOURCES].index(s["dir"])),
            "total_files": inv["total_files"], "indexed": bool(store.meta())}


@app.get("/api/models")
def models() -> dict:
    model, reason = embedding.pick_model()
    return {"installed": embedding.list_models(), "active": model, "reason": reason,
            "preference": config.EMBED_PREFERENCE}


# ------------------------------------------------------------------- ingest

class IngestReq(BaseModel):
    chunk_size: int = 150
    overlap: int = 30


@app.post("/api/ingest")
def ingest(req: IngestReq) -> dict:
    if req.overlap >= req.chunk_size:
        raise HTTPException(400, "overlap must be smaller than chunk size")
    result = pipeline.ingest(req.chunk_size, req.overlap)
    if result["chunk_count"] == 0:
        raise HTTPException(404, "No readable files found under data/. Add sources and retry.")
    STATE["ingest"] = result
    STATE["config"] = result.get("config")
    return result


@app.get("/api/chunks")
def chunks(source: str | None = None) -> dict:
    items = store.meta()
    if source:
        items = [c for c in items if c["source_type"] == source]
    return {"chunks": items, "total": len(items), "config": STATE["config"]}


# ------------------------------------------------------------------- search

class SearchReq(BaseModel):
    query: str
    k: int = 5
    mode: str = "hybrid"  # hybrid | dense | lexical
    source: str | None = None


def _validate_mode(mode: str) -> None:
    if mode not in ("hybrid", "dense", "lexical"):
        raise HTTPException(400, "mode must be hybrid, dense or lexical")


def _retrieve(req: SearchReq) -> dict:
    _validate_mode(req.mode)
    if not store.meta():
        raise HTTPException(400, "Nothing indexed yet. Run ingest first.")

    t0 = time.perf_counter()
    qvec = None
    embed_ms = 0.0
    if req.mode in ("hybrid", "dense"):
        qvec = embedding.embed([req.query], embedding.pick_model()[0])[0]
        embed_ms = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    hits = store.search(req.query, qvec, k=req.k, mode=req.mode, source=req.source)
    search_ms = (time.perf_counter() - t1) * 1000

    meta = {
        "query": req.query,
        "mode": req.mode,
        "source": req.source,
        "hits": hits,
        "searched_chunks": len(store.meta()),
        "timings": {"embed_ms": round(embed_ms, 1), "search_ms": round(search_ms, 2)},
        "query_vector": None,
    }
    if qvec is not None:
        meta["query_vector"] = {
            "dims": len(qvec),
            "preview": [round(x, 3) for x in qvec[:10]],
            "min": round(min(qvec), 3),
            "max": round(max(qvec), 3),
            "l2_norm": round(sum(x * x for x in qvec) ** 0.5, 3),
        }
    return meta


@app.post("/api/search")
def search(req: SearchReq) -> dict:
    return _retrieve(req)


# --------------------------------------------------------------------- chat

SYSTEM = (
    "You are QABuddyAI, answering questions for a QA team from a mixed corpus of "
    "requirements (PRD/BRD/FRD/SRS), company docs, meeting notes, test cases, Jira "
    "tickets, source code, CI logs, Figma specs and Lucid flows.\n"
    "Rules:\n"
    "- Answer ONLY from the numbered context chunks. If they do not contain the answer, "
    "say so plainly. Never use outside knowledge and never guess.\n"
    "- Cite the chunks you used inline as [chunk N].\n"
    "- When sources disagree, name both and say which document each comes from.\n"
    "- Be concrete: quote exact requirement ids (FR-03), ticket keys (VWO-125), file "
    "names and error strings from the context."
)


class ChatReq(SearchReq):
    pass


@app.post("/api/chat")
def chat(req: ChatReq) -> dict:
    if not config.GROQ_KEY:
        raise HTTPException(400, "GROQ_API_KEY missing from .env")
    found = _retrieve(req)
    if not found["hits"]:
        raise HTTPException(400, "No chunks retrieved for that query.")

    context = "\n\n".join(
        f"[chunk {h['rank']}] ({h['source_label']} · {h['file']})\n{h['text']}" for h in found["hits"]
    )
    user_msg = f"Context:\n{context}\n\nQuestion: {req.query}"

    t0 = time.perf_counter()
    with httpx.Client(timeout=120) as http:
        r = http.post(
            config.GROQ_URL,
            headers={"Authorization": f"Bearer {config.GROQ_KEY}"},
            json={
                "model": config.LLM_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
            },
        )
    llm_ms = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise HTTPException(502, f"Groq returned {r.status_code}: {r.text[:300]}")

    body = r.json()
    return {
        **found,
        "answer": body["choices"][0]["message"]["content"],
        "model": body.get("model", config.LLM_MODEL),
        "usage": body.get("usage", {}),
        "system_prompt": SYSTEM,
        "prompt_sent": {"system": SYSTEM, "user": user_msg, "chars": len(user_msg)},
        "timings": {**found["timings"], "llm_ms": round(llm_ms, 1)},
    }
