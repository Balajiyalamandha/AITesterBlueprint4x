"""Emit chunk sets for several configs, reusing the same code the live server runs."""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.app import extract_pdf, normalise, chunk_text, DATA_DIR

CONFIGS = [(60, 20), (100, 20), (140, 30), (180, 40), (260, 50), (400, 80)]

pdf = sorted(DATA_DIR.glob("*.pdf"))[0]
raw, pages = extract_pdf(pdf)
clean = normalise(raw)

out = {
    "doc": {
        "filename": pdf.name,
        "pages": len(pages),
        "raw_chars": len(raw),
        "clean_chars": len(clean),
        "words": len(clean.split()),
        "raw_sample": raw[:280],
        "clean_sample": clean[:280],
    },
    "configs": [],
}
for size, overlap in CONFIGS:
    chunks = chunk_text(clean, size, overlap)
    out["configs"].append(
        {
            "chunk_size": size,
            "overlap": overlap,
            "step": size - overlap,
            "chunks": [
                {k: c[k] for k in ("id", "index", "text", "word_count", "char_count", "word_start", "word_end")}
                for c in chunks
            ],
        }
    )
    print(f"  {size:>3}w / {overlap:>2} overlap -> {len(chunks):>3} chunks", file=sys.stderr)

Path("scripts/chunks.json").write_text(json.dumps(out))
print(f"total chunks: {sum(len(c['chunks']) for c in out['configs'])}", file=sys.stderr)
