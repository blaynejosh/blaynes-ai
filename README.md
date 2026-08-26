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

### Brand documents

A tester can attach brand materials (manual, deck, logo) from the chat surface — `POST/GET/DELETE /api/brand-assets` in `server/index.js`. The bytes live in Cloud Storage (`server/uploadStorage.js`, bucket `BLAYNE_UPLOADS_BUCKET`), not Anthropic's Files API: Vertex AI doesn't support the Files API or the code-execution container (see below), so there's nowhere to upload a file to *once* and just reference afterwards.

Instead, each file is read back from GCS and sent as an inline content block on the first turn of a session — `document` (base64) for PDFs, `image` for PNG/JPEG/WebP, and the raw decoded text for plain text/Markdown/CSV. That's why binary Office formats (`.doc`/`.docx`/`.ppt`/`.pptx`) aren't accepted: Claude's inline `document` block only understands PDF and text, so a Word doc or deck needs exporting to PDF first. A `cache_control` breakpoint on the last block keeps the repeat sends (the full history, and everything attached to it, goes out again on every turn) cheap after the first.

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

**Custom domain:**

```bash
gcloud run domain-mappings create --service=blayne-web --domain=yourdomain.com --region=us-central1
```

Add the DNS records it prints, then update both Supabase (**Authentication → URL Configuration** — Site URL + Redirect URLs) and the Google OAuth client (**Authorized JavaScript origins**) to the production domain.

## Known gaps

- `src/BlayneNeuralGem.jsx` is an earlier three.js experiment that nothing imports. It keeps `three`, `@react-three/fiber`, `@react-three/drei`, and `@react-three/postprocessing` in `dependencies` — remove all five together if it isn't wanted.
- The client bundle inlines the backdrop SVGs (~62KB of the grid alone), which is most of the bundle size. Kept inline for exactness.
- Search in the header currently routes to `/features`; there is no search surface in any design yet.
