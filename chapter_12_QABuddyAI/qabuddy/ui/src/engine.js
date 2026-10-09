/* Two ways to run QABuddy.
 *
 *  live   - the FastAPI backend is up (npm run dev locally). Chunking, embedding (Ollama)
 *           and hybrid retrieval (Qdrant + BM25 + RRF) all happen server side. This is the
 *           real pipeline in server/.
 *
 *  static - the hosted build on Vercel, where there is no Ollama, no Qdrant and no Python.
 *           The chunk sets are pre-split at build time (scripts/export_chunks.py) and both
 *           the chunks and the query are embedded in the browser with MiniLM at 384d.
 *           Dense cosine, BM25 and Reciprocal Rank Fusion are computed here in JavaScript,
 *           so the hybrid ranking the UI shows is genuinely computed in both modes. Only
 *           the final answer calls out, through /api/chat, so the Groq key stays server-side.
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

let MODE = null; // 'live' | 'static'
let HEALTH = null;

export async function detectMode() {
  if (MODE) return { mode: MODE, health: HEALTH };
  // The hosted build is compiled with VITE_STATIC=1, so it never probes for a backend
  // that cannot exist there (and never logs a 404 in the console).
  if (import.meta.env.VITE_STATIC) {
    MODE = 'static';
  } else {
    try {
      // Health pings Ollama server-side, so give it room; too tight a budget silently
      // misclassifies a working local backend as hosted.
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        MODE = 'live';
        HEALTH = await r.json();
      }
    } catch {
      /* no backend: fall through to the hosted path */
    }
    if (!MODE) MODE = 'static';
  }
  return { mode: MODE, health: HEALTH };
}

/* ------------------------------------------------------------------- live */

const liveEngine = {
  health: () => json('/api/health'),
  sources: () => json('/api/sources'),
  chunks: (source) => json('/api/chunks' + (source ? `?source=${encodeURIComponent(source)}` : '')),
  ingest: (body) => json('/api/ingest', body),
  search: (body) => json('/api/search', body),
  chat: (body) => json('/api/chat', body),
};

/* ----------------------------------------------------------------- static */

const DEFAULT_SIZE = 150;
const EMBED_BATCH = 24; // chunk texts per forward pass
const MINILM = 'Xenova/all-MiniLM-L6-v2';

let INDEX = null;
let extractor = null;
let active = null; // { index, cfg, bm, ready, dims } for the selected chunk config
let onProgress = null;

async function loadIndex() {
  if (!INDEX) INDEX = await json('/index.json');
  return INDEX;
}

/** Lazy-load the embedding model. ~23MB, downloaded once then cached by the browser. */
async function getExtractor() {
  if (extractor) return extractor;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  // Single-threaded WASM pulls a much smaller runtime than the threaded+asyncify build.
  env.backends.onnx.wasm.numThreads = 1;
  extractor = await pipeline('feature-extraction', MINILM, {
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) onProgress?.(Math.round((p.loaded / p.total) * 100));
    },
  });
  return extractor;
}

async function embedBatch(texts) {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: 'mean', normalize: true });
  const [n, dims] = out.dims;
  const flat = Array.from(out.data);
  const vecs = [];
  for (let i = 0; i < n; i++) vecs.push(flat.slice(i * dims, (i + 1) * dims));
  return { vecs, dims };
}

/** Embed every chunk in the selected config once, then reuse the vectors. */
async function ensureVectors(a) {
  if (a.ready) return a;
  if (!a.cfg.chunks.length) {
    a.ready = true;
    a.dims = 0;
    return a;
  }
  let dims = 0;
  for (let i = 0; i < a.cfg.chunks.length; i += EMBED_BATCH) {
    const slice = a.cfg.chunks.slice(i, i + EMBED_BATCH);
    const out = await embedBatch(slice.map((c) => c.text));
    dims = out.dims;
    out.vecs.forEach((v, j) => {
      slice[j].vector = v;
    });
  }
  a.dims = dims;
  a.ready = true;
  return a;
}

/** Both sides are unit-normalised, so the dot product IS the cosine similarity. */
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/* rank_bm25's BM25Okapi, reimplemented so the hosted build ranks like the server:
 * k1=1.5, b=0.75, epsilon=0.25. Split camelCase and snake_case first so `loginValidator`
 * matches a `login` query (mirrors server/store.py:_tokenize). */
const K1 = 1.5;
const B = 0.75;
const EPSILON = 0.25;

