/* Thin client for the FastAPI backend. Vite proxies /api to http://127.0.0.1:8101. */

const json = async (url, body) => {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
  return d;
};

export const api = {
  health: () => json('/api/health'),
  sources: () => json('/api/sources'),
  models: () => json('/api/models'),
  ingest: (body) => json('/api/ingest', body),
  search: (body) => json('/api/search', body),
  chat: (body) => json('/api/chat', body),
  chunks: (source) => json('/api/chunks' + (source ? `?source=${encodeURIComponent(source)}` : '')),
};
