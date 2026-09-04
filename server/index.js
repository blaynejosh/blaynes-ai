/**
 * B.L.A.Y.N.E API — the server side of the chat surface.
 *
 *   npm run server        (or `npm run dev:all` to run it beside Vite)
 *
 * This exists because a secret must never reach the browser: the Supabase
 * service role key. (Calling Claude itself needs no API key here — see the
 * client below.) The client posts a conversation here with its Supabase
 * access token; this process verifies the tester, checks their daily quota,
 * adds the base identity prompt, the Blayne skill set, and any brand
 * materials they've shared, calls Claude, and streams the answer back as SSE.
 *
 * Requires the Supabase vars in the environment — see .env.example. Without
 * Supabase configured, /api/chat refuses every request rather than running
 * unauthenticated: an ungated chat endpoint is a free Claude proxy billed to
 * your GCP project.
 *
 * Claude runs through Google Cloud Vertex AI, not the direct Anthropic API —
 * see the AnthropicVertex client below. That's also why brand materials ride
 * as inline base64 content blocks instead of Anthropic's Files API +
 * code-execution container: neither is available on Vertex (a prior attempt
 * at this migration was reverted for exactly that reason — see commit
 * a20493c — before the Files API/container dependency was removed here).
 */
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystem } from './blaynePrompt.js';
import { loadSkills } from './skillStorage.js';
import { storeUserFile, readUserFile, deleteUserFile } from './uploadStorage.js';
import { supabaseAdmin, hasSupabase } from './supabaseAdmin.js';
import { initCatalogue, getCatalogueIndex } from './catalogue/loader.js';
import { matchNeed } from './catalogue/search.js';
import { getAliasOverrides } from './catalogue/aliasOverrides.js';
import { checkFrequencyCap, recordShown } from './catalogue/routingState.js';
import { logRoutingDecision, logCtaClick, logGuardrailCheck } from './catalogue/events.js';
import { checkTurn, isDisclosureRequired } from './guardrails.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.BLAYNE_MODEL ?? 'claude-opus-5';

/** Where the CTA redirect (see /api/cta/:serviceId) sends a clicked recommendation. */
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://blaynes.ai';
const BLAYNES_CONSULTING_CONTACT_URL = 'https://blaynes.consulting/contact';

/** Beta cap: 25 messages/day/tester. Enforced atomically in Postgres — see
 *  check_and_increment_usage() in supabase/schema.sql — so it can't be beaten
 *  by two tabs racing the same request. */
const DAILY_LIMIT = Number(process.env.BLAYNE_DAILY_LIMIT ?? 25);

/* Streaming, so a long answer can't hit an HTTP timeout. 16K is generous for a
   consulting answer while bounding spend; raise it for report-length output. */
const MAX_TOKENS = 16000;

/** Keeps one runaway conversation from blowing the context window. */
const MAX_TURNS = 40;
const MAX_CHARS = 24000;

/**
 * Bounds a resumed turn: the model calling `load_skill` or `save_context`
 * (each call is its own round trip). A multi-category request might
 * reasonably call `load_skill` two or three times in one turn.
 */
const MAX_RESUMES = 8;

/**
 * The Blayne skill set, hosted as Markdown in Google Cloud Storage — see
 * server/skillStorage.js. Each skill's full text is fetched and spliced into
 * the system prompt (buildSystem in blaynePrompt.js) rather than attached as
 * an Anthropic-hosted skill resource.
 *
 * CORE is always on, in every system prompt — it is what makes an answer
 * Blayne's rather than generic: the Repository router (bbip, which also
 * holds the 20-category routing table), the six-phase method, the brand
 * system, and the writing bar.
 *
 * Names below must match an object's filename in the bucket exactly (no
 * .md) — see `npm run skills:list`.
 */
const CORE_SKILLS = ['bbip', 'methodology', 'business_brand_guidelines', 'writing_standards', 'service_routing'];

/**
 * The remaining specialist skills — everything bbip's routing table names
 * that isn't already core. Not pre-loaded: bbip identifies which of these a
 * request needs and the model pulls it in mid-conversation via the
 * `load_skill` tool (see SKILL_TOOL and the tool_use handling in /api/chat),
 * so a request only ever carries the specialists it actually asked for
 * instead of every category's guidance on every call.
 *
 * Deliberately excluded: the document-production and visual-design skills in
 * the bucket (editor, proofreader, document-formatter, image-designer,
 * infographic-designer, information-designer, presentation-designer,
 * template-cloner, visual-document-designer, brand-designer) — this chat
 * surface renders Markdown, not files, so there's nothing for the model to
 * do with them yet. Also excluded: engagement-methodology.md,
 * executive-writing-standard.md, and brand_guidelines.md, which are earlier
 * drafts superseded by the CORE_SKILLS versions of the same content.
 */
