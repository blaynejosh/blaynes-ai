/**
 * Client for /api/brand-assets (server/index.js).
 *
 * Files a tester shares — brand manual, deck, logo — are uploaded once and
 * reused on every chat request afterwards, server-side; this module only
 * handles the account-management side (list, add, remove).
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

export async function listBrandAssets() {
  const res = await fetch('/api/brand-assets', { headers: await authHeader() });
  if (!res.ok) throw new Error(await readError(res, 'Could not load your brand materials.'));
  return res.json();
}

/** @param {File[]} files */
export async function uploadBrandAssets(files) {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  const res = await fetch('/api/brand-assets', {
    method: 'POST',
    // No content-type here — the browser sets the multipart boundary itself.
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res, 'Upload failed.'));
  return res.json();
}

export async function deleteBrandAsset(id) {
  const res = await fetch(`/api/brand-assets/${id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Could not remove that file.'));
}
