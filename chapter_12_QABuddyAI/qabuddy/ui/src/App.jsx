import React, { useEffect, useState } from 'react';
import { api, detectMode, setModelProgress } from './engine.js';

const MODES = [
  ['hybrid', 'Hybrid · RRF'],
  ['dense', 'Dense only'],
  ['lexical', 'BM25 only'],
];

const SAMPLES = [
  'Why did TC-LOGIN-007 fail on build 1421?',
  'Where must the invalid credentials error be rendered?',
  'What password rules apply at login time?',
  'What did the 2026-09-18 sprint decide about lockout?',
  'Which component must never be used for invalid_credentials?',
  'What is the p95 latency target for login?',
];

/* Render **bold**, bullets and [chunk N] citations. The citations become badges so you
   can see at a glance which retrieved chunk each claim came from. */
function Rich({ text }) {
  // Accept both `[chunk N]` (what we ask for) and the `【N†L1-L4】` form some models emit.
  const CITE = /(\[chunk\s*\d+\]|\u3010\s*\d+[^\u3011]*\u3011)/gi;
  const BOLD = /\*\*(.+?)\*\*/g;

  const inline = (s, key) =>
    s.split(CITE).map((part, i) => {
      if (/^(\[chunk\s*\d+\]|\u3010\s*\d+[^\u3011]*\u3011)$/i.test(part)) {
        const n = part.match(/\d+/)[0];
        return <span className="cite" key={`${key}-c${i}`}>chunk {n}</span>;
      }
      const bits = [];
      let last = 0, m;
      BOLD.lastIndex = 0;
      while ((m = BOLD.exec(part))) {
        if (m.index > last) bits.push(part.slice(last, m.index));
        bits.push(<b key={`${key}-b${i}-${m.index}`}>{m[1]}</b>);
        last = m.index + m[0].length;
      }
      if (last < part.length) bits.push(part.slice(last));
      return <React.Fragment key={`${key}-t${i}`}>{bits}</React.Fragment>;
    });

  return (
    <div className="rich">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div style={{ height: 8 }} key={i} />;
        const li = t.match(/^[*\-•]\s+(.*)$/);
        if (li) return <div className="li" key={i}><span className="dot" />{inline(li[1], i)}</div>;
        return <p key={i}>{inline(t, i)}</p>;
      })}
    </div>
  );
}

function SourceBadge({ type, label, color }) {
  return (
    <span className="src" style={{ color: color || '#444', borderColor: (color || '#999') + '55', background: (color || '#999') + '12' }}>
      {label || type}
    </span>
  );
}

/* ------------------------------------------------------------------ Corpus */