const ROUTABLE_SKILLS = [
  'business-consultant',
  'proposal-writer',
  'market-research',
  'report-writer',
  'product-manager',
  'sales-consultant',
  'executive-communication',
  'solutions-architect',
  'technical-writer',
  'regulatory-research',
  'investor-relations',
  'product-marketing',
  'investor-writing-style',
  'ux-research',
  'storytelling',
  'company-setup',
];

/**
 * Lets the model load a specialist skill's full text mid-conversation,
 * instead of the server guessing up front which ones apply. bbip (always in
 * context via CORE_SKILLS) carries the routing table that tells the model
 * which category a request falls into; this tool is how it acts on that.
 */
const SKILL_TOOL = {
  name: 'load_skill',
  description:
    "Load the full playbook for one Blayne specialist skill. Call this as soon as bbip's routing table (see the bbip skill, section 3, \"How routing works\") identifies which category a request falls into — before answering, not after — so the answer is grounded in that specialist's guidance rather than general knowledge. Call it once per skill needed; for a request spanning multiple categories, call it once for each one. Skip it only for requests bbip's core guidance already covers on its own (e.g. brand or writing-quality questions).",
  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        enum: ROUTABLE_SKILLS,
        description: 'The skill name to load, exactly as bbip names it.',
      },
    },
    required: ['skill'],
  },
};

/**
 * Lets the model persist a durable fact about the client's company —
 * see "Building context as you go" in blaynePrompt.js. Backed by
 * saveContextField() (server-side, above) and profiles.company_url /
 * company_brief / context_notes (schema.sql).
 */
const SAVE_CONTEXT_TOOL = {
  name: 'save_context',
  description:
    'Save one durable fact the client just stated about their company, so future sessions already have it instead of asking again — a URL, a one-line brief, their industry, who they target, a competitor, how they want their brand voice to sound, or similar. Only for something the client actually said, never something inferred or guessed. Call it right after they say it, quietly — do not announce that you are saving it.',
  input_schema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        description:
          'Short snake_case label for the fact, e.g. company_url, company_brief, industry, target_audience, competitors, brand_voice.',
      },
      value: { type: 'string', description: 'The fact itself, as the client stated it.' },
    },
    required: ['field', 'value'],
  },
};

/**
 * Backs the service-routing layer (see blayne_skills/service_routing.md,
 * the CORE skill that tells the model when to call this). The tool never
 * exposes the catalogue itself — only the shaped verdict/matches/disclosure
 * result from server/catalogue/search.js — so the catalogue stays backend
 * only regardless of what the model does with the result. The actual
 * matching, frequency-cap enforcement, and event logging happen server-side
 * in the tool_use handling below, not in this schema.
 */
const SEARCH_SERVICES_TOOL = {
  name: 'search_blaynes_services',
  description:
    "Check a client's need against Blayne's Consulting's service catalogue. Call this the moment a request becomes an execution moment (the client needs someone to actually do the work, not just advise on it) — see the service_routing skill for trigger conditions. Never answer scope questions from memory or guess whether Blayne's Consulting offers something; this tool has the real answer. Returns a verdict (in_scope / partly_in_scope / out_of_scope), the matched services if any, what's not covered, a disclosure string, and a CTA link.",
  input_schema: {
    type: 'object',
    properties: {
      need: {
        type: 'string',
        description: "The client's need, in their own words or your best paraphrase of it.",
      },
      context: {
        type: 'string',
        description: 'Optional extra framing already known about this client (industry, size, stack) that sharpens the match.',
      },
    },
    required: ['need'],
  },
};

/*
 * Auth is Application Default Credentials — gcloud auth application-default
 * login locally, or the runtime service account on Cloud Run — same as the
 * @google-cloud/storage client in skillStorage.js/uploadStorage.js. No API
 * key. Requires the Claude models to be enabled for this project in Vertex
 * AI Model Garden.
 *
 * TEMPORARY: while Vertex AI quota on this project is still too low for full
 * app testing, setting ANTHROPIC_API_KEY switches to the direct Anthropic
 * API instead (same model IDs, same messages.stream() surface — no other
 * code here changes). Remove this branch and the ANTHROPIC_API_KEY read once
 * Vertex quota is raised; AnthropicVertex should stay the only path.
 */
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : new AnthropicVertex({
      projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      region: process.env.CLOUD_ML_REGION ?? 'global',
    });

