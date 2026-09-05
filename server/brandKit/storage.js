/**
 * Cloud Storage for the Brand Kit / Document Engine tenant asset store.
 *
 * Deliberately a separate bucket from BLAYNE_UPLOADS_BUCKET (server/
 * uploadStorage.js), not a new prefix in it: that bucket backs the older
 * "attach a file to this chat session" feature (per-user, read by the chat
 * server only). This one is per-organization, read by the extraction
 * pipeline and — starting Phase 3 — the render job, and font bytes here
 * carry a licensing gate the chat-attachment bucket has no equivalent of.
 * Keeping them apart keeps the IAM grants for each narrow and legible
 * instead of one bucket serving two different trust boundaries.
 *
 * Auth is Application Default Credentials, same as every other GCS client
 * in this codebase — no key in the environment.
 */
import { Storage } from '@google-cloud/storage';
import crypto from 'node:crypto';

const BUCKET_NAME = process.env.BLAYNE_BRAND_KIT_BUCKET ?? 'blayne-document-engine';
const ASSET_PREFIX = 'brand-assets/';
// Phase 4's rendered output (the .docx/.pdf a generation job produces) —
// same bucket and org-scoped layout as the asset prefix above, kept as its
// own top-level prefix rather than folded under brand-assets/ since a
// generated document isn't a brand_kit_assets row and nothing in the
// extraction/rendering pipeline should ever list it alongside real assets.
const DOCUMENT_PREFIX = 'documents/';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Random object name per upload, namespaced under the org — never the
 * original filename as a path segment (same reasoning as uploadStorage.js:
 * a filename is attacker-controlled input, not a safe path component).
 */
function objectName(orgId, fileName) {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return `${ASSET_PREFIX}${orgId}/${crypto.randomUUID()}${ext}`;
}

export async function storeBrandKitAsset(orgId, buffer, fileName) {
  const storagePath = objectName(orgId, fileName);
  await bucket.file(storagePath).save(buffer, { resumable: false });
  return storagePath;
}

export async function readBrandKitAsset(storagePath) {
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

export async function deleteBrandKitAsset(storagePath) {
  try {
    await bucket.file(storagePath).delete();
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/**
 * A stored derived file (e.g. a font converted to TTF/OTF for the render
 * container, or a rasterized guideline page) that isn't itself a row in
 * brand_kit_assets — stored under the same org prefix so it inherits the
 * same bucket-level IAM boundary, distinguished by a sub-prefix instead.
 */
export async function storeDerivedAsset(orgId, buffer, subPath) {
  const storagePath = `${ASSET_PREFIX}${orgId}/derived/${subPath}`;
  await bucket.file(storagePath).save(buffer, { resumable: false });
  return storagePath;
}

/** A finished generation job's rendered file (Phase 4) — org-scoped like
 * every other write in this module, named by the job so a re-render of the
 * same document row never collides with the one it's replacing. */
export async function storeGeneratedDocument(orgId, buffer, documentId, format) {
  const storagePath = `${DOCUMENT_PREFIX}${orgId}/${documentId}.${format}`;
  await bucket.file(storagePath).save(buffer, { resumable: false });
  return storagePath;
}

/**
 * A short-lived, tenant-scoped download link — see Phase 7's "never a
 * public object." Every storagePath this function is ever called with must
 * already have been verified (by the caller) to live under this org's own
 * prefix; this function does not re-check the org boundary itself, since by
 * the time a caller has a storagePath in hand it came from a brand_kit_assets
 * row already filtered by org_id (RLS or an explicit .eq('org_id', ...)).
 */
export async function getSignedReadUrl(storagePath, { expiresInMs = 10 * 60 * 1000 } = {}) {
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMs,
  });
  return url;
}

/** Asserts a storagePath actually belongs to the given org's prefix — the
 * cross-tenant-access guard every asset read should run through before
 * trusting a storage_path pulled from anywhere other than a fresh,
 * org-filtered database query (defense in depth, not the only check). */
export function assertOwnedByOrg(storagePath, orgId) {
  const expectedPrefixes = [`${ASSET_PREFIX}${orgId}/`, `${DOCUMENT_PREFIX}${orgId}/`];
  if (!expectedPrefixes.some((prefix) => storagePath.startsWith(prefix))) {
    throw new Error(`Refusing cross-tenant asset access: "${storagePath}" is not under org ${orgId}.`);
  }
}
