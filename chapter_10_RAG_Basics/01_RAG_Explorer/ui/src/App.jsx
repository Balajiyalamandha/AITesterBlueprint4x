import React, { useEffect, useState } from 'react';
import { detectMode, liveEngine, staticEngine } from './engine.js';

// One module-level holder so every tab talks to the same engine and the same
// pre-loaded chunk config, without threading props through everything.
const RUN = { engine: liveEngine, mode: 'live', cfg: null, onProgress: null };


/* Tiny markdown-lite renderer. The model returns **bold**, bullets and [chunk N]
   citations; rather than pull in a markdown dependency for three constructs, we
   render those directly - and turn the citations into badges so you can see at a
   glance which retrieved chunk each claim came from. */
function Rich({ text }) {
  const cite = /(\[chunk\s*\d+\]|\u3010chunk\s*\d+\u3011)/gi;
  const bold = /\*\*(.+?)\*\*/g;

  const inline = (s, keyBase) =>
    s.split(cite).map((part, i) => {
      if (cite.test(part)) {
        cite.lastIndex = 0;
        const n = part.match(/\d+/)?.[0];
        return <span className="cite" key={`${keyBase}-c${i}`}>chunk {n}</span>;
      }
      const bits = [];
      let last = 0, m;
      bold.lastIndex = 0;
      while ((m = bold.exec(part))) {
        if (m.index > last) bits.push(part.slice(last, m.index));
        bits.push(<b key={`${keyBase}-b${i}-${m.index}`}>{m[1]}</b>);
        last = m.index + m[0].length;
      }
      if (last < part.length) bits.push(part.slice(last));
      return <React.Fragment key={`${keyBase}-t${i}`}>{bits}</React.Fragment>;
    });

  return (
    <div className="rich">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div style={{ height: 8 }} key={i} />;
        const li = t.match(/^[*\-\u2022]\s+(.*)$/);
        if (li) return <div className="li" key={i}><span className="dot" />{inline(li[1], i)}</div>;
        return <p key={i}>{inline(t, i)}</p>;
      })}
    </div>
  );
}

const SAMPLES = [
  'What are the security requirements?',
  'How does single sign-on work?',
  'What are the performance targets?',
  'What is out of scope for this release?',
];

