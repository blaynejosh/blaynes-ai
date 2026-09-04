/**
 * Uploads the reviewed service catalogue (catalogue/blaynes-services.json)
 * and its precomputed embeddings (catalogue/blaynes-services.embeddings.json,
 * see build-catalogue-embeddings.mjs) to the GCS bucket the chat server reads
 * from at boot — see server/catalogue/loader.js.
 *
 *   npm run catalogue:upload
 *
 * Unlike blayne_skills/ (gitignored — content edited freely, no review
 * step), catalogue/blaynes-services.json IS committed: the catalogue is a
 * reviewed change (bump `version`, update `last_verified`), not an
 * incidental edit. This script is what publishes an already-reviewed file,
 * not a shortcut around review.
 *
 * Run `npm run catalogue:embeddings` first (or this uploads a stale
 * embeddings file, or none if it's never been generated locally).
 */
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalogue } from '../server/catalogue/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_PATH = path.join(root, 'catalogue', 'blaynes-services.json');
const EMBEDDINGS_PATH = path.join(root, 'catalogue', 'blaynes-services.embeddings.json');
const BUCKET_NAME = process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip';
const PREFIX = 'catalogue/';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

if (!fs.existsSync(CATALOGUE_PATH)) {
  console.error(`Catalogue not found: ${CATALOGUE_PATH}`);
  process.exit(1);
}

const catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
try {
  validateCatalogue(catalogue);
} catch (err) {
  console.error(`Refusing to upload an invalid catalogue: ${err.message}`);
  process.exit(1);
}

await bucket.upload(CATALOGUE_PATH, {
  destination: `${PREFIX}blaynes-services.json`,
  contentType: 'application/json',
});
console.log(`  put   blaynes-services.json -> gs://${BUCKET_NAME}/${PREFIX}blaynes-services.json  (v${catalogue.version})`);

if (fs.existsSync(EMBEDDINGS_PATH)) {
  await bucket.upload(EMBEDDINGS_PATH, {
    destination: `${PREFIX}blaynes-services.embeddings.json`,
    contentType: 'application/json',
  });
  console.log(`  put   blaynes-services.embeddings.json -> gs://${BUCKET_NAME}/${PREFIX}blaynes-services.embeddings.json`);
} else {
  console.warn(`  skip  no local embeddings file — run \`npm run catalogue:embeddings\` first, or matching stays lexical-only.`);
}