/** Only role/content survives; anything else the client sent is discarded. */
function sanitize(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').slice(0, MAX_CHARS),
    }))
    .filter((m) => m.content.trim())
    .slice(-MAX_TURNS);
}

/**
 * Verifies the Supabase access token on every /api/chat, /api/usage and
 * /api/brand-assets request. This is the gate that stops the endpoint being a
 * free, unmetered Claude proxy to anyone who finds the URL.
 */
async function requireAuth(req, res, next) {
  if (!hasSupabase) {
    return res
      .status(503)
      .json({ error: 'Sign-in is not configured on this server yet. Set the Supabase vars in .env.' });
  }

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to use B.L.A.Y.N.E.' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Your session has expired. Sign in again to continue.' });
  }

  req.userId = data.user.id;
  next();
}

async function currentUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from('usage_daily')
    .select('message_count')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();
  return { used: data?.message_count ?? 0, limit: DAILY_LIMIT };
}

/**
 * Brand materials — the documents a tester shares (brand manual, deck, logo)
 * so B.L.A.Y.N.E can produce work that actually matches their brand instead
 * of something generic. The bytes live in Cloud Storage (uploadStorage.js);
 * Postgres only holds the pointer (see supabase/schema.sql).
 *
 * Sent to Claude as inline `document`/`image` content blocks (built in
 * buildAssetContentBlock, below) rather than Anthropic's Files API +
 * code-execution container, since Vertex AI has neither. That inline path
 * only understands PDF, images, and plain text — not the binary Office
 * formats (.doc/.docx/.ppt/.pptx) the old container-based version could read
 * directly — so those are no longer accepted here. A client with a Word doc
 * or deck needs to export it to PDF first.
 */
const MAX_BRAND_FILE_BYTES = 8 * 1024 * 1024;
/**
 * Combined cap across everything a tester has on file. Unlike the old
 * Files-API version, these bytes are re-sent (base64-encoded, ~1.37x larger)
 * on every /api/chat turn — Claude's total request-size limit is 32MB, and
 * the system prompt/skills/conversation need headroom in that same request.
 */
const MAX_TOTAL_BRAND_BYTES = 20 * 1024 * 1024;
const ALLOWED_BRAND_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

const brandUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BRAND_FILE_BYTES, files: 5 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_BRAND_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`"${file.originalname}" isn't a supported file type — PDF, PNG/JPEG/WebP, or plain text/Markdown/CSV.`));
  },
});

async function listBrandAssets(userId) {
  const { data, error } = await supabaseAdmin
    .from('brand_assets')
    .select('id, file_name, mime_type, size_bytes, storage_path, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Converts one stored brand asset into the content block Claude actually
 * reads it as. Inline document/image blocks only understand PDF and images
 * (see ALLOWED_BRAND_MIME_TYPES) — anything else on file is plain text, so
 * it's decoded and inlined as a `text` block instead of a `document` block:
 * Claude's `document` source for plain text needs the Files API (see
 * pdf-support docs), which isn't available on Vertex AI.
 */
async function buildAssetContentBlock(asset) {
  const buffer = await readUserFile(asset.storage_path);

  if (asset.mime_type === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: asset.mime_type, data: buffer.toString('base64') },
    };
  }
  if (asset.mime_type.startsWith('image/')) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: asset.mime_type, data: buffer.toString('base64') },
    };
  }
  return {
    type: 'text',
    text: `--- Shared file: ${asset.file_name} ---\n${buffer.toString('utf-8')}\n--- End of ${asset.file_name} ---`,
  };
}

/**
 * Everything the platform knows about this client's company: the facts
 * captured at onboarding (OnboardingForm.jsx) plus whatever the model has
 * since learned in conversation and saved via the `save_context` tool
 * (company_url, company_brief, context_notes — see SAVE_CONTEXT_TOOL and
 * saveContextField below). Read on every request so a session starts
 * already knowing what previous ones learned, instead of asking again.
 *
 * Beta note: available to every tester for now — see the comment on these
 * columns in supabase/schema.sql for what changes post-beta.
 */
