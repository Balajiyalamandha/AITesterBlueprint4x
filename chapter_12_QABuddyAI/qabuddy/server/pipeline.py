"""The ingest pipeline: walk data/, chunk per source type, embed locally, store.

Nothing leaves the machine here. Files are read locally, chunks are embedded by Ollama
on localhost, vectors land in the local Qdrant folder. Only the final answer step in
server/app.py ever calls the network, and only with the retrieved chunks.
"""

from __future__ import annotations

import time
from pathlib import Path

from . import chunkers, config, embedding, store


def read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        return "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    return path.read_text(encoding="utf-8", errors="replace")


def discover() -> dict:
    """Inventory what is on disk, per source type - used before any embedding runs."""
    inv = []
    for s in config.SOURCES:
        d = config.DATA_DIR / s["dir"]
        files = (
            sorted(p for p in d.rglob("*") if p.is_file() and not p.name.startswith("."))
            if d.exists()
            else []
        )
        inv.append({**s, "files": [f.name for f in files], "file_count": len(files)})
    return {"sources": inv, "total_files": sum(s["file_count"] for s in inv)}


def ingest(chunk_size: int = 150, overlap: int = 30) -> dict:
    t0 = time.perf_counter()
    model, reason = embedding.pick_model()

    chunks: list[dict] = []
    per_source: list[dict] = []
    errors: list[str] = []

    for s in config.SOURCES:
        d = config.DATA_DIR / s["dir"]
        files = (
            sorted(p for p in d.rglob("*") if p.is_file() and not p.name.startswith("."))
            if d.exists()
            else []
        )
        made = 0
        for f in files:
            try:
                text = read_text(f)
            except Exception as e:  # a bad file should not sink the whole ingest
                errors.append(f"{s['dir']}/{f.name}: {e}")
                continue
            if not text.strip():
                continue
            for c in chunkers.chunk_document(text, s["kind"], f.name, chunk_size, overlap):
                chunks.append(
                    {
                        "id": len(chunks),
                        "text": c["text"],
                        "heading": c.get("heading", ""),
                        "word_start": c.get("word_start", 0),
                        "word_end": c.get("word_end", 0),
                        "source_type": s["dir"],
                        "source_label": s["label"],
                        "kind": s["kind"],
                        "file": f.name,
                        "rel_path": str(f.relative_to(config.ROOT)).replace("\\", "/"),
                        "chunk_index": made,
                        "words": len(c["text"].split()),
                        "chars": len(c["text"]),
                    }
                )
                made += 1
        per_source.append(
            {
                "dir": s["dir"],
                "label": s["label"],
                "kind": s["kind"],
                "color": s["color"],
                "files": len(files),
                "file_names": [f.name for f in files],
                "chunks": made,
            }
        )

    t_chunk = time.perf_counter()

    if not chunks:
        return {
            "model": model,
            "model_reason": reason,
            "dims": 0,
            "chunk_count": 0,
            "file_count": 0,
            "per_source": per_source,
            "errors": errors,
            "timings": {},
        }

    t_embed0 = time.perf_counter()
    vectors = embedding.embed([c["text"] for c in chunks], model)
    t_embed = time.perf_counter()

    dims = len(vectors[0]) if vectors else 0
    store.reset_collection(dims)
    store.upsert(chunks, vectors)
    store.build_meta(chunks)
    store.save_snapshot(chunks)
    t_store = time.perf_counter()

    for c, v in zip(chunks, vectors):
        c["vector_preview"] = [round(x, 3) for x in v[:6]]
        c["vector_dims"] = dims

    return {
        "model": model,
        "model_reason": reason,
        "dims": dims,
        "chunk_count": len(chunks),
        "file_count": sum(s["files"] for s in per_source),
        "per_source": per_source,
        "errors": errors,
        "config": {"chunk_size": chunk_size, "overlap": overlap, "step": chunk_size - overlap},
        "timings": {
            "extract_chunk_ms": round((t_chunk - t0) * 1000, 1),
            "embed_ms": round((t_embed - t_embed0) * 1000, 1),
            "embed_ms_per_chunk": round((t_embed - t_embed0) * 1000 / max(len(chunks), 1), 1),
            "store_ms": round((t_store - t_embed) * 1000, 1),
            "total_ms": round((t_store - t0) * 1000, 1),
        },
    }
