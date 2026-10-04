"""Storage and hybrid retrieval.

Dense vectors live in Qdrant (local mode: a folder on disk, no server to run). Lexical
scoring lives in an in-process BM25 index, and the two ranked lists are fused with
Reciprocal Rank Fusion.

Why BM25 in-process rather than Qdrant's native sparse vectors? Because at this corpus
size it is a dozen lines you can read, and the whole point of the chapter is that the
retrieval maths is visible. At scale, move the sparse side into Qdrant and keep the
same RRF step.

Why hybrid at all? Dense embeddings match meaning ("sign in" finds "authentication")
but are weak on exact strings. BM25 is the opposite: it nails `NullPointerException`,
`VWO-125`, HTTP 500 and build numbers, and misses paraphrase. Logs and code need both.
"""

from __future__ import annotations

import json
import re

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams
from rank_bm25 import BM25Okapi

from . import config

_client: QdrantClient | None = None
_BM25: BM25Okapi | None = None
_META: list[dict] = []
SNAPSHOT = config.ROOT / ".qabuddy_chunks.json"

PAYLOAD_FIELDS = (
    "text", "heading", "source_type", "source_label", "kind",
    "file", "rel_path", "chunk_index", "words", "chars",
)


def client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(path=str(config.QDRANT_PATH))
    return _client


def _tokenize(text: str) -> list[str]:
    """Split camelCase and snake_case so `loginValidator` matches a `login` query."""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    return re.findall(r"[a-zA-Z0-9_]+", text.lower())


# ------------------------------------------------------------------ build

def reset_collection(dim: int) -> None:
    c = client()
    try:
        c.delete_collection(config.COLLECTION)
    except Exception:
        pass
    c.create_collection(
        config.COLLECTION,
        vectors_config={"dense": VectorParams(size=dim, distance=Distance.COSINE)},
    )


def upsert(chunks: list[dict], vectors: list[list[float]]) -> None:
    points = [
        PointStruct(id=ch["id"], vector={"dense": vec}, payload={k: ch.get(k) for k in PAYLOAD_FIELDS})
        for ch, vec in zip(chunks, vectors)
    ]
    client().upsert(config.COLLECTION, points=points, wait=True)


def build_meta(chunks: list[dict]) -> None:
    """Rebuild the BM25 index over the chunk texts."""
    global _BM25, _META
    _META = chunks
    _BM25 = BM25Okapi([_tokenize(c["text"]) for c in chunks]) if chunks else None


def meta() -> list[dict]:
    return _META


def save_snapshot(chunks: list[dict]) -> None:
    SNAPSHOT.write_text(json.dumps(chunks), encoding="utf-8")


def load_snapshot() -> list[dict]:
    """Called on startup so BM25 is warm without re-ingesting."""
    if SNAPSHOT.exists():
        try:
            chunks = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
            build_meta(chunks)
            return chunks
        except Exception:
            return []
    return []


def count() -> int:
    try:
        return client().count(config.COLLECTION, exact=True).count
    except Exception:
        return 0


# ----------------------------------------------------------------- search

def search_dense(qvec: list[float], k: int, source: str | None = None) -> list[dict]:
    flt = None
    if source:
        flt = Filter(must=[FieldCondition(key="source_type", match=MatchValue(value=source))])
    try:
        res = client().query_points(
            collection_name=config.COLLECTION, query=qvec, using="dense", limit=k, query_filter=flt
        )
        pts = res.points
    except Exception:
        pts = client().search(
            collection_name=config.COLLECTION, query_vector=("dense", qvec), limit=k, query_filter=flt
        )
    return [{"id": p.id, "dense_score": float(p.score), **(p.payload or {})} for p in pts]


def search_lexical(query: str, k: int, source: str | None = None) -> list[dict]:
    if _BM25 is None:
        return []
    scores = _BM25.get_scores(_tokenize(query))
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    hits: list[dict] = []
    for i in order:
        if scores[i] <= 0:
            break
        ch = _META[i]
        if source and ch.get("source_type") != source:
            continue
        hits.append({"id": ch["id"], "bm25_score": float(scores[i]), **ch})
        if len(hits) >= k:
            break
    return hits


def search(
    query: str,
    qvec: list[float] | None,
    k: int = 5,
    mode: str = "hybrid",
    source: str | None = None,
    rrf_k: int = 60,
) -> list[dict]:
    """Retrieve and fuse. `mode` is hybrid | dense | lexical."""
    want_dense = mode in ("hybrid", "dense") and qvec is not None
    want_lex = mode in ("hybrid", "lexical")

    dense = search_dense(qvec, k * 3, source) if want_dense else []
    lex = search_lexical(query, k * 3, source) if want_lex else []

    dmap = {h["id"]: h for h in dense}
    lmap = {h["id"]: h for h in lex}

    if mode == "dense":
        ordered = [{"id": h["id"], "rrf": 0.0} for h in dense[:k]]
    elif mode == "lexical":
        ordered = [{"id": h["id"], "rrf": 0.0} for h in lex[:k]]
    else:
        agg: dict[int, dict] = {}
        for rank, h in enumerate(dense):
            agg.setdefault(h["id"], {"id": h["id"], "rrf": 0.0})["rrf"] += 1.0 / (rrf_k + rank + 1)
        for rank, h in enumerate(lex):
            agg.setdefault(h["id"], {"id": h["id"], "rrf": 0.0})["rrf"] += 1.0 / (rrf_k + rank + 1)
        ordered = sorted(agg.values(), key=lambda e: -e["rrf"])[:k]

    max_dense = max((h["dense_score"] for h in dense), default=1.0) or 1.0
    max_lex = max((h["bm25_score"] for h in lex), default=1.0) or 1.0

    out = []
    for rank, pick in enumerate(ordered):
        cid = pick["id"]
        base = _META[cid] if 0 <= cid < len(_META) else {}
        d = dmap.get(cid, {})
        l = lmap.get(cid, {})
        out.append(
            {
                "rank": rank + 1,
                "id": cid,
                "source_type": base.get("source_type"),
                "source_label": base.get("source_label"),
                "kind": base.get("kind"),
                "file": base.get("file"),
                "rel_path": base.get("rel_path"),
                "heading": base.get("heading"),
                "chunk_index": base.get("chunk_index"),
                "words": base.get("words"),
                "text": base.get("text"),
                "dense_score": round(d.get("dense_score", 0.0), 4),
                "bm25_score": round(l.get("bm25_score", 0.0), 4),
                "rrf_score": round(pick["rrf"], 5),
                "dense_pct": round(d.get("dense_score", 0.0) * 100, 1),
                "lex_pct": round(l.get("bm25_score", 0.0) / max_lex * 100, 1),
            }
        )
    return out