async function getCompanyContext(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('has_company, company_name, company_size, use_case, company_url, company_brief, context_notes')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Fields with their own column; anything else merges into context_notes. */
const STRUCTURED_CONTEXT_FIELDS = new Set(['company_url', 'company_brief']);

/**
 * Persists one fact the model learned in conversation, for
 * `save_context` — see the tool_use handling in /api/chat. Structured
 * fields overwrite their own column; anything else merges into
 * context_notes atomically via merge_context_note() (see schema.sql) so
 * concurrent saves in the same turn can't drop one another's write.
 */
async function saveContextField(userId, field, value) {
  if (STRUCTURED_CONTEXT_FIELDS.has(field)) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.rpc('merge_context_note', {
    p_user_id: userId,
    p_field: field,
    p_value: value,
  });
  if (error) throw error;
}

/** Client-facing shape — storage_path is an implementation detail. */
const publicAsset = ({ storage_path, ...rest }) => rest;

const app = express();

/*
 * One random nonce per request, used to allow the handful of inline
 * <script> tags this app actually ships (the anti-flash theme bootstrap in
 * index.html, and the JSON-LD Seo.jsx/Breadcrumbs.jsx insert client-side)
 * under a strict script-src — see the CSP below and renderIndexHtml().
 * Generated ahead of helmet so its CSP directive function (below) can read
 * it back off res.locals.
 */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

/*
 * CSP is scoped to what this app actually does, not helmet's generic default.
 * style-src allows 'unsafe-inline' deliberately: the hero and Product Map
 * sections position hundreds of elements via computed inline `style` props
 * (see src/lib/stage.js) to stay pixel-matched to the Figma exports — that's
 * a real architectural choice, not a gap, and it's `style-src`, not
 * `script-src`, so it doesn't open up script injection. connect-src allows
 * any *.supabase.co host rather than hardcoding this project's ref, so the
 * policy doesn't need editing if the Supabase project ever changes.
 *
 * script-src carries the per-request nonce instead of 'unsafe-inline' — the
 * nonce is what lets the theme-bootstrap script and page JSON-LD run at all
 * without weakening the policy against injected script generally.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'https://*.supabase.co'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  }),
);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    hasVertexProject: Boolean(process.env.ANTHROPIC_VERTEX_PROJECT_ID),
    hasSupabase,
    skillsBucket: process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip',
    uploadsBucket: process.env.BLAYNE_UPLOADS_BUCKET ?? 'blayne-user-uploads',
  });
});

app.get('/api/usage', requireAuth, async (req, res) => {
  res.json(await currentUsage(req.userId));
});

app.get('/api/brand-assets', requireAuth, async (req, res) => {
  try {
    res.json((await listBrandAssets(req.userId)).map(publicAsset));
  } catch (err) {
    console.error('[blayne] list brand assets failed:', err.message);
    res.status(500).json({ error: 'Could not load your brand materials.' });
  }
});

app.post('/api/brand-assets', requireAuth, brandUpload.array('files', 5), async (req, res) => {
  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files provided.' });

  const existing = await listBrandAssets(req.userId).catch(() => []);
  const existingBytes = existing.reduce((sum, a) => sum + a.size_bytes, 0);
  const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (existingBytes + incomingBytes > MAX_TOTAL_BRAND_BYTES) {
    return res.status(400).json({
      error: `That would put you over the ${MAX_TOTAL_BRAND_BYTES / (1024 * 1024)}MB total you can share with B.L.A.Y.N.E. Remove something first, or share less.`,
    });
  }

  const created = [];
  try {
    for (const file of files) {
      const storagePath = await storeUserFile(req.userId, file.buffer, file.originalname);

      const { data, error } = await supabaseAdmin
        .from('brand_assets')
        .insert({
          user_id: req.userId,
          file_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          storage_path: storagePath,
        })
        .select('id, file_name, mime_type, size_bytes, created_at')
        .single();
      if (error) throw error;
      created.push(data);
    }

    await supabaseAdmin
      .from('profiles')
      .update({ brand_kit_completed: true, updated_at: new Date().toISOString() })
      .eq('id', req.userId);

    res.status(201).json(created);
  } catch (err) {
    console.error('[blayne] brand asset upload failed:', err.message);
    res.status(500).json({
      error: created.length
        ? 'Some files uploaded, but one failed partway through. Try the remaining one again.'
        : 'Upload failed. Try again shortly.',
    });
  }
});

app.delete('/api/brand-assets/:id', requireAuth, async (req, res) => {
  const { data: asset, error: findError } = await supabaseAdmin
    .from('brand_assets')
    .select('id, storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.userId) // service role bypasses RLS — this check is the real guard
    .maybeSingle();
  if (findError) {
    console.error('[blayne] brand asset lookup failed:', findError.message);
    return res.status(500).json({ error: 'Could not remove that file.' });
  }
  if (!asset) return res.status(404).json({ error: 'File not found.' });

  try {
    await deleteUserFile(asset.storage_path);
  } catch (err) {
    // Already gone in Cloud Storage shouldn't block removing our own record of it.
    console.error('[blayne] Cloud Storage delete failed:', err.message);
  }

  await supabaseAdmin.from('brand_assets').delete().eq('id', asset.id);

  const remaining = await listBrandAssets(req.userId);
  if (remaining.length === 0) {
    await supabaseAdmin
      .from('profiles')
      .update({ brand_kit_completed: false, updated_at: new Date().toISOString() })
      .eq('id', req.userId);
  }

  res.json({ ok: true });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const messages = sanitize(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: 'No messages provided.' });
  if (messages[0].role !== 'user') messages.shift();
  if (!messages.length) {
    return res.status(400).json({ error: 'Conversation must start with a user message.' });
  }

  // Per-thread state for the routing frequency cap (see catalogue/routingState.js)
  // — the client generates one crypto.randomUUID() per chat session (src/lib/chat.js)
  // since nothing else in this app persists a conversation/thread id.
  const threadId = typeof req.body?.thread_id === 'string' ? req.body.thread_id.slice(0, 100) : null;

  // Atomic check-then-increment in Postgres (see supabase/schema.sql) — the
  // request is rejected here, before any Claude call, rather than after.
  const { data: quotaRows, error: quotaError } = await supabaseAdmin.rpc(
    'check_and_increment_usage',
    { p_user_id: req.userId, p_limit: DAILY_LIMIT },
  );
  if (quotaError) {
    console.error('[blayne] quota check failed:', quotaError.message);
    return res.status(500).json({ error: 'Could not check your usage. Try again shortly.' });
  }
  const quota = quotaRows?.[0];
  if (!quota?.allowed) {
    return res.status(429).json({
      error: `You've used all ${DAILY_LIMIT} messages for today. Your limit resets tomorrow.`,
    });
  }
  const blayneUsage = { used: quota.message_count, limit: DAILY_LIMIT };

  let brandAssets = [];
  let companyContext = null;
  try {
    [brandAssets, companyContext] = await Promise.all([
      listBrandAssets(req.userId),
      getCompanyContext(req.userId),
    ]);
  } catch (err) {
    console.error('[blayne] context lookup failed:', err.message);
    // Non-fatal — proceed without it rather than fail the whole chat.
  }

  const { category, topic } = req.body ?? {};
  // The full session history is resent on every turn, so `messages.length === 1`
  // reliably means "the first message of this session" — see server/blaynePrompt.js.
  const needsBrandAsk = messages.length === 1 && brandAssets.length === 0;
  const skills = await loadSkills(CORE_SKILLS);
  const system = buildSystem(category, topic, { needsBrandAsk, skills, companyContext });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const tools = [SKILL_TOOL, SAVE_CONTEXT_TOOL, SEARCH_SERVICES_TOOL];

  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools,
  };

  /*
   * Brand documents ride as inline content blocks (built by
   * buildAssetContentBlock, above) on the session's very first user turn:
   * the full history is resent every request, so they stay "in context" for
   * the rest of the session without re-attaching, and the cache_control
   * breakpoint on the last one keeps the repeat sends cheap (Claude reads
   * the identical bytes from its prompt cache instead of re-processing them
   * every turn, as long as nothing earlier in the prefix changed).
   */
  let assetBlocks = [];
  if (brandAssets.length) {
    const built = await Promise.all(
      brandAssets.map(async (asset) => {
        try {
          return await buildAssetContentBlock(asset);
        } catch (err) {
          console.error(`[blayne] could not read shared file "${asset.file_name}":`, err.message);
          return null;
        }
      }),
    );
    assetBlocks = built.filter(Boolean);
    if (assetBlocks.length) {
      assetBlocks[assetBlocks.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
    }
  }

  const turns = messages.map((m, i) => {
    if (i !== 0 || assetBlocks.length === 0) return { role: m.role, content: m.content };
    return { role: m.role, content: [...assetBlocks, { type: 'text', text: m.content }] };
  });

  let resumes = 0;
  // Accumulated across every resume in this turn, so the guardrail repair
  // pass (below) sees the whole answer, not just the segment after the last
  // tool call — see server/guardrails.js for why this can only append, not
  // retroactively edit what already streamed.
  let assistantText = '';
  let disclosureRequiredThisTurn = false;
  let recommendedServiceIdsThisTurn = [];

  try {
    while (true) {
      const stream = client.messages.stream({ ...request, messages: turns });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          assistantText += event.delta.text;
          send({ type: 'text', text: event.delta.text });
        }
      }

      const final = await stream.finalMessage();

      if (final.stop_reason === 'tool_use' && resumes < MAX_RESUMES) {
        turns.push({ role: 'assistant', content: final.content });

        const toolResults = await Promise.all(
          final.content
            .filter((block) => block.type === 'tool_use')
            .map(async (block) => {
              if (block.name === 'load_skill') {
                const [entry] = await loadSkills([block.input?.skill]);
                return {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: entry ? entry.content : `Skill "${block.input?.skill}" isn't available.`,
                  ...(entry ? {} : { is_error: true }),
                };
              }

              if (block.name === 'save_context') {
                try {
                  await saveContextField(req.userId, block.input?.field, block.input?.value);
                  return { type: 'tool_result', tool_use_id: block.id, content: 'Saved.' };
                } catch (err) {
                  console.error('[blayne] save_context failed:', err.message);
                  return {
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: "Couldn't save that — continue without blocking on it.",
                    is_error: true,
                  };
                }
              }

              if (block.name === 'search_blaynes_services') {
                try {
                  const extraAliasesByServiceId = await getAliasOverrides();
                  const catalogueIndex = getCatalogueIndex();
                  const result = await matchNeed({
                    need: String(block.input?.need ?? ''),
                    context: block.input?.context ? String(block.input.context) : undefined,
                    catalogueIndex,
                    extraAliasesByServiceId,
                    ctaBaseUrl: PUBLIC_ORIGIN,
                    threadId,
                  });

                  const matchedServiceIds = result.matches.map((m) => m.service_id);
                  const { capped } = await checkFrequencyCap(threadId, matchedServiceIds);
                  const owed = isDisclosureRequired({ verdict: result.verdict, frequencyCapped: capped });
                  if (owed) {
                    disclosureRequiredThisTurn = true;
                    recommendedServiceIdsThisTurn = [...recommendedServiceIdsThisTurn, ...matchedServiceIds];
                  }

                  logRoutingDecision({
                    threadId,
                    userId: req.userId,
                    verdict: result.verdict,
                    matches: result.matches,
                    frequencyCapped: capped,
                  }).catch(() => {});

                  const toolPayload = capped
                    ? {
                        ...result,
                        frequency_capped: true,
                        directive:
                          "Already recommended in this thread for this need. Do not restate the recommendation or disclosure unless the client explicitly asks again or this is a genuinely new need — see the frequency cap section of the service_routing skill.",
                      }
                    : { ...result, frequency_capped: false };

                  return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolPayload) };
                } catch (err) {
                  console.error('[blayne] search_blaynes_services failed:', err.message);
                  return {
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: 'Service lookup failed — answer without a Blayne\'s Consulting recommendation this turn rather than guessing.',
                    is_error: true,
                  };
                }
              }

              return { type: 'tool_result', tool_use_id: block.id, content: 'Unknown tool.', is_error: true };
            }),
        );

        turns.push({ role: 'user', content: toolResults });
        resumes += 1;
        continue;
      }

      if (final.stop_reason === 'refusal') {
        send({
          type: 'refused',
          message:
            "I can't help with that one. If you think that's wrong, rephrase it or route it to a human at Blayne's Consulting.",
          blayne_usage: blayneUsage,
        });
      } else {
        // Guardrail repair (Phase 4) — see server/guardrails.js for why this
        // can only append a correction, not retroactively edit text that has
        // already streamed to the client.
        const { repairText, violations } = checkTurn(assistantText, {
          disclosureRequired: disclosureRequiredThisTurn,
        });
        if (repairText) {
          console.warn(`[blayne] guardrail repair on thread ${threadId ?? '(none)'}:`, violations.join(', '));
          send({ type: 'text', text: repairText });
        }
        if (violations.length) {
          logGuardrailCheck({
            threadId,
            disclosureRequired: disclosureRequiredThisTurn,
            disclosurePresentBeforeRepair: disclosureRequiredThisTurn && !violations.includes('missing_disclosure'),
            violations,
          }).catch(() => {});
        }
        if (recommendedServiceIdsThisTurn.length) {
          recordShown(threadId, req.userId, recommendedServiceIdsThisTurn).catch(() => {});
        }
        send({
          type: 'done',
          stop_reason: final.stop_reason,
          usage: final.usage,
          blayne_usage: blayneUsage,
        });
      }
      break;
    }
  } catch (err) {
    const status = err?.status;
    const raw = err?.message ?? '';
    // Missing GCP credentials/project throw without an HTTP status, so match
    // on the message — same idea as the old ANTHROPIC_API_KEY check, but for
    // Application Default Credentials and the Vertex project id.
    const noCredentials =
      status === 401 ||
      status === 403 ||
      /could not load the default credentials|application default credentials|project.*not.*found|PROJECT_ID/i.test(raw);

    const message = noCredentials
      ? "B.L.A.Y.N.E is not connected yet — the server can't reach Claude on Vertex AI. Set ANTHROPIC_VERTEX_PROJECT_ID (and run `gcloud auth application-default login` in dev) and restart it."
      : status === 429
        ? 'Rate limited by Vertex AI. Try again shortly.'
        : status >= 500
          ? 'Claude on Vertex AI is unavailable right now. Try again shortly.'
          : (raw || 'Unexpected error.');

    console.error('[blayne] chat failed:', status ?? '', raw || err);
    send({ type: 'error', message });
  } finally {
    res.end();
  }
});

