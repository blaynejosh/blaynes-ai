/**
 * User-uploaded documents ("brand assets"), persisted in Google Cloud
 * Storage.
 *
 * Claude on Vertex AI has no Files API and no code-execution container (see
 * the comment above ALLOWED_BRAND_MIME_TYPES in server/index.js) — the
 * inline `document`/`image` content blocks it does support need the raw
 * bytes resent on every request, so GCS is the source of truth for the
 * bytes themselves; Postgres (brand_assets.storage_path) only holds the
 * pointer.
 *
 * Auth is Application Default Credentials, same as server/skillStorage.js
 * (gcloud auth application-default login locally; the runtime service
 * account on Cloud Run/GCE).
 */
import { Storage } from '@google-cloud/storage';
import crypto from 'node:crypto';

const BUCKET_NAME = process.env.BLAYNE_UPLOADS_BUCKET ?? 'blayne-user-uploads';
const PREFIX = 'brand_assets/';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

/** Random object name per upload — never trust the original filename as a path segment. */
function objectName(userId, fileName) {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return `${PREFIX}${userId}/${crypto.randomUUID()}${ext}`;
}

export async function storeUserFile(userId, buffer, fileName) {
  const storagePath = objectName(userId, fileName);
  await bucket.file(storagePath).save(buffer, { resumable: false });
  return storagePath;
}

/**
 * In-memory cache of downloaded bytes, keyed by storage path. The full
 * conversation — and every attached document with it — is resent on every
 * /api/chat turn (see server/index.js), so without this a session re-reads
 * the same file from GCS once per message. Same lifetime/eviction trade-off
 * as the skill-text cache in skillStorage.js: lives for the process, cleared
 * per-object on delete.
 */
const cache = new Map();

export async function readUserFile(storagePath) {
  if (cache.has(storagePath)) return cache.get(storagePath);
  const [buffer] = await bucket.file(storagePath).download();
  cache.set(storagePath, buffer);
  return buffer;
}

export async function deleteUserFile(storagePath) {
  cache.delete(storagePath);
  try {
    await bucket.file(storagePath).delete();
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}