const tokenize = (text) =>
  (text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-zA-Z0-9_]+/g)) || [];

function buildBm25(texts) {
  const docs = texts.map(tokenize);
  const N = docs.length || 1;
  const df = new Map();
  const dl = [];
  const freqs = docs.map((toks) => {
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    dl.push(toks.length);
    return m;
  });
  const avgdl = dl.reduce((s, l) => s + l, 0) / N || 1;
  const idf = new Map();
  let idfSum = 0;
  const negatives = [];
  for (const [w, f] of df) {
    const v = Math.log(N - f + 0.5) - Math.log(f + 0.5);
    idf.set(w, v);
    idfSum += v;
    if (v < 0) negatives.push(w);
  }
  const eps = EPSILON * (idf.size ? idfSum / idf.size : 0);
  for (const w of negatives) idf.set(w, eps);
  return { N, avgdl, dl, idf, freqs };
}

function bm25Scores(bm, query) {
  const scores = new Array(bm.N).fill(0);
  for (const q of tokenize(query)) {
    const idf = bm.idf.get(q);
    if (idf === undefined) continue;
    for (let i = 0; i < bm.N; i++) {
      const f = bm.freqs[i].get(q);
      if (!f) continue;
      scores[i] += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + B * (bm.dl[i] / bm.avgdl)));
    }
  }
  return scores;
}

function pickConfig(index, size) {
  return index.configs.reduce((best, c) =>
    Math.abs(c.chunk_size - size) < Math.abs(best.chunk_size - size) ? c : best);
}

async function select(chunk_size = DEFAULT_SIZE) {
  const index = await loadIndex();
  const cfg = pickConfig(index, chunk_size);
  if (active && active.cfg === cfg) return active;
  active = { index, cfg, bm: buildBm25(cfg.chunks.map((c) => c.text)), ready: false, dims: 0 };
  return active;
}

async function current() {
  if (active) return active;
  return select(DEFAULT_SIZE);
}

const configMeta = (cfg) => ({ chunk_size: cfg.chunk_size, overlap: cfg.overlap, step: cfg.step });

