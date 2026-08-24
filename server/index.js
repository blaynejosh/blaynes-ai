/**
 * B.L.A.Y.N.E API — the server side of the chat surface.
 *
 *   npm run server        (or `npm run dev:all` to run it beside Vite)
 *
 * This exists because two secrets must never reach the browser: the Anthropic
 * key and the Supabase service role key. The client posts a conversation
 * here with its Supabase access token; this process verifies the tester,
 * checks their daily quota, adds the base identity prompt, the Blayne skill
 * set, and any brand materials they've shared, calls Claude, and streams the
 * answer back as SSE.
 *
 * Requires ANTHROPIC_API_KEY and the Supabase vars in the environment — see
 * .env.example. Without Supabase configured, /api/chat refuses every request
 * rather than running unauthenticated: an ungated chat endpoint is a free
 * Claude proxy billed to your key.
 */
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { buildSystem } from './blaynePrompt.js';
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

/** Server tools pause at 10 internal iterations; resume a bounded number of times. */
const MAX_RESUMES = 4;

/**
 * The Blayne skill set, uploaded by `npm run skills:upload`.
 *
 * Skills are how B.L.A.Y.N.E. reaches its own methodology, brand rules, writing
 * standards and specialist playbooks: each skill's description stays in context
 * and the model pulls in the full text only when a request calls for it. They
 * execute in a code-execution container, so enabling them also enables that
 * tool and the two betas below.
 *
 * Missing registry (skills never uploaded) is not fatal — the service falls
 * back to the base identity prompt alone and says so at boot.
 */
const REGISTRY = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'skills.json'), 'utf8'));
  } catch {
    return {};
  }
})();

/**
 * The Messages API allows at most 8 skills per request, so the set is chosen
 * per request rather than attaching everything.
 *
 * CORE is always on — it is what makes an answer Blayne's rather than generic:
 * the Repository router, the six-phase method, the brand system, and the
 * writing bar. The remaining four follow the Product Map layer the client is
 * working in, which is the best signal available about what they need.
 */
const CORE_SKILLS = [
  'bbip',
  'blayne-methodology',
  'blayne-brand-guidelines',
  'blayne-executive-writing-standard',
];

const SKILLS_BY_CATEGORY = {
  features: ['business-consultant', 'proposal-writer', 'market-research', 'report-writer'],
  'job-roles': [
    'business-consultant',
    'product-manager',
    'sales-consultant',
    'executive-communication',
  ],
  departments: [
    'business-consultant',
    'solutions-architect',
    'technical-writer',
    'regulatory-research',
  ],
  startups: [
    'business-consultant',
    'market-research',
    'investor-relations',
    'product-marketing',
  ],
};

const MAX_SKILLS = 8;

/** Resolves skill names to API references, dropping any that were never uploaded. */
function selectSkills(category) {
  const names = [...CORE_SKILLS, ...(SKILLS_BY_CATEGORY[category] ?? SKILLS_BY_CATEGORY.features)];
  return names
    .filter((n) => REGISTRY[n])
    .slice(0, MAX_SKILLS)
    .map((n) => ({ type: 'custom', skill_id: REGISTRY[n].skill_id, version: 'latest' }));
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY / an `ant auth login` profile

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
 * of something generic. The files live in Anthropic's Files API; Postgres
 * only holds the pointer (see supabase/schema.sql).
 */
const BRAND_FILES_BETA = 'files-api-2025-04-14';
const MAX_BRAND_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_BRAND_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
]);

const brandUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BRAND_FILE_BYTES, files: 5 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_BRAND_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`"${file.originalname}" isn't a supported file type.`));
  },
});

