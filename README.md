# B.L.A.Y.N.E AI

**Business Leading Agent Yielding Next-Gen Enterprise Strategies** — the web front end and API for Blayne's Consulting's AI consultant.

> Internal — Confidential. This repository contains Blayne's Consulting's behavioural specification and Product Map. Keep it private.

---

## What's in here

Two surfaces, one Vite/React app:

| Surface | Route | What it is |
|---|---|---|
| Marketing home | `/` | Hero, value statement, the four Product Map layers, footer |
| Chat product | `/features`, `/job-roles`, `/departments`, `/startups` | The B.L.A.Y.N.E chat surface, one route per Product Map layer |

The hero's four **Explore** pills cross from the marketing page into the chat product.

## Running it

```bash
npm install
cp .env.example .env    # then point it at your GCP project (see below)
gcloud auth application-default login
npm run dev:all
```

`dev:all` runs the Vite dev server (`:5173`) and the API server (`:8787`) together. Vite proxies `/api` to the API server.

| Script | Purpose |
|---|---|
| `npm run dev` | Front end only — chat will error without the API running |
| `npm run server` | API only |
| `npm run dev:all` | Both |
| `npm run build` | Production build of the front end |
| `npm run extract:hero` | Regenerate the SVG-derived React components |
| `npm run extract:hero:audit` | Print what each extracted layer range covers |
| `npm run skills:list` | Show which Blayne skills are in the GCS bucket |
| `npm run skills:upload` | Push `blayne_skills/*.md` to the GCS bucket |

`GET /api/health` reports whether a Vertex project id was picked up and which GCS buckets skills/uploads are read from.

## Architecture

```
src/            React front end (no API key ever reaches here)
  components/   Hero, Product Map sections, chat surface
  data/         Product Map content + hero geometry
  lib/          Stage/fan geometry helpers, SSE chat client
server/         Node API — calls Claude on Vertex AI, streams answers
design/         Source SVG exports the components are generated from
scripts/        SVG → React extraction
```

### The design pipeline

The hero, Product Map sections, and chat backdrop are generated from the Figma exports in `design/` by `scripts/extract-hero-svg.mjs`. The exports have their type outlined to paths, so the script keeps the decorative artwork as vector and drops the text and chrome, which the components rebuild as real HTML — selectable, translatable, and screen-reader readable.

Geometry is reproduced faithfully: the artboards are 1440×1024, and `src/lib/stage.js` maps design pixels to container-query units so the composition holds at any width. `src/lib/fan.js` regenerates the Features-page curve bundle for any item count, since the export only contains the 20-item version.

**If a design is re-exported from Figma, re-check the line ranges** in `scripts/extract-hero-svg.mjs` with `npm run extract:hero:audit` before regenerating.

### The API

`server/index.js` exists so nothing Claude-related reaches the browser. It adds B.L.A.Y.N.E's base identity prompt, calls Claude on Google Cloud Vertex AI (`AnthropicVertex`, Application Default Credentials — no API key), and streams the answer back as Server-Sent Events.

`server/blaynePrompt.js` holds that identity prompt, compiled from **Personality & Consulting Methodology v1.0** (Document 6). That document specifies it as the top prompt layer that nothing downstream may override — treat edits to it as changes to the product's behaviour, not copy tweaks. It's also the cached prefix, so editing it invalidates the prompt cache for every conversation.

### The Blayne skills

The identity prompt sets *how* B.L.A.Y.N.E. behaves. The **skills** are what it knows: the six-phase methodology, the brand system, the writing standards, and the specialist playbooks the `bbip` router indexes. Each skill is a Markdown file in Google Cloud Storage (`gs://blayne-skills-bbip/blayne_skills/<name>.md`), fetched by `server/skillStorage.js` and spliced straight into the system prompt (`buildSystem` in `server/blaynePrompt.js`) as its own `cache_control` breakpoint — no Anthropic-hosted skill resource involved.

Source files live locally in `blayne_skills/` (gitignored — skill content is data, not code). Edit a `.md` there and run `npm run skills:upload` to push it; the bucket object is overwritten immediately, no versioning. The server fetches lazily on first use per skill name and caches in memory for the life of the process, so a redeploy is needed to pick up an edit (or restart the process).

