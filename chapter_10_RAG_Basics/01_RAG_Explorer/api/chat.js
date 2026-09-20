// Vercel serverless: takes the chunks the browser already retrieved and asks Groq.
//
// Retrieval happens client-side in the hosted build (pre-computed vectors + MiniLM in
// the browser), so this function only does generation. It exists at all so GROQ_API_KEY
// stays server-side instead of shipping to every visitor.

const WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const MAX_PER_IP = 20;              // a class can ask plenty; a scraper cannot
const hits = new Map();             // per-instance; good enough to blunt casual abuse

function rateLimit(ip) {
  const now = Date.now();
  const rec = hits.get(ip)?.filter((t) => now - t < WINDOW_MS) ?? [];
  if (rec.length >= MAX_PER_IP) {
    return { ok: false, retryMins: Math.ceil((WINDOW_MS - (now - rec[0])) / 60000) };
  }
  rec.push(now);
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();   // crude cap so memory cannot grow unbounded
  return { ok: true, remaining: MAX_PER_IP - rec.length };
}

const SYSTEM =
  'You answer questions about a Product Requirements Document using ONLY the ' +
  'numbered context chunks provided.\n' +
  'Rules:\n' +
  '- If the chunks do not contain the answer, say so plainly. Do not use outside ' +
  'knowledge and do not guess.\n' +
  '- Cite the chunks you used as [chunk N] inline.\n' +
  '- Be concise and concrete. Quote exact figures and names from the context.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'GROQ_API_KEY is not set on this deployment.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return res.status(429).json({
      error:
        `Rate limit reached (${MAX_PER_IP} questions per hour). This is a teaching demo ` +
        `on a shared API key. Try again in about ${limit.retryMins} minutes, or run it ` +
        `locally where there is no limit.`,
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const query = String(body.query || '').slice(0, 500);
  const chunks = Array.isArray(body.chunks) ? body.chunks.slice(0, 5) : [];
  if (!query || !chunks.length) {
    return res.status(400).json({ error: 'Send { query, chunks: [{index, text}] }.' });
  }

  const context = chunks
    .map((c) => `[chunk ${c.index}]\n${String(c.text).slice(0, 4000)}`)
    .join('\n\n');
  const user = `Context:\n${context}\n\nQuestion: ${query}`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(50000),
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(502).json({ error: `Groq returned ${r.status}`, detail: text.slice(0, 300) });
    }
    const data = JSON.parse(text);
    res.setHeader('x-ratelimit-remaining', String(limit.remaining));
    return res.status(200).json({
      answer: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
      prompt_sent: { system: SYSTEM, user, chars: user.length },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Groq: ' + err.message });
  }
}
