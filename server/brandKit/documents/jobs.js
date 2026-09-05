/**
 * Phase 4's job runner. A real generation is minutes, not the seconds a
 * render-preview call takes (see routes.js's /render-preview doc comment),
 * so it cannot run inside the HTTP request/response cycle the way that
 * endpoint deliberately does. enqueueDocument() only ever writes a
 * 'queued' row and returns immediately; processDocument() does the actual
 * work (assemble -> render -> store) and is kicked off fire-and-forget in
 * the same process right after.
 *
 * This is deliberately NOT yet the "Cloud Run Jobs + Cloud Tasks" dispatch
 * that Dockerfile.render and render/index.js call out as still undecided —
 * an in-process async function is enough to prove the pipeline end to end
 * on a single running instance, and to make GET /api/brand-kit/documents/:id
 * a real polling endpoint today. Swapping the dispatch later (enqueue ->
 * Cloud Tasks -> a Cloud Run Job that calls processDocument) doesn't change
 * this module's contract, only what calls processDocument and when — and
 * only matters once a real multi-instance deployment needs a job to survive
 * the instance that enqueued it restarting mid-render.
 */
import { supabaseAdmin } from '../../supabaseAdmin.js';
import { getBrandKitById } from '../manualKit.js';
import { listBrandKitAssets } from '../ingest.js';
import { renderDocument } from '../render/index.js';
import { storeGeneratedDocument } from '../storage.js';
import { assembleDocumentIr } from './assembleIr.js';

async function updateDocument(id, fields) {
  const { error } = await supabaseAdmin.from('documents').update(fields).eq('id', id);
  if (error) console.error(`[blayne] failed to update document ${id}:`, error.message);
}

/** The actual generate -> render -> store pipeline for one job. Never
 * throws — every failure is recorded on the row itself (status 'failed',
 * error message) rather than propagated, since by the time this runs its
 * caller has already responded to whoever triggered it. */
async function processDocument(id) {
  const { data: doc, error } = await supabaseAdmin.from('documents').select('*').eq('id', id).single();
  if (error || !doc) {
    console.error(`[blayne] document ${id} vanished before processing could start:`, error?.message);
    return;
  }

  try {
    await updateDocument(id, { status: 'assembling' });
    const brandKitRow = await getBrandKitById(doc.org_id, doc.brand_kit_id);
    if (!brandKitRow) throw new Error('The Brand Kit this document was queued against no longer exists.');

    const ir = await assembleDocumentIr({
      brandKit: brandKitRow.kit_json,
      docType: doc.doc_type,
      title: doc.title,
      format: doc.format,
      brief: doc.brief,
    });
    await updateDocument(id, { status: 'rendering', ir_json: ir });

    const assets = await listBrandKitAssets(doc.org_id);
    const { buffer, warnings } = await renderDocument({ ir, brandKit: brandKitRow.kit_json, assets, format: doc.format });

    const storagePath = await storeGeneratedDocument(doc.org_id, buffer, doc.id, doc.format);
    await updateDocument(id, {
      status: 'complete',
      storage_path: storagePath,
      warnings,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[blayne] document ${id} generation failed:`, err.message);
    await updateDocument(id, { status: 'failed', error: err.message });
  }
}

/**
 * Writes the 'queued' row and starts processing without waiting for it —
 * callers (the generate_document chat tool, POST /api/brand-kit/documents)
 * get the row back immediately and poll or get told to check back later.
 */
export async function enqueueDocument({ orgId, userId, brandKitId, docType, title, format, brief }) {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      org_id: orgId,
      brand_kit_id: brandKitId,
      doc_type: docType,
      title,
      format,
      brief,
      status: 'queued',
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;

  processDocument(data.id).catch((err) => {
    // processDocument() already records failures on the row itself — this
    // only catches something processDocument's own try/catch couldn't
    // (e.g. the initial select failing), so the process doesn't crash on
    // an unhandled rejection from a fire-and-forget call.
    console.error(`[blayne] document ${data.id} processing crashed unexpectedly:`, err.message);
  });

  return data;
}

export async function getDocument(orgId, id) {
  const { data, error } = await supabaseAdmin.from('documents').select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDocuments(orgId) {
  const { data, error } = await supabaseAdmin.from('documents').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
