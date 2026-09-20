"""RAG Explorer backend.

One file on purpose: the whole point is that you can read the entire RAG pipeline
top to bottom without jumping between modules.

Pipeline:
    PDF -> extract -> normalise -> chunk -> embed (Ollama/nomic) -> store (Chroma)
    query -> embed -> cosine search -> top-k chunks -> prompt -> Groq gpt-oss-120b

Nothing about the document leaves the machine during ingest. Embeddings run locally
in Ollama. Only the retrieved chunks are sent to Groq, and only when you chat.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

import chromadb
import httpx
from chromadb.config import Settings
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OLLAMA = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
GROQ_KEY = os.getenv("GROQ_API_KEY", "")
DATA_DIR = ROOT / "data"
CHROMA_DIR = ROOT / ".chroma"

app = FastAPI(title="RAG Explorer")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

client = chromadb.PersistentClient(path=str(CHROMA_DIR), settings=Settings(anonymized_telemetry=False))

# In-memory mirror of what we stored, so the UI can show chunks without re-querying.
STATE: dict[str, Any] = {"chunks": [], "doc": None, "config": None, "timings": {}}


# ---------------------------------------------------------------- 1. extract

def extract_pdf(path: Path) -> tuple[str, list[dict]]:
    """Pull raw text out of the PDF, one entry per page."""
    reader = PdfReader(str(path))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        raw = page.extract_text() or ""
        pages.append({"page": i, "raw_chars": len(raw), "text": raw})
    return "\n".join(p["text"] for p in pages), pages


# -------------------------------------------------------------- 2. normalise

def normalise(text: str) -> str:
    """Repair the extraction.

    This PDF was exported from Google Docs, and pypdf emits one word per line:

        Product\\n \\nRequirements\\n \\nDocument:

    Chunking that as-is gives you unreadable fragments and terrible embeddings.
    So: join single-word lines back into sentences, then tidy the whitespace.
    Most real PDFs need some version of this step. It is the least glamorous and
    most important part of the pipeline.
    """
    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln]

    # If most lines are a single token, the file is word-per-line: rejoin it all.
    single = sum(1 for ln in lines if len(ln.split()) == 1)
    if lines and single / len(lines) > 0.6:
        text = " ".join(lines)
    else:
        text = "\n".join(lines)

    text = re.sub(r"[ \t]+", " ", text)
    # Perplexity-style inline citation markers ("...analysis 1 2 .") add noise.
    text = re.sub(r"\s+(\d+\s+)+\.", ".", text)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text.strip()


# ------------------------------------------------------------------ 3. chunk

def chunk_text(text: str, size: int, overlap: int) -> list[dict]:
    """Fixed-size word windows with overlap.

    Overlap exists so a sentence that straddles a boundary still lands whole in at
    least one chunk. Too little and you cut answers in half; too much and you pay
    to embed the same words repeatedly and retrieve near-duplicates.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")

    words = text.split()
    step = size - overlap
    chunks = []
    for start in range(0, max(len(words), 1), step):
        window = words[start : start + size]
        if not window:
            break
        body = " ".join(window)
        chunks.append(
            {
                "id": f"chunk-{len(chunks):03d}",
                "index": len(chunks),
                "text": body,
                "word_count": len(window),
                "char_count": len(body),
                "word_start": start,
                "word_end": start + len(window),
            }
        )
        if start + size >= len(words):
            break
    return chunks


# ------------------------------------------------------------------ 4. embed

def embed(texts: list[str]) -> list[list[float]]:
    """Embed locally with Ollama. Returns one 768-dim vector per input."""
    out = []
    with httpx.Client(timeout=120) as http:
        for t in texts:
            r = http.post(f"{OLLAMA}/api/embeddings", json={"model": EMBED_MODEL, "prompt": t})
            if r.status_code != 200:
                raise HTTPException(
                    502,
                    f"Ollama embedding failed ({r.status_code}). Is `ollama serve` running "
                    f"and `{EMBED_MODEL}` pulled? Body: {r.text[:200]}",
                )
            out.append(r.json()["embedding"])
    return out


# ----------------------------------------------------------------- endpoints

class IngestReq(BaseModel):
    chunk_size: int = 180
    overlap: int = 40
    filename: str | None = None


@app.get("/api/health")
def health() -> dict:
    pdfs = sorted(p.name for p in DATA_DIR.glob("*.pdf"))
    ollama_ok, groq_ok = False, bool(GROQ_KEY)
    try:
        with httpx.Client(timeout=5) as http:
            ollama_ok = http.get(f"{OLLAMA}/api/tags").status_code == 200
    except Exception:
        pass
    return {
        "ollama": ollama_ok,
        "embed_model": EMBED_MODEL,
        "groq_key_loaded": groq_ok,
        "llm_model": LLM_MODEL,
        "pdfs": pdfs,
        "ingested": bool(STATE["chunks"]),
    }


