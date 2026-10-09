"""Emit the chunk sets the hosted (Vercel) build serves.

The live server chunks and embeds on the fly. The hosted build has no Ollama, so it ships
the raw chunk sets and embeds both the chunks and the query in the browser with MiniLM.
This script produces the chunk half of that handoff, reusing the exact chunkers the server
runs so the two builds chunk identically. Only the embedder differs (MiniLM vs Ollama).

    python scripts/export_chunks.py     # -> ui/public/index.json

The UI reads that file, chunks it, and searches it client-side. Regenerate whenever the
corpus under data/ or the chunkers change.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import chunkers, config  # noqa: E402

# The chunk sizes the hosted build ships so the Corpus slider stays meaningful. The
# server defaults to 150/30, which is in the list.
CONFIGS = [(100, 20), (150, 30), (200, 40)]

# The hosted embedder. Chunks and queries are both embedded with this in the browser, so
# they share a vector space. Must match MINILM in ui/src/engine.js.
EMBED_MODEL = "Xenova/all-MiniLM-L6-v2"
EMBED_DIMS = 384


def read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        return "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    return path.read_text(encoding="utf-8", errors="replace")


def files_for(source: dict) -> list[Path]:
    d = config.DATA_DIR / source["dir"]
    if not d.exists():
        return []
    return sorted(p for p in d.rglob("*") if p.is_file() and not p.name.startswith("."))


def build_config(size: int, overlap: int) -> dict:
    chunks: list[dict] = []
    for s in config.SOURCES:
        made = 0
        for f in files_for(s):
            try:
                text = read_text(f)
            except Exception as e:  # a bad file should not sink the export
                print(f"  skip {s['dir']}/{f.name}: {e}", file=sys.stderr)
                continue
            if not text.strip():
                continue
            for c in chunkers.chunk_document(text, s["kind"], f.name, size, overlap):
                chunks.append(
                    {
                        "id": len(chunks),
                        "text": c["text"],
                        "heading": c.get("heading", ""),
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
    return {"chunk_size": size, "overlap": overlap, "step": size - overlap, "chunks": chunks}


def main() -> None:
    out = {
        "sources": [
            {
                "dir": s["dir"],
                "label": s["label"],
                "kind": s["kind"],
                "blurb": s["blurb"],
                "color": s["color"],
                "file_count": len(files_for(s)),
                "file_names": [f.name for f in files_for(s)],
            }
            for s in config.SOURCES
        ],
        "configs": [],
    }
    for size, overlap in CONFIGS:
        cfg = build_config(size, overlap)
        out["configs"].append(cfg)
        print(f"  {size:>3}w / {overlap:>2} overlap -> {len(cfg['chunks']):>3} chunks", file=sys.stderr)

    out["corpus_files"] = sum(s["file_count"] for s in out["sources"])
    out["embed_model"] = EMBED_MODEL
    out["dims"] = EMBED_DIMS

    path = ROOT / "ui" / "public" / "index.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out), encoding="utf-8")
    print(
        f"wrote {path.relative_to(ROOT)} ({out['corpus_files']} files, "
        f"{sum(len(c['chunks']) for c in out['configs'])} chunks across {len(out['configs'])} configs)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
