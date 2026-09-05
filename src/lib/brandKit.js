/**
 * Client for /api/brand-kit (server/brandKit/routes.js) — the tenant asset
 * store, the manual and extraction Brand Kit paths, and the confirmation
 * step. Separate module from lib/brandAssets.js on purpose: that one talks
 * to the older, per-user chat-attachment feature, this one to the
 * org-scoped Brand Kit / Document Engine.
 */
import { supabase } from './supabase.js';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again to continue.');
  return { authorization: `Bearer ${token}` };
}

async function readError(res, fallback) {
  try {
    const body = await res.json();
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = await authHeader();
  if (!isForm && body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/brand-kit${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res, 'Request failed.'));
  return res.status === 204 ? null : res.json();
}

// --- Assets ------------------------------------------------------------

export const listBrandKitAssets = (kind) => api(kind ? `/assets?kind=${encodeURIComponent(kind)}` : '/assets');

/** @param {'guideline'|'corporate_profile'|'logo'|'palette'|'font'|'icon_set'|'sample_document'} kind
 *  @param {File[]} files */
export async function uploadBrandKitAssets(kind, files) {
  const form = new FormData();
  form.append('kind', kind);
  for (const file of files) form.append('files', file);
  return api('/assets', { method: 'POST', body: form, isForm: true });
}

export const deleteBrandKitAsset = (id) => api(`/assets/${id}`, { method: 'DELETE' });

export const getAssetDownloadUrl = (id) => api(`/assets/${id}/download-url`);

export const attestFontLicense = (id, { licenseType, embeddingPermitted }) =>
  api(`/assets/${id}/license-attestation`, {
    method: 'POST',
    body: { license_type: licenseType, embedding_permitted: embeddingPermitted },
  });

// --- Kits ----------------------------------------------------------------

export const getActiveBrandKit = () => api('/');

export const listBrandKits = () => api('/drafts');

export const getBrandKitDraft = (id) => api(`/drafts/${id}`);

export const runBrandKitExtraction = () => api('/extract', { method: 'POST' });

export const editBrandKitField = (id, path, value) => api(`/drafts/${id}/fields`, { method: 'PATCH', body: { path, value } });

export const confirmBrandKitField = (id, path) => api(`/drafts/${id}/confirm-field`, { method: 'POST', body: { path } });

export const confirmAllRemainingFields = (id) => api(`/drafts/${id}/confirm-all-remaining`, { method: 'POST' });

export const activateBrandKit = (id) => api(`/drafts/${id}/confirm`, { method: 'POST' });

export const deleteBrandKitDraft = (id) => api(`/drafts/${id}`, { method: 'DELETE' });

export function createManualBrandKit({ name, primaryHex, secondaryHex, layoutStyle, logoAssetIds }) {
  return api('/manual', {
    method: 'POST',
    body: { name, primary_hex: primaryHex, secondary_hex: secondaryHex, layout_style: layoutStyle, logo_asset_ids: logoAssetIds },
  });
}

// --- Documents (Phase 4 — Document Engine) --------------------------------

export const listDocuments = () => api('/documents');

export const getDocument = (id) => api(`/documents/${id}`);

export const getDocumentDownloadUrl = (id) => api(`/documents/${id}/download-url`);