/**
 * The link every recommendation's `cta_url` (see catalogue/search.js) points
 * at, instead of the real Blayne's Consulting contact page directly — so a
 * click is observable (Phase 6's "whether the CTA was clicked") without any
 * new frontend UI: the existing Markdown renderer already turns this into a
 * plain link. No auth required — this is a public redirect, not client data.
 */
app.get('/api/cta/:serviceId', (req, res) => {
  logCtaClick({ threadId: req.query.thread ?? null, serviceId: req.params.serviceId }).catch(() => {});
  res.redirect(302, BLAYNES_CONSULTING_CONTACT_URL);
});

app.all('/api/*splat', (req, res) => res.status(404).json({ error: 'Not found' }));

/* Production: serve the Vite build and fall back to index.html for every
   client-side route (/login, /features, /auth/callback, …). In dev, Vite
   serves the front end on :5173 and proxies /api here, so dist/ won't exist
   and this block is skipped without erroring. */
if (fs.existsSync(distDir)) {
  // Read once at boot — the build doesn't change while the process runs —
  // and template in a fresh per-request nonce plus this route's title/
  // description/canonical/robots (see ROUTE_META below) on the way out.
  //
  // The nonce is what lets the inline theme-bootstrap script and
  // client-inserted JSON-LD (Seo.jsx, Breadcrumbs.jsx) run at all instead of
  // silently getting blocked and logging a CSP violation. The per-route meta
  // matters for anything that reads this raw HTML instead of running the
  // app's JS: link-preview unfurlers (Slack, iMessage, X, Discord) and any
  // crawler that only honors a noindex tag on a page it's actually allowed
  // to fetch — which is also why public/robots.txt doesn't Disallow any of
  // these routes; a Disallowed page's noindex meta can never be seen, and
  // Google says so explicitly. src/components/Seo.jsx re-applies the same
  // values (by hand, not from this shared registry — no SSR here) once the
  // app's JS takes over for a real visitor.
  const indexHtmlTemplate = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');

  const SITE_URL = 'https://blaynes.ai';
  const HOME_META = {
    title: 'B.L.A.Y.N.E AI — Your Consulting Team, On Demand',
    description:
      "B.L.A.Y.N.E AI — Business Leading Agent Yielding Next-Gen Enterprise Strategies. Twenty consulting capability modules, mapped to the roles of a fully staffed enterprise, from Blayne's Consulting.",
    canonical: `${SITE_URL}/`,
    robots: 'index, follow',
  };
  // Every route not listed here — the auth-gated app screens — falls back to
  // GATED_META below: there's nothing server-rendered to preview for them
  // (the real content is entirely client-rendered behind sign-in), so they
  // just need a sane title and a noindex that a crawler can actually read.
  const ROUTE_META = {
    '/': HOME_META,
    '/terms': {
      title: 'Terms of Use | B.L.A.Y.N.E AI',
      description:
        "The terms governing your use of B.L.A.Y.N.E, Blayne's Consulting's AI consulting product.",
      canonical: `${SITE_URL}/terms`,
      robots: 'index, follow',
    },
    '/privacy': {
      title: 'Privacy Policy | B.L.A.Y.N.E AI',
      description:
        "What personal information B.L.A.Y.N.E collects, how it's used, and the privacy rights you have over it.",
      canonical: `${SITE_URL}/privacy`,
      robots: 'index, follow',
    },
  };
  const GATED_META = { ...HOME_META, robots: 'noindex, nofollow' };

  // Paths React Router actually has a route for (see src/App.jsx), used both
  // to pick ROUTE_META above and the HTTP status on the SPA fallback below —
  // so a broken/typo'd link still reads as a real 404 to anything that
  // checks the status code, not just the rendered body, even though the
  // same index.html (and client-side NotFoundPage) is what serves it either
  // way.
  const KNOWN_STATIC_PATHS = new Set([
    '/',
    '/login',
    '/auth/callback',
    '/onboarding',
    '/safety-addendum',
    '/terms',
    '/privacy',
    '/how-we-work',
  ]);
  // The four Product Map routes (see src/data/productMap.js MAP_SECTIONS),
  // matched by src/App.jsx's single "/:category" route.
  const KNOWN_CATEGORIES = new Set(['features', 'job-roles', 'departments', 'startups']);
  const isKnownPath = (p) => KNOWN_STATIC_PATHS.has(p) || KNOWN_CATEGORIES.has(p.slice(1));

  const renderIndexHtml = (nonce, meta) =>
    indexHtmlTemplate
      .replaceAll('%%CSP_NONCE%%', nonce)
      .replaceAll('%%PAGE_TITLE%%', meta.title)
      .replaceAll('%%PAGE_DESCRIPTION%%', meta.description)
      .replaceAll('%%PAGE_CANONICAL%%', meta.canonical)
      .replaceAll('%%PAGE_ROBOTS%%', meta.robots);

  const sendIndexHtml = (req, res) => {
    const known = isKnownPath(req.path);
    const meta = (known && ROUTE_META[req.path]) || GATED_META;
    res
      .status(known ? 200 : 404)
      .set('Cache-Control', 'no-store') // the nonce is single-use — this response must never be cached
      .type('html')
      .send(renderIndexHtml(res.locals.cspNonce, meta));
  };

  // `index: false` — otherwise static would serve the un-templated
  // dist/index.html straight off disk for "/", leaving the literal
  // "%%CSP_NONCE%%" placeholder in place instead of a real nonce.
  app.use(express.static(distDir, { index: false }));
  app.get('*splat', sendIndexHtml);
}