async function listBrandAssets(userId) {
  const { data, error } = await supabaseAdmin
    .from('brand_assets')
    .select('id, file_name, mime_type, size_bytes, anthropic_file_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Client-facing shape — anthropic_file_id is an implementation detail. */
const publicAsset = ({ anthropic_file_id, ...rest }) => rest;

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
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasSupabase,
    skills: Object.keys(REGISTRY).length,
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

  const created = [];
  try {
    for (const file of files) {
      const uploaded = await client.beta.files.upload({
        file: await toFile(file.buffer, file.originalname, { type: file.mimetype }),
        betas: [BRAND_FILES_BETA],
      });

      const { data, error } = await supabaseAdmin
        .from('brand_assets')
        .insert({
          user_id: req.userId,
          file_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          anthropic_file_id: uploaded.id,
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
    .select('id, anthropic_file_id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId) // service role bypasses RLS — this check is the real guard
    .maybeSingle();
  if (findError) {
    console.error('[blayne] brand asset lookup failed:', findError.message);
    return res.status(500).json({ error: 'Could not remove that file.' });
  }
  if (!asset) return res.status(404).json({ error: 'File not found.' });

  try {
    await client.beta.files.delete(asset.anthropic_file_id, { betas: [BRAND_FILES_BETA] });
  } catch (err) {
    // Already gone on Anthropic's side shouldn't block removing our own record of it.
    if (err?.status !== 404) console.error('[blayne] Anthropic file delete failed:', err.message);
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
  try {
    brandAssets = await listBrandAssets(req.userId);
  } catch (err) {
    console.error('[blayne] brand asset lookup failed:', err.message);
    // Non-fatal — proceed without brand context rather than fail the whole chat.
  }

  const { category, topic } = req.body ?? {};
  // The full session history is resent on every turn, so `messages.length === 1`
  // reliably means "the first message of this session" — see server/blaynePrompt.js.
  const needsBrandAsk = messages.length === 1 && brandAssets.length === 0;
  const system = buildSystem(category, topic, { needsBrandAsk });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const skills = selectSkills(category);
  const needsContainer = skills.length > 0 || brandAssets.length > 0;

  const betas = [];
  if (needsContainer) betas.push('code-execution-2025-08-25');
  if (skills.length) betas.push('skills-2025-10-02');
  if (brandAssets.length) betas.push(BRAND_FILES_BETA);

  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    ...(needsContainer
      ? {
          // `container` must be omitted, not `{}`, when there are no skills to
          // attach — an empty object 400s ("should be a valid string"); the
          // API creates a fresh container implicitly when the key is absent.
          ...(skills.length ? { container: { skills } } : {}),
          tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
        }
      : {}),
  };

  /*
   * Brand documents ride in the code-execution container (not a `document`
   * content block) because a brand manual is as likely to be a .docx or
   * .pptx as a PDF, and the container's Python environment — already
   * attached for skills — reads all of those; a bare `document` block only
   * understands PDF/plain text. Attached once, on the session's very first
   * user turn: the full history is resent every request, so it stays "in
   * context" for the rest of the session without re-uploading, and the
   * cache_control breakpoint keeps the repeat sends cheap.
   */
  const turns = messages.map((m, i) => {
    if (i !== 0 || brandAssets.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        ...brandAssets.map((asset, idx) => ({
          type: 'container_upload',
          file_id: asset.anthropic_file_id,
          ...(idx === brandAssets.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        })),
        { type: 'text', text: m.content },
      ],
    };
  });

  let containerId;
  let resumes = 0;

  try {
    while (true) {
      const stream = client.beta.messages.stream({
        ...request,
        ...(containerId ? { container: containerId } : {}),
        messages: turns,
        betas: betas.length ? betas : undefined,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          send({ type: 'text', text: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      containerId = final.container?.id ?? containerId;

      if (final.stop_reason === 'pause_turn' && resumes < MAX_RESUMES) {
        turns.push({ role: 'assistant', content: final.content });
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
    // No credentials at all throws without a status, so match on the message.
    const noCredentials = status === 401 || /resolve authentication method/i.test(raw);

    const message = noCredentials
      ? 'B.L.A.Y.N.E is not connected yet — the server has no Anthropic API key. Set ANTHROPIC_API_KEY (see .env.example) and restart it.'
      : status === 429
        ? 'Rate limited by the Anthropic API. Try again shortly.'
        : status >= 500
          ? 'The Anthropic API is unavailable right now. Try again shortly.'
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
    Object.keys(REGISTRY).length
      ? `[blayne] ${Object.keys(REGISTRY).length} Blayne skills registered (max ${MAX_SKILLS} attached per request)`
      : '[blayne] no skills registry — running on the base identity prompt only (npm run skills:upload)',
  );
  console.log(
    hasSupabase
      ? `[blayne] Supabase auth active — ${DAILY_LIMIT} messages/day/tester`
      : '[blayne] no Supabase config — /api/chat and /api/usage will return 503 (see .env.example)',
  );
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[blayne] ANTHROPIC_API_KEY is not set — /api/chat will fail once auth passes.');
  }
});