`server/index.js` attaches a fixed Blayne core on every call — `bbip`, `methodology`, `business_brand_guidelines`, `writing_standards` (see `CORE_SKILLS`). The other 16 specialist skills (`ROUTABLE_SKILLS`) aren't pre-loaded: `bbip`'s own routing table (section 3, "How routing works") tells the model which category a request falls into, and the model acts on that by calling the `load_skill` tool (`SKILL_TOOL`) — the server fetches that one skill's text from GCS and feeds it back as a `tool_result`, then the model continues. A request spanning several categories calls it several times in the same turn. A skill that fails to load (never uploaded, no GCS credentials, or an unknown name) comes back as a `tool_result` error rather than failing the request.

Document-production and visual-design skills in the bucket (`editor`, `proofreader`, `document-formatter`, `image-designer`, and similar) are deliberately left out of `ROUTABLE_SKILLS` — this chat surface renders Markdown, not files, so the model has nothing to do with them yet.

Auth to GCS is Application Default Credentials, not an env var: `gcloud auth application-default login` locally, the runtime service account on Cloud Run/GCE when deployed. `BLAYNE_SKILLS_BUCKET` overrides the bucket name if you're not using `blayne-skills-bbip`.

### Service routing (Blayne's Consulting's own catalogue)

B.L.A.Y.N.E is aware of Blayne's Consulting's own 6-category, 30-service catalogue and recommends it, first, when a conversation reaches a genuine execution moment ("we need someone to build this," "nobody here knows Zoho") — never for pure strategy questions. This is backend-only: the catalogue is never sent to the browser, never listed to the user, never exposed by an API response. See `server/catalogue/` and `blayne_skills/service_routing.md`.