@app.post("/api/ingest")
def ingest(req: IngestReq) -> dict:
    pdfs = sorted(DATA_DIR.glob("*.pdf"))
    if not pdfs:
        raise HTTPException(404, f"No PDF found in {DATA_DIR}")
    path = next((p for p in pdfs if p.name == req.filename), pdfs[0])

    t0 = time.perf_counter()
    raw, pages = extract_pdf(path)
    t_extract = time.perf_counter() - t0

    t0 = time.perf_counter()
    clean = normalise(raw)
    t_norm = time.perf_counter() - t0

    t0 = time.perf_counter()
    chunks = chunk_text(clean, req.chunk_size, req.overlap)
    t_chunk = time.perf_counter() - t0

    t0 = time.perf_counter()
    vectors = embed([c["text"] for c in chunks])
    t_embed = time.perf_counter() - t0

    # Rebuild the collection from scratch so re-ingesting with new settings is clean.
    try:
        client.delete_collection("prd")
    except Exception:
        pass
    col = client.create_collection("prd", metadata={"hnsw:space": "cosine"})
    col.add(
        ids=[c["id"] for c in chunks],
        documents=[c["text"] for c in chunks],
        embeddings=vectors,
        metadatas=[{"index": c["index"], "words": c["word_count"]} for c in chunks],
    )

    for c, v in zip(chunks, vectors):
        c["vector_preview"] = [round(x, 4) for x in v[:8]]
        c["vector_dims"] = len(v)

    STATE.update(
        chunks=chunks,
        doc={
            "filename": path.name,
            "pages": len(pages),
            "raw_chars": len(raw),
            "clean_chars": len(clean),
            "words": len(clean.split()),
            "raw_sample": raw[:280],
            "clean_sample": clean[:280],
            "page_stats": [{"page": p["page"], "chars": p["raw_chars"]} for p in pages],
        },
        config={"chunk_size": req.chunk_size, "overlap": req.overlap, "step": req.chunk_size - req.overlap},
        timings={
            "extract_ms": round(t_extract * 1000, 1),
            "normalise_ms": round(t_norm * 1000, 1),
            "chunk_ms": round(t_chunk * 1000, 1),
            "embed_ms": round(t_embed * 1000, 1),
            "embed_ms_per_chunk": round(t_embed * 1000 / max(len(chunks), 1), 1),
        },
    )
    return {
        "doc": STATE["doc"],
        "config": STATE["config"],
        "timings": STATE["timings"],
        "chunk_count": len(chunks),
        "vector_dims": len(vectors[0]) if vectors else 0,
        "chunks": chunks,
    }


class SearchReq(BaseModel):
    query: str
    k: int = 3


def _search(query: str, k: int) -> dict:
    if not STATE["chunks"]:
        raise HTTPException(400, "Nothing ingested yet. Run ingest first.")

    t0 = time.perf_counter()
    qvec = embed([query])[0]
    t_embed = time.perf_counter() - t0

    t0 = time.perf_counter()
    col = client.get_collection("prd")
    res = col.query(query_embeddings=[qvec], n_results=k, include=["documents", "distances", "metadatas"])
    t_query = time.perf_counter() - t0

    hits = []
    for cid, doc, dist, meta in zip(
        res["ids"][0], res["documents"][0], res["distances"][0], res["metadatas"][0]
    ):
        # Chroma is configured for cosine, so distance = 1 - cosine_similarity.
        similarity = 1 - dist
        hits.append(
            {
                "id": cid,
                "index": meta["index"],
                "text": doc,
                "distance": round(dist, 4),
                "similarity": round(similarity, 4),
                "percent": round(similarity * 100, 1),
                "words": meta["words"],
            }
        )

    return {
        "query": query,
        "hits": hits,
        "query_vector": {
            "dims": len(qvec),
            "preview": [round(x, 4) for x in qvec[:12]],
            "min": round(min(qvec), 4),
            "max": round(max(qvec), 4),
            "l2_norm": round(sum(x * x for x in qvec) ** 0.5, 4),
        },
        "timings": {"embed_ms": round(t_embed * 1000, 1), "vector_search_ms": round(t_query * 1000, 2)},
        "searched_chunks": len(STATE["chunks"]),
    }


@app.post("/api/search")
def search(req: SearchReq) -> dict:
    return _search(req.query, req.k)


class ChatReq(BaseModel):
    query: str
    k: int = 3


SYSTEM = (
    "You answer questions about a Product Requirements Document using ONLY the "
    "numbered context chunks provided.\n"
    "Rules:\n"
    "- If the chunks do not contain the answer, say so plainly. Do not use outside "
    "knowledge and do not guess.\n"
    "- Cite the chunks you used as [chunk N] inline.\n"
    "- Be concise and concrete. Quote exact figures and names from the context."
)


@app.post("/api/chat")
def chat(req: ChatReq) -> dict:
    if not GROQ_KEY:
        raise HTTPException(400, "GROQ_API_KEY missing from .env")

    found = _search(req.query, req.k)

    context = "\n\n".join(f"[chunk {h['index']}]\n{h['text']}" for h in found["hits"])
    user_msg = f"Context:\n{context}\n\nQuestion: {req.query}"

    t0 = time.perf_counter()
    with httpx.Client(timeout=90) as http:
        r = http.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            json={
                "model": LLM_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
            },
        )
    t_llm = time.perf_counter() - t0
    if r.status_code != 200:
        raise HTTPException(502, f"Groq returned {r.status_code}: {r.text[:300]}")

    body = r.json()
    return {
        **found,
        "answer": body["choices"][0]["message"]["content"],
        "model": body.get("model", LLM_MODEL),
        "usage": body.get("usage", {}),
        "prompt_sent": {"system": SYSTEM, "user": user_msg, "chars": len(user_msg)},
        "timings": {**found["timings"], "llm_ms": round(t_llm * 1000, 1)},
    }


@app.get("/api/chunks")
def chunks() -> dict:
    return {
        "chunks": STATE["chunks"],
        "config": STATE["config"],
        "doc": STATE["doc"],
        "timings": STATE["timings"],
    }
