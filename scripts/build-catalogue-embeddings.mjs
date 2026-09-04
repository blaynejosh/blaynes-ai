/**
 * Precomputes an embedding vector for every service in
 * catalogue/blaynes-services.json and writes
 * catalogue/blaynes-services.embeddings.json (service id -> vector).
 *
 *   npm run catalogue:embeddings
 *
 * Run this after any edit to catalogue/blaynes-services.json, before
 * `npm run catalogue:upload` — it's a build-time step, not a request-time
 * one: 30 rows never need re-embedding on the request path (see
 * server/catalogue/embeddings.js and search.js). Needs
 * ANTHROPIC_VERTEX_PROJECT_ID and Application Default Credentials, same as
 * everything else that talks to GCP in this repo.
 *
 * Embedded text is name + description + outcome + aliases joined — matching
 * what the spec calls for the embedding layer to cover, so semantic search
 * can find a service from a paraphrase even when no alias literally matches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDocuments } from '../server/catalogue/embeddings.js';
import { validateCatalogue } from '../server/catalogue/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_PATH = path.join(root, 'catalogue', 'blaynes-services.json');
const OUT_PATH = path.join(root, 'catalogue', 'blaynes-services.embeddings.json');

const catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
validateCatalogue(catalogue);

const services = catalogue.categories.flatMap((c) => c.services);
const texts = services.map(
  (s) => `${s.name}. ${s.description} ${s.outcome} ${s.aliases.join('. ')}`,
);

console.log(`Embedding ${services.length} services via Vertex AI...`);
const vectors = await embedDocuments(texts);

const out = {};
services.forEach((s, i) => {
  out[s.id] = vectors[i];
});

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`Wrote ${OUT_PATH} (${services.length} vectors, dim ${vectors[0]?.length ?? 0}).`);
console.log('Next: npm run catalogue:upload');