- **The catalogue** (`catalogue/blaynes-services.json`) is a reviewed, git-tracked file — a change to it is a real PR, not an incidental edit. Bump `version` and `last_verified` when you touch it. Uploaded to GCS (same bucket as skills, `catalogue/` prefix) with `npm run catalogue:upload`, loaded and schema-validated at server *boot* (`server/catalogue/loader.js`) — unlike skills, a missing or invalid catalogue is a hard startup failure, not a soft degrade, since routing on broken data is worse than not routing at all.
- **Matching** is hybrid: lexical (name + aliases, normalized, stemmed) plus semantic (Vertex AI `text-embedding-005` — a separate surface from Claude; see `server/catalogue/embeddings.js`). Embeddings are precomputed once with `npm run catalogue:embeddings` (run this after any catalogue edit, before `catalogue:upload`) — 30 rows never need re-embedding at request time. Thresholds are calibrated to under-recommend on purpose; see the comment block at the top of `server/catalogue/search.js`.
- **Alias tuning without a deploy** (Phase 8): aliases drift from what real users type, and tuning them shouldn't need an engineer. `catalogue_alias_overrides` (Supabase) is a live-editable layer on top of the reviewed catalogue, edited directly in the Supabase Table Editor; every change is captured in `catalogue_alias_audit` by a trigger, automatically, regardless of what wrote the row.
- **Frequency cap and observability**: `routing_state` (per-thread, so a recommendation doesn't repeat in one conversation) and `routing_events` (every decision, CTA click, and guardrail repair) are new Supabase tables — see `supabase/schema.sql`. No existing analytics pipeline exists in this app to plug into instead.
- **Guardrails** (`server/guardrails.js`) run once the model's full turn text is known and append a correction if disclosure is missing, the model denies the commercial relationship, a price is quoted for Blayne's Consulting, or an unverified external company name shows up with no caveat nearby. Because this app streams live, a repair can only append a correction after the fact, not retroactively edit tokens already sent — see the comment at the top of that file.
- **Build-time leak check**: `npm run build` now also runs `scripts/check-no-catalogue-leak.mjs`, which fails the build if any catalogue string ends up in `dist/`.
- **Eval suite**: `npm test` runs the Phase 7 golden set (`test/golden-cases.mjs`, 40 cases) against the matcher and guardrails with no live GCP credentials needed (lexical-only fallback). It does not, and cannot, verify live-model prose quality or true prompt-injection resistance — see the note at the bottom of `test/golden-cases.mjs`.
- **Freshness**: `npm run catalogue:check-freshness` re-reads `blaynes.consulting/services` and diffs it against the local file, opening a GitHub review issue (or writing a local report) on drift — never auto-merging scraped content. Meant to run weekly via Cloud Run Job + Cloud Scheduler; see the gcloud commands at the bottom of that script.

### Brand documents

A tester can attach brand materials (manual, deck, logo) from the chat surface — `POST/GET/DELETE /api/brand-assets` in `server/index.js`. The bytes live in Cloud Storage (`server/uploadStorage.js`, bucket `BLAYNE_UPLOADS_BUCKET`), not Anthropic's Files API: Vertex AI doesn't support the Files API or the code-execution container (see below), so there's nowhere to upload a file to *once* and just reference afterwards.

Instead, each file is read back from GCS and sent as an inline content block on the first turn of a session — `document` (base64) for PDFs, `image` for PNG/JPEG/WebP, and the raw decoded text for plain text/Markdown/CSV. That's why binary Office formats (`.doc`/`.docx`/`.ppt`/`.pptx`) aren't accepted: Claude's inline `document` block only understands PDF and text, so a Word doc or deck needs exporting to PDF first. A `cache_control` breakpoint on the last block keeps the repeat sends (the full history, and everything attached to it, goes out again on every turn) cheap after the first.

### Brand Kit / Document Engine

A separate feature from the brand-document attachments above — that flow is per-user, unparsed, chat-context-only material; this one (`server/brandKit/`) is the versioned, per-organization design system a document-generation pipeline renders against. See the Phase 0 discovery report and Phase 1 report (this feature's own planning conversation) for the full brief; short version below.

**Tenancy.** Everything up to this feature was keyed on `auth.users.id` directly — one login, one account, no company above it. `organizations`/`organization_members` (`supabase/schema.sql`, or `supabase/migration_brand_kit.sql` to add this on its own) is the tenant boundary Brand Kit needs: every account gets a personal, one-member organization automatically at signup (`handle_new_user()`), and existing accounts are backfilled the same way. `server/brandKit/tenant.js`'s `requireOrg` middleware resolves it on every Brand Kit request.

**Asset ingestion** (`server/brandKit/ingest.js` + `server/brandKit/extractors/`) — `POST /api/brand-kit/assets` (multipart, field `kind` plus `files`) handles seven upload kinds, each validated, virus-scanned (blocking — see below), and deterministically extracted before anything is stored:

| kind | formats | extraction |
|---|---|---|
| `guideline` / `corporate_profile` / `sample_document` | PDF, DOCX, PPTX | PDF: real per-page text *and* rendered page images (via `pdf-parse` v2 → pdfjs-dist + `@napi-rs/canvas`, no system Poppler/LibreOffice dependency). DOCX/PPTX: text only in this phase — page images need a real layout engine (LibreOffice), which only exists once the Phase 3 render container does; exporting to PDF first is the workaround until then. |
| `logo` | SVG, PNG, JPG | dimensions, real transparency (pixel-scanned, not just "does the format have an alpha channel"), light/dark tone. A safe white/on-dark variant is derived automatically, but only from a single-colour SVG — never from a raster logo, and never when the SVG has more than one colour. |
| `palette` | image, PDF, `.ase`, text/CSV | hex parsing from text, a hand-rolled Adobe Swatch Exchange parser (RGB/CMYK/Lab/Gray), dominant-colour clustering from a swatch image. |
| `font` | TTF, OTF, WOFF, WOFF2 | real internal family name (`fontkit`, not the filename), OS/2 `fsType` licensing bits. WOFF/WOFF2 get converted to a real TTF (`fonteditor-core`) for the future render container — fonts start **unattested**; `POST /api/brand-kit/assets/:id/license-attestation` is the only way to flip that, and nothing downstream may use a font until it's set. |
| `icon_set` | SVG, PNG, icon font (TTF/…) | viewBox, stroke weight, line/solid/mixed style. |

**Virus scanning is blocking, not advisory** (`server/brandKit/virusScan.js`): every buffer is scanned before any parser touches it. It talks to a clamd daemon over TCP (`CLAMD_HOST`/`CLAMD_PORT`); without one configured, uploads are refused outright unless `BRAND_KIT_SKIP_VIRUS_SCAN=true` is set (dev-only, loudly logged every time). Real clamd, not a mock, backs this in both places that matter:

- **Local dev**: `docker compose up -d clamd` (`docker-compose.yml`), then `CLAMD_HOST=localhost`. First boot takes ~15-30s to download virus definitions before the socket appears.
- **CI**: `.github/workflows/ci.yml` runs the same `clamav/clamav:stable` image as a service container, gated on a health check, with `CLAMD_HOST=localhost` set for the test job — `test/brand-kit-virus-scan.test.js` actually submits the standard EICAR test string and asserts ClamAV flags it, not just that the code compiles.
- **Production**: still unstood-up — a deployed environment needs a real reachable clamd (Cloud Run sidecar, or a small separate service) before Brand Kit uploads will work there; until then every upload in production is refused, correctly, per the fail-closed design.

**The manual path** (`server/brandKit/manualKit.js`, `POST /api/brand-kit/manual`) — a name, two colours, an already-uploaded logo, and a layout-style preset (`minimal_light` / `bold_dark` / `corporate_classic`) produce an immediately-`active` kit. Safe to skip the confirmation step entirely here, unlike the extraction path below: every field is either what the user just typed or an explicit, labelled system default, never a guess.

Every kit is validated against `brand-kit.schema.json` (repo root) before it's stored — `server/brandKit/schema.js`, which also validates Document IRs against `document-ir.schema.json` for the assembly stage below. Only one kit per organization may be `status: 'active'` at a time, enforced by a partial unique index in Postgres, not just application code.

**Extraction and confirmation** (`server/brandKit/extraction/`, `POST /api/brand-kit/extract`) — the one Claude call in the whole pipeline, and the only place uploaded content reaches a model. Everything upstream (the extractors above) is deterministic; everything downstream (`proposals.js`, `finalizeDraft.js`) is a pure, model-free function, independently unit-tested (`test/brand-kit-proposals.test.js`). The model sees guideline/profile page text and images plus a list of deterministically-extracted colour candidates, and must call `propose_brand_kit_fields` — never free text — citing a real `asset_id` and page number for every value. Two independent checks keep a hallucinated proposal from ever reaching storage: `path` must be one of a fixed allowlist (`PATH_SPECS` in `proposals.js`), and `source_asset_id` must be one of the assets actually shown that run — anything else is dropped and logged, not trusted. Every accepted field lands with `confirmed: false`; `finalizeDraft.js` fills any still-missing schema-required field (colours, typography, identity name) with a clearly-labelled, deliberately low-confidence system default rather than leaving the draft schema-invalid.

The confirmation screen (`src/components/brandKit/BrandKitReview.jsx`, at `/brand-kit/review/:id`) is a preview panel — `server/brandKit/tokens.js`'s `resolveTokens()`, pulled forward from Phase 3's token-resolution layer since the preview needs it and it's pure/model-free — next to every field, sorted lowest-confidence-first, each editable or acceptable individually. `POST /drafts/:id/confirm` is the only path to `active`: it refuses unless every `provenance` entry is `confirmed: true` and the kit passes full schema validation, then archives whatever was active before it. `/brand-kit` (`BrandKitHome.jsx`) is the entry point — upload material per kind, the manual two-minute path, or trigger extraction — reachable from the account menu.

**The renderer** (`server/brandKit/render/`) — deterministic, no model in the loop: Document IR (`document-ir.schema.json`) plus a resolved Brand Kit in, a real `.docx` or `.pdf` out. Three layers, matching the brief exactly:

1. **Token resolution** — `tokens.js` (built in Phase 2, since the confirmation preview needed it too). Runs the contrast guards here, not at render time.
2. **Block renderers** — one SVG component per exhibit type (`render/svg/*.js`: `kpi_row`, `card_grid`, `numbered_phases`, `process_flow`, `timeline`, `roadmap`, `matrix_2x2`, `comparison_matrix`, `decision_tree`, `org_chart`, `journey_map`, every `chart_type`), all built on one shared, real text-measurement layout engine (`render/layout.js`, via `@napi-rs/canvas` — the same library `pdf-parse` already depends on for page rendering). `table`, `image`, and `quote` render natively per format instead of as a graphic — a real editable Word table, a real image, real styled text — see `render/exhibitToSvg.js`'s doc comment for why those three are the exception.
3. **Format adapters** — `render/docx.js` (`docx` library: real headings/tables/numbered-and-bulleted lists, an SVG exhibit rasterized and embedded as `ImageRun`, every gotcha in the brief — DXA page/table/cell sizing, `ShadingType.CLEAR`, no literal bullet characters, a page break living inside a paragraph, an explicit `ImageRun` type, `display_never_bold` checked by *font family*, not by which block asked for it, since `typography.heading` can alias to `typography.display`) and `render/html.js` + Playwright (`render/index.js`) for `.pdf` — a real headless-Chromium render, not a docx-to-PDF conversion, so it gets the rounded corners/shadows/precise spacing a Word table can't express. A tenant's font is embedded straight into the HTML as a base64 `@font-face` rule when its Brand Kit asset is both `license_attested` and `embedding_permitted` — never installed onto the render machine's filesystem (a deliberate departure from the brief's "install fonts into the container, then clear them," reasoned through in `render/fonts.js`'s doc comment).

Two hard gates live in `render/guards.js` and are enforced by both formats independently: an attributed quote with no `consent_recorded` refuses to render, and a `generated`-origin image always carries a visible "AI-generated image" note.

`POST /api/brand-kit/render-preview?format=pdf|docx` (body: a raw Document IR) is a **Phase 3 test/manual-verification harness**, kept as-is now that Phase 4's real pipeline exists below — synchronous, against the org's active Brand Kit, no job row, for exercising the renderer itself against a hand-written or fixture IR without paying for a model call. `npm run render:preview -- <ir.json> <brandKit.json> <out.pdf|out.docx>` does the same thing fully locally (no Supabase/GCS/Vertex needed) — real output, verified end to end including inside `Dockerfile.render`, the dedicated render container (Debian-based `node:22-slim`, not the main image's Alpine, because Playwright's Chromium needs glibc; Chromium is installed via the npm package at build time rather than pinned to Microsoft's own image, since that image's tags lag the npm registry).

**Document generation** (`server/brandKit/documents/`, Phase 4) — the real pipeline the confirmation and render layers above exist to serve. `POST /api/brand-kit/documents` (body: `doc_type`/`title`/`format`/`brief`) requires an active Brand Kit, writes a `queued` row, and kicks off `processDocument()` fire-and-forget in the same process — see `documents/jobs.js`'s doc comment for why an in-process async function is enough to prove the pipeline end to end today, and what swapping in real "Cloud Tasks → Cloud Run Job" dispatch later would (and wouldn't) change. The response comes back immediately with just the job id; nothing waits on the model or the renderer. `documents/assembleIr.js` is the one model call in this pipeline: given the brief and the org's Brand Kit voice/identity fields only (never colours/fonts — those stay the renderer's decision, per `document-ir.schema.json`'s own description), it forces a single `emit_document_ir` tool call that must produce the entire document as one Document IR, retrying — with the exact `validateDocumentIr()` ajv errors fed back as the correction — up to 3 times on a schema failure, since a large nested IR has no safe partial-acceptance path the way a flat list of Brand Kit proposals does. Once assembled, the same `render/index.js` from Phase 3 renders it against the org's Brand Kit and the file lands in storage. `GET /api/brand-kit/documents` / `/documents/:id` poll status through `queued` → `assembling` → `rendering` → `complete`/`failed`, and `/documents/:id/download-url` only issues a signed URL once a document is `complete`. `generate_document` (`server/index.js`, described to the model in `blaynePrompt.js`) is this same pipeline's chat entry point — Blayne calls it once a conversation has actually settled on scope, audience, and content, and tells the client it's a background job rather than waiting on the turn for a file. `src/components/brandKit/DocumentsPage.jsx` (`/documents`, linked from the account menu) is the client-facing counterpart — every queued/in-flight/finished document for the org, status badges, auto-polling while anything is still in flight, and a download button once it's ready; generation itself is only ever started from chat, so there's no "new document" form on the page itself.

## Deploying

The front end builds to static files, but **the API needs a Node runtime** — a static-only host will serve the site with every chat failing. `server/index.js` already serves the built `dist/` and falls back to `index.html` for client routes (`/login`, `/features`, …) in production, so one process handles both.

**Claude runs through Google Cloud Vertex AI**, via the `AnthropicVertex` client (`@anthropic-ai/vertex-sdk`) — no Anthropic API key anywhere. Auth is the same Application Default Credentials the skill/upload buckets already use: `gcloud auth application-default login` locally, the runtime service account on Cloud Run/GCE when deployed — it needs the `roles/aiplatform.user` IAM role, and the Claude models used (`BLAYNE_MODEL`, default `claude-opus-5`) need to be enabled for the project in Vertex AI Model Garden. Set `ANTHROPIC_VERTEX_PROJECT_ID` (and `CLOUD_ML_REGION` if you're not using the recommended `global`) as plain env vars — neither is secret, they're just config.

### Google Cloud Run

`Dockerfile`, `.dockerignore`, and `cloudbuild.yaml` are in the repo. The one thing worth understanding before running any commands: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not secret, but Vite bakes them into the static JS bundle at **build** time — they have to arrive as Docker `--build-arg`s, not as a Cloud Run runtime env var, or the deployed site throws "Missing VITE_SUPABASE_URL" in the browser.

```bash
# One-time setup
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com
gcloud artifacts repositories create blayne --repository-format=docker \
  --location=us-central1

# Vertex AI — let the Cloud Run runtime service account call Claude
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/aiplatform.user
# Then, in the Cloud Console: Vertex AI -> Model Garden -> Claude -> enable
# the models BLAYNE_MODEL will request (default claude-opus-5).

# Secrets (server-side only — never baked into the client bundle)
echo -n "eyJ..." | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-

# Skills + uploads buckets (one-time) — grant the Cloud Run runtime service
# account access, then push the skill Markdown from blayne_skills/
gsutil mb -l us-central1 gs://blayne-skills-bbip
gsutil iam ch serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com:roles/storage.objectViewer \
  gs://blayne-skills-bbip
npm run skills:upload

gsutil mb -l us-central1 gs://blayne-user-uploads
gsutil iam ch serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com:roles/storage.objectAdmin \
  gs://blayne-user-uploads

# Build (Cloud Build — no local Docker needed)
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_VITE_SUPABASE_URL="https://your-project.supabase.co",_VITE_SUPABASE_ANON_KEY="eyJ..."

# Deploy
gcloud run deploy blayne-web \
  --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/blayne/blayne-web:$(git rev-parse --short HEAD) \
  --region=us-central1 \
  --allow-unauthenticated \
  --timeout=600 \
  --set-secrets=SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest \
  --set-env-vars=VITE_SUPABASE_URL=https://your-project.supabase.co,BLAYNE_DAILY_LIMIT=25,ANTHROPIC_VERTEX_PROJECT_ID=YOUR_PROJECT_ID,CLOUD_ML_REGION=global
```

`--timeout=600` matters — chat answers stream over a long-lived connection, and Cloud Run's default 300s timeout is tight for a long consulting answer with skills and adaptive thinking. `--set-secrets` maps a Secret Manager secret into the container at runtime, access-controlled separately from the Cloud Run service config; a plain `--set-env-vars` value is visible to anyone with viewer IAM on the project.

### A second environment (staging, or standing prod up again)

`scripts/setup-gcp-project.sh PROJECT_ID [REGION]` scripts everything above
that has a `gcloud`/`gsutil` equivalent — enabling APIs, the Artifact
Registry repo, the Vertex AI IAM binding, both GCS buckets with their IAM
grants, and pushing the skill set — against a **different** GCP project, so
a staging environment doesn't share Vertex AI quota, buckets, or IAM with
production. Run it once per new project:

```bash
./scripts/setup-gcp-project.sh blayne-ai-staging
```

It prints the `gcloud builds submit` / `gcloud run deploy` commands for that
project at the end, with bucket names and project id already filled in.

Two things it can't do for you, because no CLI exists for either:

1. Accept the Claude model terms in **Vertex AI → Model Garden** for the new
   project (one console click).
2. Create the Supabase project for this environment, run
   `supabase/schema.sql` in its SQL Editor, and configure OAuth providers —
   full isolation means a separate Supabase project, not just a separate GCP
   project. (If you're on a Supabase paid plan, its **branching** feature
   gives you an isolated staging database off the *same* project instead —
   no second project or OAuth reconfiguration needed.)

**Custom domain:**

```bash
gcloud run domain-mappings create --service=blayne-web --domain=yourdomain.com --region=us-central1
```

Add the DNS records it prints, then update both Supabase (**Authentication → URL Configuration** — Site URL + Redirect URLs) and the Google OAuth client (**Authorized JavaScript origins**) to the production domain.

## Known gaps

- `src/BlayneNeuralGem.jsx` is an earlier three.js experiment that nothing imports. It keeps `three`, `@react-three/fiber`, `@react-three/drei`, and `@react-three/postprocessing` in `dependencies` — remove all five together if it isn't wanted.
- The client bundle inlines the backdrop SVGs (~62KB of the grid alone), which is most of the bundle size. Kept inline for exactness.
- Search in the header currently routes to `/features`; there is no search surface in any design yet.
- Brand Kit asset ingestion (`server/brandKit/ingest.js`) runs synchronously inside the upload HTTP request — fine for a logo or a font, riskier for a large multi-page guideline PDF (bounded by `BRAND_KIT_MAX_PDF_PAGES`, but still a request the client waits on). Document generation (Phase 4) is already a real background job (`enqueueDocument`/`processDocument`, see the Brand Kit section above); ingestion may need the same treatment once real usage shows it's slow enough to matter.
- Phase 4's document generation dispatch is a fire-and-forget async call inside the same process, not the "Cloud Run Jobs + Cloud Tasks" dispatch `documents/jobs.js`'s doc comment calls out as still undecided — fine for proving the pipeline end to end on one running instance, but a job started right before that instance restarts (a deploy, a crash) is lost mid-render rather than resumed. Matters once a real multi-instance deployment is live, not before.
- ClamAV/clamd exists for local dev (`docker-compose.yml`) and CI (a GitHub Actions service container) but not yet for any deployed environment. Every Brand Kit upload in production is refused until a real clamd is reachable there too — standing that up (a Cloud Run sidecar, or a small separate service) is unstarted ops work, not a code gap.
- DOCX/PPTX brand material gets text extraction only, no rendered page images, until the Phase 3 render container's LibreOffice dependency exists for ingestion to reuse — see the Brand Kit section above.
- Brand Kit extraction (`POST /api/brand-kit/extract`) runs synchronously inside the HTTP request, same scoping call as ingestion above — a guideline with many pages and page images means a genuinely slow request (multiple images sent to Claude in one call). Same "may need to become a real job" note applies.
- `BrandKitReview.jsx`'s field editor infers what control to render from the *current value's shape*, not from `proposals.js`'s `PATH_SPECS` — a composite default (`colors.text`, `typography.display`, `logos`, each covering several leaf values at once) renders read-only with an "Accept as-is" button only; editing one of those requires editing the individual leaf path instead (e.g. `colors.text.heading`), which creates a new, separate provenance entry rather than resolving the composite one. Works, but isn't the cleanest UX yet.
- The manual Brand Kit path only accepts a single logo asset per kit (`logo_asset_ids` takes an array server-side, but `BrandKitHome.jsx`'s form only lets a tester pick one).
- None of the Brand Kit frontend has been exercised against a real Supabase/GCS/Vertex deployment — only build/dev-server-transform smoke tests (see the Phase 2 report). The authenticated upload → extract → review → confirm flow needs a real environment to verify end to end.
- No LibreOffice path exists — the brief marks it optional ("only for converting the .docx when the user wants the PDF to match the editable file exactly"), and the primary PDF path (Playwright + HTML) doesn't depend on it. Add it later only if a real tenant asks for docx/PDF pixel parity specifically.
- Font embedding for `.docx` isn't built — a tenant's font is embedded into the *PDF's* HTML via a base64 `@font-face` rule (`render/fonts.js`), but a generated `.docx` only references the font by name; Word substitutes if the reader doesn't have it installed. Real font embedding inside a `.docx` (Word supports it) would need real support from the `docx` library, not investigated yet.
- `render-preview` (both the HTTP endpoint and the CLI) runs the render synchronously — fine for the small IR documents used to test the renderer itself; a real 20-page report always goes through the Phase 4 job-queue path (`POST /api/brand-kit/documents`) instead, never this endpoint.
- None of the Phase 4 pipeline (`documents/jobs.js`, `documents/assembleIr.js`, `DocumentsPage.jsx`) has been exercised against a real Supabase/GCS/Vertex deployment — only local logic, no test coverage yet either (unlike extraction/render, which have unit tests). A real generation needs a live environment to verify end to end, same caveat as the Brand Kit frontend above.
- No caching yet (Phase 7): resolved token tables, chart/exhibit SVGs, and rasterized PNGs are all recomputed on every render, even for a spec that hasn't changed since the last one.