// Multer's fileFilter/size-limit failures arrive here, not in the route handler.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File too large — the limit is ${MAX_BRAND_FILE_BYTES / (1024 * 1024)}MB each.`
        : err.message;
    return res.status(400).json({ error: message });
  }
  if (err) {
    return res.status(400).json({ error: err.message ?? 'Upload failed.' });
  }
  next();
});

/*
 * The service catalogue loads eagerly and hard-fails boot on any problem —
 * unlike skills (soft-fail, lazy) — see the comment atop
 * server/catalogue/loader.js for why. A silently broken or missing
 * catalogue is worse than the server not starting: it would either recommend
 * services that don't exist or silently stop recommending anything real.
 */
try {
  await initCatalogue();
} catch (err) {
  console.error('[blayne] FATAL: could not load the service catalogue —', err.message);
  console.error('[blayne] Refusing to start rather than run with service routing silently broken.');
  process.exit(1);
}

app.listen(PORT, () => {
  const claudeVia = process.env.ANTHROPIC_API_KEY ? 'direct Anthropic API (temporary — see client init)' : 'Vertex AI';
  console.log(`[blayne] API on http://localhost:${PORT} (model: ${MODEL}, via ${claudeVia})`);
  console.log(
    `[blayne] skills served from gs://${process.env.BLAYNE_SKILLS_BUCKET ?? 'blayne-skills-bbip'}/blayne_skills/ (fetched on first use per skill, cached after; missing ones fall back to the base identity prompt)`,
  );
  console.log(
    hasSupabase
      ? `[blayne] Supabase auth active — ${DAILY_LIMIT} messages/day/tester`
      : '[blayne] no Supabase config — /api/chat and /api/usage will return 503 (see .env.example)',
  );
  if (!process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
    console.warn('[blayne] ANTHROPIC_VERTEX_PROJECT_ID is not set — /api/chat will fail once auth passes.');
  }
});
