#!/usr/bin/env bash
# Provisions a fresh GCP project for a B.L.A.Y.N.E environment (a staging
# environment, or standing up prod again from scratch) — every step in the
# README's "Deploying" section that has a gcloud/gsutil equivalent, run once
# per project instead of retyped by hand.
#
# What this does NOT do (no CLI for these — see the reminder printed at the
# end):
#   - Accept the Claude model terms in Vertex AI -> Model Garden
#   - Create the Supabase project, run supabase/schema.sql, or configure
#     OAuth providers
#
# Usage:
#   ./scripts/setup-gcp-project.sh PROJECT_ID [REGION]
#
# Requires: gcloud authenticated (gcloud auth login) with permission to
# create resources in PROJECT_ID, and billing already linked to that
# project. Run from anywhere — paths below are relative to this script.

set -euo pipefail

PROJECT_ID="${1:?Usage: $0 PROJECT_ID [REGION]}"
REGION="${2:-us-central1}"
REPO="blayne"
# Bucket names are globally unique across all of GCS, not just this project —
# prefixing with PROJECT_ID (itself globally unique) avoids colliding with
# the prod buckets (blayne-skills-bbip / blayne-user-uploads) or anyone
# else's bucket of the same short name.
SKILLS_BUCKET="${PROJECT_ID}-blayne-skills"
UPLOADS_BUCKET="${PROJECT_ID}-blayne-uploads"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Project: $PROJECT_ID   Region: $REGION =="
echo

echo "-- Enabling required APIs --"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  --project="$PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "Runtime service account: $RUNTIME_SA"
echo

echo "-- Artifact Registry repo --"
if gcloud artifacts repositories describe "$REPO" \
    --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  echo "  already exists"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
fi
echo

echo "-- Vertex AI IAM binding (roles/aiplatform.user for the runtime SA) --"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role=roles/aiplatform.user \
  --condition=None \
  --quiet
echo

echo "-- GCS buckets --"
if gsutil ls -p "$PROJECT_ID" "gs://${SKILLS_BUCKET}" >/dev/null 2>&1; then
  echo "  gs://${SKILLS_BUCKET} already exists"
else
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${SKILLS_BUCKET}"
fi
if gsutil ls -p "$PROJECT_ID" "gs://${UPLOADS_BUCKET}" >/dev/null 2>&1; then
  echo "  gs://${UPLOADS_BUCKET} already exists"
else
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${UPLOADS_BUCKET}"
fi

gsutil iam ch "serviceAccount:${RUNTIME_SA}:roles/storage.objectViewer" "gs://${SKILLS_BUCKET}"
gsutil iam ch "serviceAccount:${RUNTIME_SA}:roles/storage.objectAdmin" "gs://${UPLOADS_BUCKET}"
echo

echo "-- Pushing skill Markdown to gs://${SKILLS_BUCKET} --"
if [ -d "$ROOT/blayne_skills" ]; then
  BLAYNE_SKILLS_BUCKET="$SKILLS_BUCKET" GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
    npm --prefix "$ROOT" run skills:upload
else
  echo "  skipped: $ROOT/blayne_skills not found locally (gitignored — skill"
  echo "  content is data, not code; pull it before running this, or run"
  echo "  'npm run skills:upload' yourself later with BLAYNE_SKILLS_BUCKET=$SKILLS_BUCKET"
fi
echo

cat <<EOF
== Done: GCP side of $PROJECT_ID is provisioned. ==

Still manual — no gcloud/gsutil equivalent exists:

  1. Cloud Console -> Vertex AI -> Model Garden -> Claude -> enable the
     model(s) BLAYNE_MODEL will request (default claude-opus-5), for
     project $PROJECT_ID.

  2. Create a Supabase project for this environment, then in its SQL
     Editor paste and run supabase/schema.sql (safe to re-run, every
     statement is idempotent).

  3. In that Supabase project: Authentication -> Providers, configure
     Google/Apple OAuth the same way as production. Then once you know
     this environment's Cloud Run URL or custom domain, Authentication ->
     URL Configuration -> set Site URL / Redirect URLs to it.

Resources created:
  Artifact Registry repo:   ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}
  Skills bucket:            gs://${SKILLS_BUCKET}
  Uploads bucket:           gs://${UPLOADS_BUCKET}
  Runtime service account:  ${RUNTIME_SA}

Next — build and deploy (see README "Deploying"), pointing at this project:

  gcloud builds submit --config cloudbuild.yaml --project=$PROJECT_ID \\
    --substitutions=_REGION=$REGION,_SERVICE=blayne-web,_VITE_SUPABASE_URL="...",_VITE_SUPABASE_ANON_KEY="..."

  gcloud run deploy blayne-web \\
    --project=$PROJECT_ID \\
    --image=${REGION}-docker.pkg.dev/$PROJECT_ID/${REPO}/blayne-web:\$(git rev-parse --short HEAD) \\
    --region=$REGION \\
    --allow-unauthenticated \\
    --timeout=600 \\
    --set-secrets=SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest \\
    --set-env-vars=VITE_SUPABASE_URL=...,BLAYNE_DAILY_LIMIT=25,ANTHROPIC_VERTEX_PROJECT_ID=$PROJECT_ID,CLOUD_ML_REGION=global,BLAYNE_SKILLS_BUCKET=$SKILLS_BUCKET,BLAYNE_UPLOADS_BUCKET=$UPLOADS_BUCKET
EOF
