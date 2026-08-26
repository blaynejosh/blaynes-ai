/**
 * Uploads the Blayne skill set (local Markdown files) to the GCS bucket the
 * chat server reads from at request time — see server/skillStorage.js.
 *
 *   npm run skills:upload            upload every .md in blayne_skills/
 *   npm run skills:upload -- --only blayne-methodology
 *   npm run skills:list              list what's currently in the bucket
 *
 * Source files live in blayne_skills/<name>.md, gitignored — skill content is
 * data, not code, the same way brand assets are. Re-run after editing a
 * skill; the bucket object is overwritten immediately, there's no versioning
 * like the old Anthropic Skills API had.
 */
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(root, 'blayne_skills');
const BUCKET_NAME = process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip';
const PREFIX = 'blayne_skills/';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

if (args.includes('--list')) {
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  if (!files.length) console.log(`No skills in gs://${BUCKET_NAME}/${PREFIX}`);
  for (const file of files) {
    const name = path.basename(file.name, '.md');
    console.log(`${name.padEnd(36)} ${file.metadata.size} bytes  updated ${file.metadata.updated}`);
  }
  process.exit(0);
}

if (!fs.existsSync(SKILLS_DIR)) {
  console.error(`Skills directory not found: ${SKILLS_DIR}`);
  process.exit(1);
}

const names = only
  ? [only]
  : fs
      .readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3));

let uploaded = 0;

for (const name of names) {
  const localPath = path.join(SKILLS_DIR, `${name}.md`);
  if (!fs.existsSync(localPath)) {
    console.warn(`  skip  ${name.padEnd(34)} no ${name}.md in blayne_skills/`);
    continue;
  }

  try {
    await bucket.upload(localPath, {
      destination: `${PREFIX}${name}.md`,
      contentType: 'text/markdown',
    });
    console.log(`  put   ${name.padEnd(34)} -> gs://${BUCKET_NAME}/${PREFIX}${name}.md`);
    uploaded += 1;
  } catch (err) {
    console.error(`  FAIL  ${name.padEnd(34)} ${err?.message ?? err}`);
  }
}

console.log(`\n${uploaded} uploaded to gs://${BUCKET_NAME}/${PREFIX}`);
