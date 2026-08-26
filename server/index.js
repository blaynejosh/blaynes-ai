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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { buildSystem } from './blaynePrompt.js';
import { loadSkills } from './skillStorage.js';
import { storeUserFile, readUserFile, deleteUserFile } from './uploadStorage.js';
import { supabaseAdmin, hasSupabase } from './supabaseAdmin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.BLAYNE_MODEL ?? 'claude-opus-5';

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
const CORE_SKILLS = ['bbip', 'methodology', 'business_brand_guidelines', 'writing_standards'];

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

/*
 * Auth is Application Default Credentials — gcloud auth application-default
 * login locally, or the runtime service account on Cloud Run — same as the
 * @google-cloud/storage client in skillStorage.js/uploadStorage.js. No API
 * key. Requires the Claude models to be enabled for this project in Vertex
 * AI Model Garden.
 */
const client = new AnthropicVertex({
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
 * CSP is scoped to what this app actually does, not helmet's generic default.
 * style-src allows 'unsafe-inline' deliberately: the hero and Product Map
 * sections position hundreds of elements via computed inline `style` props
 * (see src/lib/stage.js) to stay pixel-matched to the Figma exports — that's
 * a real architectural choice, not a gap, and it's `style-src`, not
 * `script-src`, so it doesn't open up script injection. connect-src allows
 * any *.supabase.co host rather than hardcoding this project's ref, so the
 * policy doesn't need editing if the Supabase project ever changes.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
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

  const tools = [SKILL_TOOL, SAVE_CONTEXT_TOOL];

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

  try {
    while (true) {
      const stream = client.messages.stream({ ...request, messages: turns });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
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

app.all('/api/*splat', (req, res) => res.status(404).json({ error: 'Not found' }));

/* Production: serve the Vite build and fall back to index.html for every
   client-side route (/login, /features, /auth/callback, …). In dev, Vite
   serves the front end on :5173 and proxies /api here, so dist/ won't exist
   and this block is skipped without erroring. */
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*splat', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
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

app.listen(PORT, () => {
  console.log(`[blayne] API on http://localhost:${PORT} (model: ${MODEL})`);
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
