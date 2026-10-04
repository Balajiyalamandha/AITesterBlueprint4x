"""Embeddings, served locally by Ollama.

The model is picked at runtime rather than hardcoded, because the "best" local model
depends on what you actually pulled:

    qwen3-embedding:0.6b  (1024d)  best quality-per-MB, strong on code - the default
    bge-m3                (1024d)  dense + multilingual all-rounder
    nomic-embed-text      (768d)   the light laptop fallback (chapter 10's model)

Set EMBED_MODEL in .env to pin one; leave it blank to auto-pick the first that exists.
Nothing here talks to the network beyond 127.0.0.1.
"""

from __future__ import annotations

import httpx

from . import config


def list_models() -> list[str]:
    try:
        r = httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=5)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


def pick_model() -> tuple[str, str]:
    """Return (model, reason). Honours EMBED_MODEL, else walks the preference list."""
    have = list_models()
    if config.EMBED_MODEL:
        return config.EMBED_MODEL, "pinned in .env"
    for pref in config.EMBED_PREFERENCE:
        if pref in have:
            return pref, f"auto (preferred, installed)"
        base = pref.split(":")[0]
        for m in have:
            if m.split(":")[0] == base:
                return m, f"auto (matched {base})"
    if have:
        return have[0], "fallback (no preferred model installed)"
    return "nomic-embed-text", "fallback (ollama unreachable at probe time)"


def ollama_up() -> bool:
    try:
        return httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=5).status_code == 200
    except Exception:
        return False


def embed(texts: list[str], model: str, batch_size: int = 32) -> list[list[float]]:
    """Embed in batches via Ollama's /api/embed. One vector per input, same order."""
    out: list[list[float]] = []
    with httpx.Client(timeout=600) as http:
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            r = http.post(f"{config.OLLAMA_URL}/api/embed", json={"model": model, "input": batch})
            if r.status_code != 200:
                raise RuntimeError(
                    f"Ollama embed failed ({r.status_code}). Is `ollama serve` running and "
                    f"`{model}` pulled? Body: {r.text[:200]}"
                )
            out.extend(r.json()["embeddings"])
    return out
