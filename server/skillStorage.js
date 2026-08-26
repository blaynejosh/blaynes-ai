/**
 * Blayne skill content, hosted in Google Cloud Storage.
 *
 * Skills are consulting playbooks in plain Markdown, one file per skill at
 * gs://<bucket>/blayne_skills/<name>.md. `npm run skills:upload` pushes the
 * local blayne_skills/ directory there — see scripts/upload-skills.mjs.
 *
 * Auth is Application Default Credentials (gcloud auth application-default
 * login locally; the runtime service account on Cloud Run/GCE). No key is
 * read from process.env — the Storage() constructor resolves it itself.
 *
 * Fetched lazily and cached in memory for the life of the process: these
 * files change only when someone re-runs the upload script, so there's no
 * reason to hit GCS on every chat request.
 */
import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip';
const PREFIX = 'blayne_skills/';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

export async function getSystemInstruction(skillName) {
  try {
    const file = bucket.file(`${PREFIX}${skillName}.md`);
    const [content] = await file.download();
    return content.toString('utf-8');
  } catch (error) {
    console.error(`Failed to load skill: ${skillName}`, error);
    throw error;
  }
}

const cache = new Map();

/**
 * Fetches a set of skills in parallel, caching each after its first
 * successful load. A skill that fails (not uploaded yet, bucket
 * unreachable, missing GCP credentials) is dropped with a warning rather
 * than failing the request — the chat still runs on the base identity
 * prompt plus whatever skills did load.
 */
export async function loadSkills(names) {
  const results = await Promise.all(
    names.map(async (name) => {
      if (cache.has(name)) return cache.get(name);
      try {
        const content = await getSystemInstruction(name);
        const entry = { name, content };
        cache.set(name, entry);
        return entry;
      } catch {
        return null; // getSystemInstruction already logged the error
      }
    }),
  );
  return results.filter(Boolean);
}
