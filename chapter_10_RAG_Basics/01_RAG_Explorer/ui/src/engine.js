/* Two ways to run the same explorer.
 *
 *  live   - the Python backend is up (npm run dev locally). Ingest, embedding and
 *           vector search all happen server side: pypdf, nomic-embed-text via Ollama
 *           at 768 dims, ChromaDB. This is the real pipeline.
 *
 *  static - the hosted build on Vercel, where there is no Ollama and no Python. Chunk
 *           vectors were pre-computed at build time and the query is embedded in the
 *           browser with MiniLM at 384 dims. Cosine similarity over 79 vectors is
 *           microseconds of JavaScript, so no vector database is needed at this size.
 *
 * Everything the UI renders (chunks, vectors, distances, scores) is genuinely computed
 * in both modes. Only the model and where it runs differ.
 */

const json = async (url, body) => {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
  return d;
};

export async function detectMode() {
  // The hosted build is compiled with VITE_STATIC=1, so it never probes for a backend
  // that cannot exist there (and never logs a 404 in the student's console).
  if (import.meta.env.VITE_STATIC) return { mode: 'static', health: null };
  try {
    // Health pings Ollama server-side, so it is not instant. Too tight a budget here
    // silently misclassifies a working local backend as "hosted" and drops the UI into
    // static mode, which is a confusing failure to debug.
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    if (r.ok) return { mode: 'live', health: await r.json() };
  } catch {
    /* no backend: fall through to the hosted path */
  }
  return { mode: 'static', health: null };
}

/* ------------------------------------------------------------------ static */

let INDEX = null;
let extractor = null;

async function loadIndex() {
  if (!INDEX) INDEX = await json('/index.json');
  return INDEX;
}

/** Lazy-load the embedding model. ~23MB, downloaded once then cached by the browser. */
async function getExtractor(onProgress) {
  if (extractor) return extractor;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  // Single-threaded WASM pulls a much smaller runtime than the threaded+asyncify build,
  // which matters when a class of students each load this once.
  env.backends.onnx.wasm.numThreads = 1;
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        onProgress?.(Math.round((p.loaded / p.total) * 100));
      }
    },
  });
  return extractor;
}

async function embedQuery(text, onProgress) {
  const ex = await getExtractor(onProgress);
  const out = await ex([text], { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** Both sides are unit-normalised, so the dot product IS the cosine similarity. */
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function pickConfig(index, size) {
  return index.configs.reduce((best, c) =>
    Math.abs(c.chunk_size - size) < Math.abs(best.chunk_size - size) ? c : best
  );
}

export const staticEngine = {
  async ingest({ chunk_size }, onProgress) {
    const index = await loadIndex();
    const cfg = pickConfig(index, chunk_size);
    const t0 = performance.now();
    return {
      doc: index.doc,
      config: { chunk_size: cfg.chunk_size, overlap: cfg.overlap, step: cfg.step },
      chunk_count: cfg.chunks.length,
      vector_dims: cfg.dims,
      timings: { extract_ms: 0, normalise_ms: 0, chunk_ms: 0, embed_ms: 0, prebuilt: true },
      chunks: cfg.chunks.map((c) => ({
        ...c,
        vector_dims: cfg.dims,
        vector_preview: c.vector.slice(0, 8),
      })),
      _cfg: cfg,
      _load_ms: Math.round(performance.now() - t0),
    };
  },

  async search({ query, k = 3, cfg }, onProgress) {
    const t0 = performance.now();
    const qvec = await embedQuery(query, onProgress);
    const embed_ms = performance.now() - t0;

    const t1 = performance.now();
    const scored = cfg.chunks
      .map((c) => {
        const similarity = dot(qvec, c.vector);
        return {
          id: c.id,
          index: c.index,
          text: c.text,
          words: c.word_count,
          similarity: +similarity.toFixed(4),
          distance: +(1 - similarity).toFixed(4),
          percent: +(similarity * 100).toFixed(1),
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    const search_ms = performance.now() - t1;

    return {
      query,
      hits: scored,
      searched_chunks: cfg.chunks.length,
      query_vector: {
        dims: qvec.length,
        preview: qvec.slice(0, 12).map((v) => +v.toFixed(4)),
        min: +Math.min(...qvec).toFixed(4),
        max: +Math.max(...qvec).toFixed(4),
        l2_norm: +Math.sqrt(dot(qvec, qvec)).toFixed(4),
      },
      timings: {
        embed_ms: +embed_ms.toFixed(1),
        vector_search_ms: +search_ms.toFixed(2),
      },
    };
  },

  async chat({ query, k = 3, cfg }, onProgress) {
    const found = await this.search({ query, k, cfg }, onProgress);
    const t0 = performance.now();
    const res = await json('/api/chat', {
      query,
      chunks: found.hits.map((h) => ({ index: h.index, text: h.text })),
    });
    return {
      ...found,
      answer: res.answer,
      model: res.model,
      usage: res.usage,
      prompt_sent: res.prompt_sent,
      timings: { ...found.timings, llm_ms: +(performance.now() - t0).toFixed(1) },
    };
  },
};

/* -------------------------------------------------------------------- live */

export const liveEngine = {
  ingest: (body) => json('/api/ingest', body),
  search: ({ query, k }) => json('/api/search', { query, k }),
  chat: ({ query, k }) => json('/api/chat', { query, k }),
};
