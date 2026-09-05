/**
 * Brand Kit / Document Engine API — Phase 1 (asset ingestion, tenant
 * migration, manual path), Phase 2 (extraction/confirmation), Phase 3 (the
 * renderer's manual-verification harness), and Phase 4 (the real
 * generation pipeline: POST/GET /documents). Mounted at /api/brand-kit in
 * server/index.js, behind the same requireAuth used by /api/chat, plus
 * requireOrg (see tenant.js) for the tenant boundary every route here
 * needs.
 */
import express from 'express';
import multer from 'multer';
import { requireOrg } from './tenant.js';
import { ingestAsset, listBrandKitAssets, getBrandKitAsset } from './ingest.js';
import { deleteBrandKitAsset as deleteFromStorage, getSignedReadUrl, assertOwnedByOrg } from './storage.js';
import {
  createManualBrandKit,
  getActiveBrandKit,
  getBrandKitById,
  listBrandKits,
  updateBrandKit,
  deleteBrandKit,
  archiveActiveKit,
} from './manualKit.js';
import { runExtraction } from './extraction/extractKit.js';
import { coerceAndShapeField, setPath } from './extraction/proposals.js';
import { checkBrandKitCompleteness, validateDocumentIr } from './schema.js';
import { resolveTokens } from './tokens.js';
import { renderDocument } from './render/index.js';
import { DOC_TYPES } from './documents/assembleIr.js';
import { enqueueDocument, getDocument, listDocuments } from './documents/jobs.js';
import { supabaseAdmin } from '../supabaseAdmin.js';

const DOC_FORMATS = new Set(['pdf', 'docx']);

const ASSET_KINDS = new Set(['guideline', 'corporate_profile', 'logo', 'palette', 'font', 'icon_set', 'sample_document']);

// The real per-kind limits live in ingest.js's KIND_RULES — this is just the
// HTTP-layer ceiling so multer doesn't buffer something absurd into memory
// before ingest.js gets a chance to reject it with a clearer message.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 10 } });

const router = express.Router();

router.use(requireOrg);

router.get('/assets', async (req, res) => {
  try {
    const all = await listBrandKitAssets(req.orgId);
    const filtered = req.query.kind ? all.filter((a) => a.kind === req.query.kind) : all;
    res.json(filtered.map(({ storage_path, ...rest }) => rest));
  } catch (err) {
    console.error('[blayne] list brand kit assets failed:', err.message);
    res.status(500).json({ error: 'Could not load your Brand Kit assets.' });
  }
});

router.post('/assets', upload.array('files', 10), async (req, res) => {
  const kind = req.body?.kind;
  if (!ASSET_KINDS.has(kind)) {
    return res.status(400).json({ error: `"kind" must be one of: ${[...ASSET_KINDS].join(', ')}.` });
  }
  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files provided.' });

  const created = [];
  try {
    for (const file of files) {
      const { asset, derived } = await ingestAsset({
        orgId: req.orgId,
        userId: req.userId,
        kind,
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
      });
      created.push(asset, ...derived);
    }
    res.status(201).json(created.map(({ storage_path, ...rest }) => rest));
  } catch (err) {
    console.error('[blayne] brand kit asset ingestion failed:', err.message);
    res.status(created.length ? 207 : 400).json({
      error: err.message,
      created: created.map(({ storage_path, ...rest }) => rest),
    });
  }
});