/* ------------------------------------------------------------------ Ingest */
function Ingest({ data, setData }) {
  const [size, setSize] = useState(180);
  const [overlap, setOverlap] = useState(40);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const d = await RUN.engine.ingest({ chunk_size: size, overlap }, RUN.onProgress);
      RUN.cfg = d._cfg || null;
      setData(d);
      if (d.config) { setSize(d.config.chunk_size); setOverlap(d.config.overlap); }
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const d = data?.doc, t = data?.timings;

  return (
    <>
      <h2>1 · Ingest the PDF</h2>
      <p className="sub">
        Five stages turn a PDF into something searchable. Change the chunk settings and
        re-run to watch the trade-off move.
      </p>

      <div className="pipe">
        {[
          ['Extract', RUN.mode === 'static' ? 'pypdf · at build time' : 'pypdf · per page'],
          ['Normalise', 'repair the text'],
          ['Chunk', `${size}w / ${overlap} overlap`],
          ['Embed', RUN.mode === 'static' ? 'MiniLM · 384d · browser' : 'nomic · 768d · Ollama'],
          ['Store', RUN.mode === 'static' ? 'JSON · cosine in JS' : 'Chroma · cosine'],
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
            <input type="range" min="60" max="400" step="20" value={size}
              onChange={(e) => setSize(+e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="fld">Overlap: <b>{overlap}</b> words ({Math.round(overlap / size * 100)}%)</label>
            <input type="range" min="0" max={size - 20} step="10" value={overlap}
              onChange={(e) => setOverlap(+e.target.value)} disabled={busy} />
          </div>
        </div>
        {RUN.mode === 'static' && (
          <p className="sub" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
            Six chunk configurations were pre-computed, so the slider snaps to the nearest one.
          </p>
        )}
        <button className="go" style={{ marginTop: 13 }} onClick={run} disabled={busy}>
          {busy ? <><span className="spin" /> Ingesting…</> : data ? 'Re-ingest' : 'Ingest PDF'}
        </button>
        {err && <div className="err" style={{ marginTop: 11 }}>{err}</div>}
      </div>

      {d && (
        <>
          <div className="grid g4" style={{ marginTop: 16 }}>
            <div className="stat"><div className="n">{d.pages}</div><div className="l">pages</div></div>
            <div className="stat"><div className="n">{d.words.toLocaleString()}</div><div className="l">words</div></div>
            <div className="stat"><div className="n">{data.chunk_count}</div><div className="l">chunks</div></div>
            <div className="stat"><div className="n">{data.vector_dims}</div><div className="l">dimensions</div></div>
            <div className="stat">
              {t.prebuilt
                ? <><div className="n" style={{ fontSize: 15 }}>pre-built</div><div className="l">vectors</div></>
                : <><div className="n">{t.embed_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">embed time</div></>}
            </div>
          </div>

          <h2>The step everyone skips</h2>
          <p className="sub">
            This PDF came out of Google Docs, and pypdf emits <b>one word per line</b>.
            Chunk that as-is and every chunk is unreadable, so the embeddings are junk.
            Normalising first recovered {(d.raw_chars - d.clean_chars).toLocaleString()} characters of noise.
          </p>
          <div className="grid g2">
            <div className="card">
              <span className="tag bad">raw · {d.raw_chars.toLocaleString()} chars</span>
              <pre className="box">{JSON.stringify(d.raw_sample).slice(1, -1)}</pre>
            </div>
            <div className="card">
              <span className="tag good">normalised · {d.clean_chars.toLocaleString()} chars</span>
              <pre className="box">{d.clean_sample}</pre>
            </div>
          </div>

          <h2>{data.chunk_count} chunks</h2>
          <p className="sub">
            Each chunk is a {size}-word window that slides forward {data.config.step} words,
            so neighbours share {overlap} words. Each carries its own 768-number vector.
          </p>
          {data.chunks.map((c) => (
            <div className="chunk" key={c.id}>
              <div className="top">
                <span className="cid">{c.id}</span>
                <span className="meta">words {c.word_start}–{c.word_end} · {c.char_count} chars</span>
              </div>
              <p>{c.text}</p>
              <div className="vec">
                vector[{c.vector_dims}] = [{c.vector_preview.join(', ')}, … +{c.vector_dims - 8} more]
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Search */
function Hits({ res }) {
  return res.hits.map((h, i) => (
    <div className={`hit${i === 0 ? ' top1' : ''}`} key={h.id}>
      <div className="top" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="rank">{i + 1}</span>
        <span className="cid">{h.id}</span>
        <span className="meta">similarity <b>{h.percent}%</b> · distance {h.distance} · {h.words} words</span>
      </div>
      <div className="bar"><i style={{ width: `${Math.max(h.percent, 2)}%` }} /></div>
      <p style={{ fontSize: 13.5, margin: 0 }}>{h.text}</p>
    </div>
  ));
}

function ServerWeights({ res }) {
  const v = res.query_vector;
  return (
    <details open>
      <summary>Server side · what the vector search actually did</summary>
      <div className="card" style={{ marginTop: 9 }}>
        <div className="grid g4">
          <div className="stat"><div className="n">{v.dims}</div><div className="l">query dims</div></div>
          <div className="stat"><div className="n">{v.l2_norm}</div><div className="l">L2 norm</div></div>
          <div className="stat"><div className="n">{res.searched_chunks}</div><div className="l">chunks scanned</div></div>
          <div className="stat"><div className="n">{res.timings.embed_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">embed</div></div>
          <div className="stat"><div className="n">{res.timings.vector_search_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">search</div></div>
        </div>
        <div className="vec" style={{ marginTop: 11 }}>
          query_vector = [{v.preview.join(', ')}, … +{v.dims - v.preview.length} more]  ·  range [{v.min}, {v.max}]
        </div>
        <div className="note">
          The query becomes a 768-number vector, then Chroma compares it against all{' '}
          {res.searched_chunks} chunk vectors by cosine distance and returns the closest.
          <b> similarity = 1 − distance</b>. No keyword matching happens anywhere: "sign in"
          can match "authentication" because the vectors are near each other in meaning.
        </div>
      </div>
    </details>
  );
}

function Search({ ready }) {
  const [q, setQ] = useState(SAMPLES[0]);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(e) {
    e?.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr(null);
    try { setRes(await RUN.engine.search({ query: q, k: 3, cfg: RUN.cfg }, RUN.onProgress)); }
    catch (e2) { setErr(e2.message); setRes(null); }
    finally { setBusy(false); }
  }

  if (!ready) return <p className="sub" style={{ marginTop: 24 }}>Ingest the PDF first.</p>;

  return (
    <>
      <h2>2 · Retrieval only</h2>
      <p className="sub">No LLM here at all. Just: embed the question, compare vectors, return the top 3.</p>
      <form className="row" onSubmit={run}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="Ask about the PRD…" />
        <button className="go" disabled={busy || !q.trim()}>{busy ? <span className="spin" /> : 'Search'}</button>
      </form>
      <div className="chips">
        {SAMPLES.map((s) => <button className="ghost" key={s} onClick={() => setQ(s)}>{s}</button>)}
      </div>
      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      {res && (
        <>
          <h2>Top 3 chunks</h2>
          <Hits res={res} />
          <ServerWeights res={res} />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- Chat */
function Chat({ ready }) {
  const [q, setQ] = useState('What are the security requirements?');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(e) {
    e?.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr(null);
    try { setRes(await RUN.engine.chat({ query: q, k: 3, cfg: RUN.cfg }, RUN.onProgress)); }
    catch (e2) { setErr(e2.message); setRes(null); }
    finally { setBusy(false); }
  }

  if (!ready) return <p className="sub" style={{ marginTop: 24 }}>Ingest the PDF first.</p>;

  return (
    <>
      <h2>3 · Retrieval + generation</h2>
      <p className="sub">
        Same retrieval as tab 2, then the 3 chunks are pasted into a prompt and sent to
        gpt-oss-120b on Groq. The model is told to answer only from those chunks.
      </p>
      <form className="row" onSubmit={run}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="Ask a question…" />
        <button className="go" disabled={busy || !q.trim()}>{busy ? <><span className="spin" /> Thinking…</> : 'Ask'}</button>
      </form>
      <div className="chips">
        {SAMPLES.map((s) => <button className="ghost" key={s} onClick={() => setQ(s)}>{s}</button>)}
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
            <div className="stat"><div className="n">{res.timings.vector_search_ms}<small style={{ fontSize: 12 }}>ms</small></div><div className="l">search</div></div>
          </div>

          <h2>The 3 chunks it was given</h2>
          <Hits res={res} />
          <ServerWeights res={res} />

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

/* --------------------------------------------------------------------- App */
export default function App() {
  const [tab, setTab] = useState('ingest');
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(null);
  const [mode, setMode] = useState(null);
  const [dl, setDl] = useState(null);

  useEffect(() => {
    RUN.onProgress = (pct) => setDl(pct >= 100 ? null : pct);
    detectMode().then(({ mode: m, health: h }) => {
      RUN.engine = m === 'live' ? liveEngine : staticEngine;
      RUN.mode = m;
      setMode(m);
      setHealth(h);
    });
  }, []);

  const tabs = [['ingest', '1 · Ingest & Chunks'], ['search', '2 · Search'], ['chat', '3 · Chat']];

  return (
    <>
      <header>
        <div className="hd">
          <div className="logo">🔎</div>
          <div><h1>RAG Explorer</h1><p>PDF → chunks → vectors → answers</p></div>
          <div className="pills">
            {mode === 'live' ? (
              <>
                <span className={`pill ${health?.ollama ? 'ok' : 'no'}`}>
                  ● {health?.embed_model || 'ollama'} · 768d
                </span>
                <span className="pill">chroma</span>
              </>
            ) : mode === 'static' ? (
              <span className="pill ok">● MiniLM · 384d · in-browser</span>
            ) : (
              <span className="pill">connecting…</span>
            )}
            <span className="pill ok">● gpt-oss-120b</span>
          </div>
        </div>
      </header>
      <div className="wrap">
        <nav>
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        {mode === 'static' && (
          <div className="note" style={{ marginTop: -6, marginBottom: 18 }}>
            <b>Hosted demo.</b> Chunk vectors were pre-computed at build time, and your
            query is embedded in your browser with MiniLM (384d, ~23MB, downloaded once).
            Run it locally and the same UI switches to the full pipeline: pypdf, Ollama
            nomic-embed-text at 768d, and ChromaDB. Chat goes to gpt-oss-120b either way.
          </div>
        )}
        {dl !== null && (
          <div className="note" style={{ marginTop: -6, marginBottom: 18 }}>
            Downloading the embedding model… {dl}%
          </div>
        )}
        {tab === 'ingest' && <Ingest data={data} setData={setData} />}
        {tab === 'search' && <Search ready={!!data} />}
        {tab === 'chat' && <Chat ready={!!data} />}
      </div>
    </>
  );
}