const staticEngine = {
  async health() {
    const index = await loadIndex();
    const cfg = active ? active.cfg : pickConfig(index, DEFAULT_SIZE);
    return {
      ollama: false,
      embed_model: index.embed_model,
      embed_model_reason: 'MiniLM · embedded in the browser (hosted build)',
      llm_model: 'openai/gpt-oss-120b',
      groq_key_loaded: true,
      vector_db: 'JSON · cosine in-browser',
      indexed: true,
      chunks: cfg.chunks.length,
      points: cfg.chunks.length,
      corpus_files: index.corpus_files,
      sources: index.sources.length,
      dims: index.dims,
    };
  },

  async sources() {
    const a = await current();
    const counts = {};
    for (const c of a.cfg.chunks) counts[c.source_type] = (counts[c.source_type] || 0) + 1;
    return {
      sources: a.index.sources.map((s) => ({ ...s, indexed_chunks: counts[s.dir] || 0 })),
      total_files: a.index.corpus_files,
      indexed: true,
    };
  },

  async chunks(source) {
    const a = await current();
    const items = source ? a.cfg.chunks.filter((c) => c.source_type === source) : a.cfg.chunks;
    return {
      chunks: items.map(({ vector, ...rest }) => rest),
      total: items.length,
      config: configMeta(a.cfg),
    };
  },

  async ingest({ chunk_size = DEFAULT_SIZE } = {}) {
    const t0 = performance.now();
    const a = await ensureVectors(await select(chunk_size));
    const per_source = a.index.sources.map((s) => ({
      dir: s.dir,
      label: s.label,
      kind: s.kind,
      color: s.color,
      files: s.file_count,
      file_names: s.file_names,
      chunks: a.cfg.chunks.filter((c) => c.source_type === s.dir).length,
    }));
    return {
      model: a.index.embed_model,
      model_reason: 'chunks and query embedded in the browser',
      dims: a.dims,
      chunk_count: a.cfg.chunks.length,
      file_count: a.index.corpus_files,
      per_source,
      errors: [],
      config: configMeta(a.cfg),
      timings: { embed_ms: 0, total_ms: Math.round(performance.now() - t0) },
    };
  },

  async search({ query, k = 5, mode = 'hybrid', source = null } = {}) {
    const a = await ensureVectors(await current());
    const t0 = performance.now();
    const wantDense = mode !== 'lexical';
    const wantLex = mode !== 'dense';

    let qvec = null;
    let embed_ms = 0;
    if (wantDense) {
      qvec = (await embedBatch([query])).vecs[0];
      embed_ms = performance.now() - t0;
    }

    const t1 = performance.now();
    const ids = new Set();
    for (let i = 0; i < a.cfg.chunks.length; i++) {
      if (!source || a.cfg.chunks[i].source_type === source) ids.add(i);
    }

    const dense = wantDense
      ? [...ids]
          .map((i) => ({ id: i, dense_score: dot(qvec, a.cfg.chunks[i].vector) }))
          .sort((x, y) => y.dense_score - x.dense_score)
          .slice(0, k * 3)
      : [];
    const lex = wantLex
      ? bm25Scores(a.bm, query)
          .map((score, i) => ({ id: i, bm25_score: score }))
          .filter((x) => ids.has(x.id) && x.bm25_score > 0)
          .sort((x, y) => y.bm25_score - x.bm25_score)
          .slice(0, k * 3)
      : [];

    const dmap = new Map(dense.map((h) => [h.id, h]));
    const lmap = new Map(lex.map((h) => [h.id, h]));

    let ordered;
    if (mode === 'dense') {
      ordered = dense.slice(0, k).map((h) => ({ id: h.id, rrf: 0 }));
    } else if (mode === 'lexical') {
      ordered = lex.slice(0, k).map((h) => ({ id: h.id, rrf: 0 }));
    } else {
      const agg = new Map();
      const bump = (h, rank) => {
        const e = agg.get(h.id) || { id: h.id, rrf: 0 };
        e.rrf += 1 / (60 + rank + 1);
        agg.set(h.id, e);
      };
      dense.forEach(bump);
      lex.forEach(bump);
      ordered = [...agg.values()].sort((x, y) => y.rrf - x.rrf).slice(0, k);
    }

    const maxLex = Math.max(1e-9, ...lex.map((h) => h.bm25_score));
    const hits = ordered.map((p, rank) => {
      const c = a.cfg.chunks[p.id];
      const ds = dmap.get(p.id)?.dense_score || 0;
      const ls = lmap.get(p.id)?.bm25_score || 0;
      return {
        rank: rank + 1,
        id: p.id,
        source_type: c.source_type,
        source_label: c.source_label,
        kind: c.kind,
        file: c.file,
        rel_path: c.rel_path,
        heading: c.heading,
        chunk_index: c.chunk_index,
        words: c.words,
        text: c.text,
        dense_score: +ds.toFixed(4),
        bm25_score: +ls.toFixed(4),
        rrf_score: +p.rrf.toFixed(5),
        dense_pct: +(ds * 100).toFixed(1),
        lex_pct: +((ls / maxLex) * 100).toFixed(1),
      };
    });

    return {
      query,
      mode,
      source,
      hits,
      searched_chunks: a.cfg.chunks.length,
      timings: { embed_ms: +embed_ms.toFixed(1), search_ms: +(performance.now() - t1).toFixed(2) },
      query_vector: qvec
        ? {
            dims: qvec.length,
            preview: qvec.slice(0, 10).map((v) => +v.toFixed(3)),
            min: +Math.min(...qvec).toFixed(3),
            max: +Math.max(...qvec).toFixed(3),
            l2_norm: +Math.sqrt(dot(qvec, qvec)).toFixed(3),
          }
        : null,
    };
  },

  async chat({ query, k = 5, mode = 'hybrid', source = null } = {}) {
    const found = await staticEngine.search({ query, k, mode, source });
    const t0 = performance.now();
    const res = await json('/api/chat', {
      query,
      chunks: found.hits.map((h) => ({ index: h.rank, text: h.text })),
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

/* ------------------------------------------------------------------- facade */

async function ensure() {
  if (!MODE) await detectMode();
}

const engine = () => (MODE === 'live' ? liveEngine : staticEngine);

export const api = {
  health: async () => (await ensure(), engine().health()),
  sources: async () => (await ensure(), engine().sources()),
  chunks: async (source) => (await ensure(), engine().chunks(source)),
  ingest: async (body) => (await ensure(), engine().ingest(body)),
  search: async (body) => (await ensure(), engine().search(body)),
  chat: async (body) => (await ensure(), engine().chat(body)),
};

export function setModelProgress(fn) {
  onProgress = fn;
}
