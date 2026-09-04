/**
 * Loads Blayne's Consulting's service catalogue — the data behind the
 * service-routing layer (see server/catalogue/search.js and the
 * service_routing skill). Never sent to the client: server/index.js only
 * ever forwards the *result* of a search, never this data itself.
 *
 * Deliberately NOT the same loading pattern as server/skillStorage.js. Skills
 * are soft-fail (a missing skill degrades to "answer without it" — see
 * loadSkills there) because the base identity prompt still produces a usable
 * answer without any of them. The catalogue has no such fallback: routing on
 * a partially-loaded or malformed catalogue risks exactly what the spec
 * calls out — recommending a service that doesn't exist, or silently
 * recommending nothing when something is genuinely in scope. So this loader
 * is eager (fetched once at boot, not lazily on first request) and hard-fail
 * (a bad catalogue stops the process rather than serving a broken one) —
 * call initCatalogue() once during server startup and let it throw.
 *
 * Storage: GCS, same bucket as the skill set (BLAYNE_SKILLS_BUCKET), under
 * its own catalogue/ prefix rather than blayne_skills/ — same bucket so no
 * new IAM grant is needed (the runtime SA already has objectViewer there),
 * different prefix so it's a clearly separate concern. Uploaded by
 * `npm run catalogue:upload` (scripts/upload-catalogue.mjs), mirroring
 * `npm run skills:upload`.
 *
 * Embeddings (catalogue/blaynes-services.embeddings.json — precomputed by
 * scripts/build-catalogue-embeddings.mjs) are an enhancement, not a hard
 * dependency: if they're missing or incomplete, matching falls back to
 * lexical-only rather than failing boot. A missing catalogue is a broken
 * feature; a missing embedding vector is a degraded one.
 */
import { Storage } from '@google-cloud/storage';
import { validateCatalogue } from './schema.js';

const BUCKET_NAME = process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip';
const PREFIX = 'catalogue/';
const CATALOGUE_OBJECT = `${PREFIX}blaynes-services.json`;
const EMBEDDINGS_OBJECT = `${PREFIX}blaynes-services.embeddings.json`;

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

/** Populated by initCatalogue(); every other export reads from this. */
let index = null;

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Flattens categories/services into lookup structures the search tool
 * actually wants: a by-id map, a flat list carrying each service's category
 * alongside it, and every service's aliases pre-normalized.
 */
function buildIndex(catalogue, embeddings) {
  const services = [];
  const byId = new Map();

  for (const category of catalogue.categories) {
    for (const service of category.services) {
      const entry = {
        id: service.id,
        name: service.name,
        description: service.description,
        outcome: service.outcome,
        aliases: service.aliases,
        categoryId: category.id,
        categoryName: category.name,
        categoryScope: category.scope,
        normalizedName: normalize(service.name),
        normalizedAliases: service.aliases.map(normalize),
        embedding: embeddings?.[service.id] ?? null,
      };
      services.push(entry);
      byId.set(service.id, entry);
    }
  }

  const missingEmbeddings = services.filter((s) => !s.embedding).map((s) => s.id);
  if (embeddings && missingEmbeddings.length) {
    console.warn(
      `[blayne] catalogue embeddings missing for: ${missingEmbeddings.join(', ')} — those services fall back to lexical-only matching.`,
    );
  }

  return {
    version: catalogue.version,
    sourceUrl: catalogue.source_url,
    lastVerified: catalogue.last_verified,
    services,
    byId,
    hasEmbeddings: Boolean(embeddings),
  };
}

async function downloadJson(objectName) {
  const [buffer] = await bucket.file(objectName).download();
  return JSON.parse(buffer.toString('utf-8'));
}

/**
 * Call once at boot. Throws on any problem — missing object, invalid JSON,
 * or a catalogue that fails validateCatalogue() — so the caller can log it
 * and exit rather than start serving on broken data.
 */
export async function initCatalogue() {
  let catalogue;
  try {
    catalogue = await downloadJson(CATALOGUE_OBJECT);
  } catch (err) {
    throw new Error(
      `Could not load the service catalogue from gs://${BUCKET_NAME}/${CATALOGUE_OBJECT}: ${err.message}`,
    );
  }

  validateCatalogue(catalogue);

  const ageDays = (Date.now() - Date.parse(catalogue.last_verified)) / 86_400_000;
  if (ageDays > 45) {
    console.warn(
      `[blayne] catalogue last_verified is ${Math.floor(ageDays)} days old (>45) — it may be stale. Re-run the freshness check (scripts/check-catalogue-freshness.mjs).`,
    );
  }

  let embeddings = null;
  try {
    embeddings = await downloadJson(EMBEDDINGS_OBJECT);
  } catch (err) {
    console.warn(
      `[blayne] catalogue embeddings not loaded (${err.message}) — falling back to lexical-only matching. Run \`npm run catalogue:embeddings\` and \`npm run catalogue:upload\`.`,
    );
  }

  index = buildIndex(catalogue, embeddings);
  console.log(
    `[blayne] catalogue loaded: ${index.services.length} services across ${catalogue.categories.length} categories (v${index.version}, verified ${index.lastVerified}, embeddings ${index.hasEmbeddings ? 'on' : 'OFF'})`,
  );
  return index;
}

/** Everything else in the routing layer reads the catalogue through this. */
export function getCatalogueIndex() {
  if (!index) {
    throw new Error('Catalogue not loaded — initCatalogue() must be awaited before the server starts accepting requests.');
  }
  return index;
}

// Exported for the eval suite (test/) — it builds a catalogue index directly
// from the local catalogue/blaynes-services.json, without a GCS round trip,
// so matching logic is testable in CI without live GCP credentials.
export { normalize, buildIndex };
