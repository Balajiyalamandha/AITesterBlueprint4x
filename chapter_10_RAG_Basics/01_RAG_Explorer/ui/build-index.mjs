/* Pre-compute chunk embeddings for the deployed build.
 *
 * Vercel cannot reach the local Ollama, so the hosted demo uses a model that runs in
 * the browser (MiniLM, 384d, ~23MB, cached after first load). Chunk vectors are baked
 * here at build time with the SAME model, so queries and chunks share a vector space.
 * The local dev server still uses nomic-embed-text at 768d. */
import { pipeline } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const src = JSON.parse(readFileSync('../scripts/chunks.json', 'utf8'));

console.log(`loading ${MODEL}…`);
const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

const round = (v) => Math.round(v * 1e4) / 1e4;   // 4dp keeps the file small
let total = 0;

for (const cfg of src.configs) {
  const texts = cfg.chunks.map((c) => c.text);
  const out = await embed(texts, { pooling: 'mean', normalize: true });
  const [n, dims] = out.dims;
  const flat = Array.from(out.data);
  cfg.dims = dims;
  cfg.chunks.forEach((c, i) => {
    c.vector = flat.slice(i * dims, (i + 1) * dims).map(round);
  });
  total += n;
  console.log(`  ${cfg.chunk_size}w/${cfg.overlap} -> ${n} chunks x ${dims}d`);
}

src.embed_model = MODEL;
src.dims = src.configs[0].dims;
writeFileSync('public/index.json', JSON.stringify(src));

const mb = (Buffer.byteLength(JSON.stringify(src)) / 1e6).toFixed(2);
console.log(`wrote ui/public/index.json — ${total} vectors, ${mb} MB`);