router.get('/assets/:id/download-url', async (req, res) => {
  try {
    const asset = await getBrandKitAsset(req.orgId, req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    assertOwnedByOrg(asset.storage_path, req.orgId); // defense in depth on top of the org-scoped query above
    const url = await getSignedReadUrl(asset.storage_path);
    res.json({ url, expires_in_seconds: 600 });
  } catch (err) {
    console.error('[blayne] signed URL generation failed:', err.message);
    res.status(500).json({ error: 'Could not generate a download link.' });
  }
});

router.post('/assets/:id/license-attestation', async (req, res) => {
  const { license_type, embedding_permitted } = req.body ?? {};
  try {
    const asset = await getBrandKitAsset(req.orgId, req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (asset.kind !== 'font') return res.status(400).json({ error: 'License attestation only applies to font assets.' });

    const { data, error } = await supabaseAdmin
      .from('brand_kit_assets')
      .update({
        license_attested: true,
        license_attested_by: req.userId,
        license_attested_at: new Date().toISOString(),
        license_type: license_type ?? null,
        embedding_permitted: Boolean(embedding_permitted),
      })
      .eq('id', asset.id)
      .eq('org_id', req.orgId)
      .select()
      .single();
    if (error) throw error;

    const { storage_path, ...rest } = data;
    res.json(rest);
  } catch (err) {
    console.error('[blayne] license attestation failed:', err.message);
    res.status(500).json({ error: 'Could not record the license attestation.' });
  }
});

router.delete('/assets/:id', async (req, res) => {
  try {
    const asset = await getBrandKitAsset(req.orgId, req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    assertOwnedByOrg(asset.storage_path, req.orgId);
    await deleteFromStorage(asset.storage_path);
    await supabaseAdmin.from('brand_kit_assets').delete().eq('id', asset.id).eq('org_id', req.orgId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[blayne] brand kit asset delete failed:', err.message);
    res.status(500).json({ error: 'Could not remove that asset.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const kit = await getActiveBrandKit(req.orgId);
    res.json(kit ?? null);
  } catch (err) {
    console.error('[blayne] active brand kit lookup failed:', err.message);
    res.status(500).json({ error: 'Could not load your Brand Kit.' });
  }
});

router.post('/manual', async (req, res) => {
  const { name, primary_hex, secondary_hex, layout_style, logo_asset_ids } = req.body ?? {};
  try {
    if (!Array.isArray(logo_asset_ids) || !logo_asset_ids.length) {
      return res.status(400).json({ error: 'logo_asset_ids must include at least one already-uploaded logo asset id.' });
    }
    const logoAssets = await Promise.all(logo_asset_ids.map((id) => getBrandKitAsset(req.orgId, id)));
    if (logoAssets.some((a) => !a)) {
      return res.status(400).json({ error: 'One or more logo_asset_ids were not found in your organization.' });
    }
    if (logoAssets.some((a) => a.kind !== 'logo')) {
      return res.status(400).json({ error: 'One or more logo_asset_ids do not refer to a logo asset.' });
    }

    const kit = await createManualBrandKit({
      orgId: req.orgId,
      userId: req.userId,
      name,
      primaryHex: primary_hex,
      secondaryHex: secondary_hex,
      layoutStyle: layout_style,
      logos: logoAssets.map((a) => ({
        asset_id: a.id,
        format: a.extracted?.format === 'svg' ? 'svg' : a.mime_type === 'image/png' ? 'png' : 'jpg',
      })),
    });
    res.status(201).json(kit);
  } catch (err) {
    console.error('[blayne] manual brand kit creation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * Phase 2 — extraction and the confirmation step. "Draft" here covers any
 * non-active brand_kits row (status draft or awaiting_review); extraction
 * always produces awaiting_review directly since there's no separate
 * machine-draft stage in this pipeline — see runExtraction()'s doc comment.
 */
router.post('/extract', async (req, res) => {
  try {
    const { brandKit, rejectedProposalCount } = await runExtraction({ orgId: req.orgId, userId: req.userId });
    res.status(201).json({ ...brandKit, rejected_proposal_count: rejectedProposalCount });
  } catch (err) {
    console.error('[blayne] Brand Kit extraction failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/drafts', async (req, res) => {
  try {
    res.json(await listBrandKits(req.orgId));
  } catch (err) {
    console.error('[blayne] list brand kits failed:', err.message);
    res.status(500).json({ error: 'Could not load your Brand Kit history.' });
  }
});

/** The confirmation UI's main read: the draft itself, resolved tokens for
 * the preview panel, and a completeness check against the schema — three
 * things that screen needs in one call instead of three round trips. */
router.get('/drafts/:id', async (req, res) => {
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });
    res.json({
      ...kit,
      resolved_tokens: resolveTokens(kit.kit_json),
      completeness: checkBrandKitCompleteness(kit.kit_json),
    });
  } catch (err) {
    console.error('[blayne] brand kit draft lookup failed:', err.message);
    res.status(500).json({ error: 'Could not load that Brand Kit.' });
  }
});

/**
 * Edits one field's value and marks it confirmed — a human actively
 * correcting or accepting-with-changes a proposed value. method becomes
 * 'user_entered' because this IS what the user just entered, distinct from
 * confirm-field below (accepting the extracted value unchanged).
 */
router.patch('/drafts/:id/fields', async (req, res) => {
  const { path, value } = req.body ?? {};
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });
    if (kit.status === 'active' || kit.status === 'archived') {
      return res.status(400).json({ error: `Cannot edit a Brand Kit that is ${kit.status} — only draft/awaiting_review kits are editable.` });
    }

    const logoAssets = (await listBrandKitAssets(req.orgId)).filter((a) => a.kind === 'logo');
    const result = coerceAndShapeField(path, value, logoAssets);
    if (!result.ok) return res.status(400).json({ error: `"${path}": ${result.reason}` });

    const kitJson = structuredClone(kit.kit_json);
    setPath(kitJson, path, result.value);
    kitJson.provenance ??= {};
    kitJson.provenance[path] = { method: 'user_entered', confidence: 1, confirmed: true };

    const updated = await updateBrandKit(req.orgId, kit.id, { kit_json: kitJson });
    res.json({ ...updated, resolved_tokens: resolveTokens(updated.kit_json), completeness: checkBrandKitCompleteness(updated.kit_json) });
  } catch (err) {
    console.error('[blayne] brand kit field edit failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/** Accepts an already-proposed value as-is — confirmed becomes true, the
 * value and method (extracted_llm/extracted_deterministic/system_default)
 * are untouched, unlike the edit endpoint above. */
router.post('/drafts/:id/confirm-field', async (req, res) => {
  const { path } = req.body ?? {};
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });
    if (!kit.kit_json.provenance?.[path]) return res.status(400).json({ error: `No proposed field at path "${path}".` });

    const kitJson = structuredClone(kit.kit_json);
    kitJson.provenance[path] = { ...kitJson.provenance[path], confirmed: true };

    const updated = await updateBrandKit(req.orgId, kit.id, { kit_json: kitJson });
    res.json(updated);
  } catch (err) {
    console.error('[blayne] brand kit field confirmation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/** Bulk convenience: confirms every remaining unconfirmed field at its
 * current value, in one explicit action — still a real human action (the
 * button click), not an automatic default-to-confirmed. See the Phase 2
 * report for why this exists rather than requiring N individual clicks. */
router.post('/drafts/:id/confirm-all-remaining', async (req, res) => {
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });

    const kitJson = structuredClone(kit.kit_json);
    for (const entry of Object.values(kitJson.provenance ?? {})) entry.confirmed = true;

    const updated = await updateBrandKit(req.orgId, kit.id, { kit_json: kitJson });
    res.json(updated);
  } catch (err) {
    console.error('[blayne] brand kit bulk confirmation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * The actual "make this the tenant's Brand Kit" action — refuses unless
 * every provenance entry is confirmed and the kit passes full schema
 * validation, then archives whatever was active before it. This is the one
 * place in the whole feature where "confirmed" stops being a UI hint and
 * starts being an enforced gate.
 */
router.post('/drafts/:id/confirm', async (req, res) => {
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });
    if (kit.status === 'active') return res.status(400).json({ error: 'This Brand Kit is already active.' });

    const unconfirmed = Object.entries(kit.kit_json.provenance ?? {}).filter(([, v]) => !v.confirmed);
    if (unconfirmed.length) {
      return res.status(400).json({
        error: `${unconfirmed.length} field(s) still need review before this Brand Kit can go active.`,
        unconfirmed_paths: unconfirmed.map(([path]) => path),
      });
    }

    const completeness = checkBrandKitCompleteness(kit.kit_json);
    if (!completeness.complete) {
      return res.status(400).json({ error: 'This Brand Kit is missing required fields.', errors: completeness.errors });
    }

    const now = new Date().toISOString();
    await archiveActiveKit(req.orgId);
    const activated = await updateBrandKit(req.orgId, kit.id, {
      status: 'active',
      confirmed_at: now,
      confirmed_by: req.userId,
      kit_json: { ...kit.kit_json, status: 'active', confirmed_at: now, confirmed_by: req.userId },
    });
    res.json(activated);
  } catch (err) {
    console.error('[blayne] brand kit confirmation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/drafts/:id', async (req, res) => {
  try {
    const kit = await getBrandKitById(req.orgId, req.params.id);
    if (!kit) return res.status(404).json({ error: 'Brand Kit not found.' });
    // Only a never-activated draft/awaiting_review kit is safe to delete.
    // An archived kit is blocked too, not just an active one — Phase 4
    // documents will record which kit *version* rendered them ("a brand
    // change never silently rewrites history"), so a version that was ever
    // active must stay retrievable even after a newer one replaces it.
    if (kit.status === 'active' || kit.status === 'archived') {
      return res.status(400).json({ error: `Cannot delete a Brand Kit that is ${kit.status} — only an unconfirmed draft can be discarded.` });
    }
    await deleteBrandKit(req.orgId, kit.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[blayne] brand kit delete failed:', err.message);
    res.status(500).json({ error: 'Could not remove that draft.' });
  }
});

/**
 * Phase 4 — the real generation pipeline. Enqueues a job (see
 * documents/jobs.js) and returns immediately with status 'queued'; the
 * client polls GET /documents/:id (or the generate_document chat tool tells
 * the client to check back). Requires an active Brand Kit — a document
 * always renders against one specific, already-confirmed version.
 */
router.post('/documents', async (req, res) => {
  const { doc_type: docType, title, format, brief } = req.body ?? {};
  if (!DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: `doc_type must be one of: ${DOC_TYPES.join(', ')}.` });
  }
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required.' });
  if (!DOC_FORMATS.has(format)) return res.status(400).json({ error: 'format must be "pdf" or "docx".' });
  if (!brief || typeof brief !== 'string') return res.status(400).json({ error: 'brief is required.' });

  try {
    const brandKit = await getActiveBrandKit(req.orgId);
    if (!brandKit) {
      return res.status(400).json({ error: 'This organization has no active Brand Kit yet — confirm one before generating a document.' });
    }
    const job = await enqueueDocument({
      orgId: req.orgId,
      userId: req.userId,
      brandKitId: brandKit.id,
      docType,
      title,
      format,
      brief,
    });
    const { ir_json, ...summary } = job;
    res.status(202).json(summary);
  } catch (err) {
    console.error('[blayne] document generation enqueue failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const docs = await listDocuments(req.orgId);
    res.json(docs.map(({ ir_json, ...rest }) => rest));
  } catch (err) {
    console.error('[blayne] list documents failed:', err.message);
    res.status(500).json({ error: 'Could not load your documents.' });
  }
});

/** The polling endpoint — status plus, once 'complete', enough to fetch the
 * file (a signed URL is issued separately, below, not embedded here, so a
 * cached status response can never hand out a stale download link). */
router.get('/documents/:id', async (req, res) => {
  try {
    const doc = await getDocument(req.orgId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    const { ir_json, ...rest } = doc;
    res.json(rest);
  } catch (err) {
    console.error('[blayne] document lookup failed:', err.message);
    res.status(500).json({ error: 'Could not load that document.' });
  }
});

router.get('/documents/:id/download-url', async (req, res) => {
  try {
    const doc = await getDocument(req.orgId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    if (doc.status !== 'complete' || !doc.storage_path) {
      return res.status(400).json({ error: `This document is "${doc.status}" — not ready to download yet.` });
    }
    assertOwnedByOrg(doc.storage_path, req.orgId);
    const url = await getSignedReadUrl(doc.storage_path);
    res.json({ url, expires_in_seconds: 600 });
  } catch (err) {
    console.error('[blayne] document signed URL generation failed:', err.message);
    res.status(500).json({ error: 'Could not generate a download link.' });
  }
});

/**
 * Phase 3 test/manual-verification harness, kept as-is now that Phase 4
 * exists above — takes a raw, already-written Document IR body, renders it
 * against this org's *active* Brand Kit, and streams back the file,
 * synchronously, no job row. Useful for iterating on the renderer itself
 * (a hand-written or fixture IR) without paying for a real model call, and
 * as documentation of the exact shape POST /documents' job ends up
 * rendering internally.
 */
router.post('/render-preview', async (req, res) => {
  const format = req.query.format === 'docx' ? 'docx' : 'pdf';
  try {
    validateDocumentIr(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const [brandKit, assets] = await Promise.all([getActiveBrandKit(req.orgId), listBrandKitAssets(req.orgId)]);
    if (!brandKit) {
      return res.status(400).json({ error: 'This organization has no active Brand Kit yet — confirm one before rendering.' });
    }

    const { buffer, warnings } = await renderDocument({ ir: req.body, brandKit: brandKit.kit_json, assets, format });
    if (warnings.length) res.set('X-Render-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    res.set('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="preview.${format}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[blayne] render preview failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Multer's fileFilter/size-limit failures arrive here, not in the route handler.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