function Corpus({ health, sources, ingest, onIndex, busy, err, mode }) {
  const [size, setSize] = useState(150);
  const [overlap, setOverlap] = useState(30);
  const [open, setOpen] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [chunkErr, setChunkErr] = useState(null);

  const r = ingest;
  const colorOf = (dir) => sources?.find((s) => s.dir === dir)?.color;

  async function viewSource(s) {
    setOpen(s.dir);
    setChunks(null);
    setChunkErr(null);
    try {
      const d = await api.chunks(s.dir);
      setChunks(d.chunks);
    } catch (e) {
      setChunkErr(e.message);
    }
  }

  return (
    <>
      <h2>1 · The corpus</h2>
      <p className="sub">
        Twelve source types, one index. Each type is chunked the way it deserves:
        requirements and notes by heading, code by top-level block, logs by line window,
        test cases one row per chunk, Jira tickets one field per chunk.
      </p>

      <div className="pipe">
        {[
          ['Chunk', mode === 'static' ? 'per source kind · baked' : 'per source kind'],
          ['Embed', mode === 'static' ? 'MiniLM · 384d · browser' : `${health?.embed_model || 'ollama'} · Ollama`],
          ['Store', mode === 'static' ? 'JSON · cosine in JS' : 'Qdrant · local'],
          ['Index', 'dense + BM25'],
          ['Ask', `${health?.llm_model || 'llm'} · Groq`],
        ].map(([b, s], i, a) => (
          <div className="step" key={b}>
            <b>{i + 1}. {b}</b><span>{s}</span>
            {i < a.length - 1 && <i>›</i>}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="grid g2">
          <div>
            <label className="fld">Chunk size: <b>{size}</b> words</label>
            <input type="range" min="60" max="300" step="10" value={size}
              onChange={(e) => setSize(+e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="fld">Overlap: <b>{overlap}</b> words</label>
            <input type="range" min="0" max={Math.max(size - 20, 0)} step="5" value={overlap}
              onChange={(e) => setOverlap(+e.target.value)} disabled={busy} />
          </div>
        </div>
        <button className="go" style={{ marginTop: 13 }} onClick={() => onIndex(size, overlap)} disabled={busy}>
          {busy ? <><span className="spin" /> Indexing…</> : r ? 'Re-index corpus' : 'Index corpus'}
        </button>
        {err && <div className="err" style={{ marginTop: 11 }}>{err}</div>}
      </div>

      {r && (
        <>
          <div className="grid g4" style={{ marginTop: 16 }}>
            <div className="stat"><div className="n">{r.file_count}</div><div className="l">files</div></div>
            <div className="stat"><div className="n">{r.chunk_count}</div><div className="l">chunks</div></div>
            <div className="stat"><div className="n">{r.dims}</div><div className="l">dimensions</div></div>
            <div className="stat"><div className="n" style={{ fontSize: 14 }}>{r.model}</div><div className="l">embed model</div></div>
            <div className="stat">
              {mode === 'static'
                ? <><div className="n" style={{ fontSize: 15 }}>pre-built</div><div className="l">vectors</div></>
                : <><div className="n">{r.timings?.embed_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">embed time</div></>}
            </div>
          </div>
          <div className="note">
            {mode === 'static'
              ? <>These chunks were <b>pre-computed at build time</b>. Model: <b>{r.model}</b> — {r.model_reason}.</>
              : <>Chunked and embedded entirely on this machine in {r.timings?.total_ms} ms. Model pick:{' '}
                <b>{r.model}</b> — {r.model_reason}.</>}
          </div>
          {r.errors?.length > 0 && (
            <div className="err" style={{ marginTop: 11 }}>{r.errors.join(' · ')}</div>
          )}
        </>
      )}

      <h2>Sources</h2>
      <p className="sub">Click a source to read the exact chunks that were indexed from it.</p>
      <div className="srcgrid">
        {sources?.map((s) => (
          <button key={s.dir} className={`srccard${open === s.dir ? ' on' : ''}`} onClick={() => viewSource(s)}>
            <span className="dotbig" style={{ background: s.color }} />
            <div className="srctext">
              <b>{s.label}</b>
              <span>{s.blurb}</span>
            </div>
            <div className="srcnums">
              <span>{s.file_count} file{s.file_count === 1 ? '' : 's'}</span>
              <span>{s.indexed_chunks} chunks</span>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <>
          <h2>{sources?.find((s) => s.dir === open)?.label} · chunks</h2>
          {chunkErr && <div className="err">{chunkErr}</div>}
          {chunks === null && !chunkErr && <p className="sub">Loading…</p>}
          {chunks?.length === 0 && <p className="sub">No chunks indexed from this source yet.</p>}
          {chunks?.map((c) => (
            <div className="chunk" key={c.id}>
              <div className="top">
                <span className="cid">{c.file} · #{c.chunk_index}</span>
                <span className="meta">{c.heading || c.kind} · {c.words} words</span>
              </div>
              <p>{c.text}</p>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Hits */

function Hits({ res, sources }) {
  const colorOf = (dir) => sources?.find((s) => s.dir === dir)?.color;
  return res.hits.map((h, i) => (
    <div className={`hit${i === 0 ? ' top1' : ''}`} key={h.id}>
      <div className="top">
        <span className="rank">{i + 1}</span>
        <SourceBadge type={h.source_type} label={h.source_label} color={colorOf(h.source_type)} />
        <span className="meta">{h.file}</span>
      </div>
      {h.heading && <div className="meta" style={{ margin: '6px 0' }}>{h.heading}</div>}
      <div className="scores">
        <span>dense <b>{h.dense_pct}%</b></span>
        <span>bm25 <b>{h.lex_pct}%</b></span>
        <span className="rrf">rrf <b>{h.rrf_score}</b></span>
      </div>
      <div className="bar"><i style={{ width: `${Math.max(res.mode === 'lexical' ? h.lex_pct : h.dense_pct, 2)}%` }} /></div>
      <p style={{ fontSize: 13.5, margin: 0 }}>{h.text}</p>
    </div>
  ));
}

function ServerWeights({ res }) {
  const v = res.query_vector;
  return (
    <details open>
      <summary>Server side · what the retrieval actually did</summary>
      <div className="card" style={{ marginTop: 9 }}>
        <div className="grid g4">
          <div className="stat"><div className="n" style={{ fontSize: 15 }}>{res.mode}</div><div className="l">mode</div></div>
          <div className="stat"><div className="n">{v ? v.dims : '–'}</div><div className="l">query dims</div></div>
          <div className="stat"><div className="n">{res.searched_chunks}</div><div className="l">chunks scanned</div></div>
          <div className="stat"><div className="n">{res.timings.embed_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">embed</div></div>
          <div className="stat"><div className="n">{res.timings.search_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">search</div></div>
        </div>
        {v && (
          <div className="vec" style={{ marginTop: 11 }}>
            query_vector = [{v.preview.join(', ')}, … +{v.dims - v.preview.length} more] · range [{v.min}, {v.max}]
          </div>
        )}
        <div className="note">
          <b>Hybrid</b> runs two retrievers and fuses them. Dense (Qdrant, cosine) matches
          meaning: "sign in" finds "authentication". BM25 matches exact strings: <span className="mono">VWO-125</span>,{' '}
          <span className="mono">TC-LOGIN-007</span>, <span className="mono">invalid_credentials</span>. Reciprocal Rank
          Fusion scores each hit by <span className="mono">Σ 1/(60 + rank)</span> across the two lists, so a chunk that
          ranks well in <i>both</i> wins. Switch to Dense or BM25 only to watch either side fail on its own.
        </div>
      </div>
    </details>
  );
}

/* ----------------------------------------------------------------- Search */

function Search({ ready, sources }) {
  const [q, setQ] = useState(SAMPLES[0]);
  const [k, setK] = useState(5);
  const [mode, setMode] = useState('hybrid');
  const [source, setSource] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(e) {
    e?.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr(null);
    try { setRes(await api.search({ query: q, k, mode, source: source || null })); }
    catch (e2) { setErr(e2.message); setRes(null); }
    finally { setBusy(false); }
  }

  if (!ready) return <p className="sub" style={{ marginTop: 24 }}>Index the corpus first (tab 1).</p>;

  return (
    <>
      <h2>2 · Retrieval only</h2>
      <p className="sub">No LLM. Just retrieve, score, and rank — across all twelve source types at once.</p>

      <form className="row" onSubmit={run}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="Ask across the corpus…" />
        <button className="go" disabled={busy || !q.trim()}>{busy ? <span className="spin" /> : 'Search'}</button>
      </form>

      <div className="controls">
        <div className="seg">
          {MODES.map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} type="button">{label}</button>
          ))}
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources?.map((s) => <option key={s.dir} value={s.dir}>{s.label}</option>)}
        </select>
        <label className="fld" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          top-k <b>{k}</b>
          <input type="range" min="1" max="10" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: 110 }} />
        </label>
      </div>

      <div className="chips">
        {SAMPLES.map((s) => <button className="ghost" key={s} type="button" onClick={() => setQ(s)}>{s}</button>)}
      </div>

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      {res && (
        <>
          <h2>Top {res.hits.length}</h2>
          <Hits res={res} sources={sources} />
          <ServerWeights res={res} />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Chat */

function Chat({ ready, sources }) {
  const [q, setQ] = useState(SAMPLES[0]);
  const [k, setK] = useState(5);
  const [mode, setMode] = useState('hybrid');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(e) {
    e?.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr(null);
    try { setRes(await api.chat({ query: q, k, mode })); }
    catch (e2) { setErr(e2.message); setRes(null); }
    finally { setBusy(false); }
  }

  if (!ready) return <p className="sub" style={{ marginTop: 24 }}>Index the corpus first (tab 1).</p>;

  return (
    <>
      <h2>3 · Grounded answer</h2>
      <p className="sub">
        The retrieved chunks are pasted into a prompt for {res?.model || 'the LLM'}, which is
        told to answer only from them and to cite each claim with [chunk N].
      </p>

      <form className="row" onSubmit={run}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} placeholder="Ask a question…" />
        <button className="go" disabled={busy || !q.trim()}>{busy ? <><span className="spin" /> Thinking…</> : 'Ask'}</button>
      </form>

      <div className="controls">
        <div className="seg">
          {MODES.map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} type="button">{label}</button>
          ))}
        </div>
        <label className="fld" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          top-k <b>{k}</b>
          <input type="range" min="1" max="10" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: 110 }} />
        </label>
      </div>

      <div className="chips">
        {SAMPLES.map((s) => <button className="ghost" key={s} type="button" onClick={() => setQ(s)}>{s}</button>)}
      </div>

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      {res && (
        <>
          <h2>Answer</h2>
          <div className="answer"><Rich text={res.answer} /></div>
          <div className="grid g4" style={{ marginTop: 13 }}>
            <div className="stat"><div className="n">{res.usage?.prompt_tokens ?? '–'}</div><div className="l">prompt tokens</div></div>
            <div className="stat"><div className="n">{res.usage?.completion_tokens ?? '–'}</div><div className="l">output tokens</div></div>
            <div className="stat"><div className="n">{res.timings.llm_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">llm</div></div>
            <div className="stat"><div className="n">{res.timings.embed_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">embed</div></div>
            <div className="stat"><div className="n">{res.timings.search_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">search</div></div>
          </div>

          <h2>The chunks it was given</h2>
          <Hits res={res} sources={sources} />

          <details>
            <summary>Server side · the exact prompt sent to {res.model}</summary>
            <div className="card" style={{ marginTop: 9 }}>
              <span className="tag good">system</span>
              <pre className="box">{res.prompt_sent.system}</pre>
              <span className="tag good" style={{ marginTop: 10, display: 'inline-block' }}>
                user · {res.prompt_sent.chars.toLocaleString()} chars
              </span>
              <pre className="box">{res.prompt_sent.user}</pre>
            </div>
          </details>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- App */

export default function App() {
  const [tab, setTab] = useState('corpus');
  const [health, setHealth] = useState(null);
  const [sources, setSources] = useState(null);
  const [ingest, setIngest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null);
  const [dl, setDl] = useState(null);

  async function refresh() {
    try {
      const [h, s] = await Promise.all([api.health(), api.sources()]);
      setHealth(h);
      setSources(s.sources);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    setModelProgress((pct) => setDl(pct >= 100 ? null : pct));
    detectMode().then(({ mode: m }) => {
      setMode(m);
      refresh();
    });
  }, []);

  async function onIndex(size, overlap) {
    setBusy(true); setErr(null);
    try {
      const r = await api.ingest({ chunk_size: size, overlap });
      setIngest(r);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = [['corpus', '1 · Corpus'], ['search', '2 · Search'], ['chat', '3 · Chat']];

  return (
    <>
      <header>
        <div className="hd">
          <div className="logo">🧭</div>
          <div><h1>QABuddyAI</h1><p>Multi-source retrieval for QA · local first</p></div>
          <div className="pills">
            {mode === 'static' ? (
              <>
                <span className="pill ok">● MiniLM · 384d · in-browser</span>
                <span className="pill">json · {health?.chunks ?? 0} chunks</span>
                <span className="pill">{health?.sources ?? 12} sources</span>
                <span className="pill ok">● {health?.llm_model || 'llm'} · Groq</span>
              </>
            ) : (
              <>
                <span className={`pill ${health?.ollama ? 'ok' : 'no'}`}>
                  ● {health?.embed_model || 'ollama'}
                </span>
                <span className="pill">qdrant · {health?.chunks ?? 0} chunks</span>
                <span className="pill">{health?.sources ?? 12} sources</span>
                <span className={`pill ${health?.groq_key_loaded ? 'ok' : 'no'}`}>● {health?.llm_model || 'llm'}</span>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="wrap">
        <nav>
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        {mode === 'static' ? (
          <div className="note" style={{ marginTop: -6, marginBottom: 18 }}>
            <b>Hosted demo.</b> Chunk vectors were pre-computed at build time, and your query
            is embedded in your browser with MiniLM (384d, ~23MB, downloaded once). Dense
            cosine, BM25 and RRF are recomputed here in JavaScript. Only the answer leaves the
            browser, through a proxy that keeps the Groq key server-side. Run it locally and
            the same UI switches to the full pipeline: Ollama embeddings and a local Qdrant.
          </div>
        ) : (
          <div className="note" style={{ marginTop: -6, marginBottom: 18 }}>
            <b>Local by default.</b> Documents are read, chunked, embedded and indexed on this
            machine — Qdrant runs in-process from a folder, Ollama serves the embeddings at{' '}
            {health?.embed_model_reason || 'auto-picked'}. Only the retrieved chunks reach Groq,
            and only on the Chat tab.
          </div>
        )}
        {dl !== null && (
          <div className="note" style={{ marginTop: -6, marginBottom: 18 }}>
            Downloading the embedding model… {dl}%
          </div>
        )}
        {tab === 'corpus' && (
          <Corpus health={health} sources={sources} ingest={ingest} onIndex={onIndex} busy={busy} err={err} mode={mode} />
        )}
        {tab === 'search' && <Search ready={!!health?.indexed} sources={sources} />}
        {tab === 'chat' && <Chat ready={!!health?.indexed} sources={sources} />}
      </div>
    </>
  );
}
