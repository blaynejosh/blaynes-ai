/**
 * Acceptance criterion: "No catalogue string, policy string or routing
 * logic is reachable from the browser. Verified by a test, not by
 * inspection." Runs after `npm run build` (see the `build` script in
 * package.json) against the built dist/ output — the only thing that
 * actually ships to a browser, as opposed to source files that merely sit
 * in the repo.
 *
 * Checks every service name and every alias from catalogue/blaynes-services.json
 * against every text asset in dist/. A hit means catalogue data reached the
 * client bundle — almost certainly because something imported the catalogue
 * JSON (or a skill/prompt string that quotes it) into client-side code
 * instead of keeping it server-only. Fails the build; this is not a warning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(root, 'dist');
const CATALOGUE_PATH = path.join(root, 'catalogue', 'blaynes-services.json');
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.txt', '.map']);

if (!fs.existsSync(DIST_DIR)) {
  console.error(`dist/ not found at ${DIST_DIR} — run \`npm run build\` first.`);
  process.exit(1);
}

const catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));

/** Distinctive strings only — short/common words would false-positive against ordinary marketing copy. */
const needles = [];
for (const category of catalogue.categories) {
  needles.push(category.name);
  for (const service of category.services) {
    needles.push(service.name);
    for (const alias of service.aliases) {
      if (alias.length >= 12) needles.push(alias); // skip short, generic aliases prone to coincidental matches
    }
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = walk(DIST_DIR);
const hits = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const needle of needles) {
    if (content.includes(needle)) {
      hits.push({ file: path.relative(root, file), needle });
    }
  }
}

if (hits.length) {
  console.error(`FAIL: catalogue content found in the client bundle (${hits.length} hit(s)):`);
  for (const hit of hits.slice(0, 20)) {
    console.error(`  "${hit.needle}" in ${hit.file}`);
  }
  if (hits.length > 20) console.error(`  ...and ${hits.length - 20} more.`);
  console.error('\nThe catalogue must stay server-only — see server/catalogue/loader.js. Find what imported it into client code and remove that import.');
  process.exit(1);
}

console.log(`OK: no catalogue strings found in dist/ (checked ${files.length} files against ${needles.length} needles).`);
