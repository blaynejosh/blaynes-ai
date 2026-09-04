/**
 * Phase 5 freshness check — re-reads https://blaynes.consulting/services and
 * diffs it against catalogue/blaynes-services.json (the reviewed, git-tracked
 * source of truth). Never auto-merges scraped content into production; on
 * drift it opens a PR (or, without a GitHub token, writes a local review
 * report) for a human to review the diff, per the spec.
 *
 *   npm run catalogue:check-freshness
 *
 * Intended to run on a schedule (weekly) as a Cloud Run Job triggered by
 * Cloud Scheduler — see the gcloud commands at the bottom of this file.
 * Exits non-zero on drift or a stale last_verified, so it also works as a
 * CI/alerting signal on its own, independent of the PR-opening path.
 *
 * How the site is read: blaynes.consulting is a client-rendered Vite SPA
 * with no API backing it (confirmed by inspecting its bundle — the service
 * catalogue is static data baked into the JS at build time, not fetched at
 * runtime). This script fetches the current bundle and extracts the same
 * category/service object literals the app itself renders from, rather than
 * running a headless browser — no new dependency, and if the site's bundle
 * structure ever changes enough to break this extraction, that failure
 * itself is treated as a signal worth a human's attention (see EXTRACTION
 * FAILURE below), not a silent no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalogue } from '../server/catalogue/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_PATH = path.join(root, 'catalogue', 'blaynes-services.json');
const REPORT_PATH = path.join(root, 'catalogue-freshness-report.json');
const STALE_DAYS = 45;

const catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
validateCatalogue(catalogue);

function findMatchingBracket(s, openPos) {
  let depth = 0;
  for (let i = openPos; i < s.length; i++) {
    if (s[i] === '[') depth += 1;
    else if (s[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

async function fetchLiveCatalogue() {
  const homeRes = await fetch(catalogue.source_url.replace(/\/services\/?$/, '/'));
  if (!homeRes.ok) throw new Error(`Could not fetch ${catalogue.source_url}: HTTP ${homeRes.status}`);
  const html = await homeRes.text();

  const scriptMatch = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/);
  if (!scriptMatch) throw new Error('Could not find the main JS bundle reference in the site\'s HTML — page structure may have changed.');

  const bundleUrl = new URL(scriptMatch[1], catalogue.source_url).toString();
  const bundleRes = await fetch(bundleUrl);
  if (!bundleRes.ok) throw new Error(`Could not fetch bundle ${bundleUrl}: HTTP ${bundleRes.status}`);
  const bundle = await bundleRes.text();

  const categoryPattern = /category:"([^"]{3,100})",image:[a-zA-Z0-9_$]+,intro:"([^"]{0,900})",services:\[/g;
  const found = [];
  let m;
  while ((m = categoryPattern.exec(bundle))) {
    const [, categoryName, intro] = m;
    const openPos = bundle.indexOf('[', m.index + m[0].length - 1);
    const closePos = findMatchingBracket(bundle, openPos);
    const servicesRaw = bundle.slice(openPos, closePos + 1);
    const services = [...servicesRaw.matchAll(/\{title:"([^"]{3,120})",desc:"([^"]{5,500})",outcome:"([^"]{5,500})"\}/g)]
      .map(([, name, description, outcome]) => ({ name, description, outcome }));
    found.push({ categoryName, intro, services });
  }
  return found;
}

function flattenLocal(cat) {
  const out = [];
  for (const category of cat.categories) {
    for (const service of category.services) {
      out.push({ categoryName: category.name, name: service.name, description: service.description, outcome: service.outcome });
    }
  }
  return out;
}

function flattenLive(live) {
  const out = [];
  for (const category of live) {
    for (const service of category.services) {
      out.push({ categoryName: category.categoryName, ...service });
    }
  }
  return out;
}

/**
 * The live bundle renders an em dash in source copy as a literal " ,  "
 * (double-space) artifact — confirmed by running this script for real
 * against blaynes.consulting (see gtm-strategy-architecture's description).
 * catalogue/blaynes-services.json intentionally cleans that up to a proper
 * comma when a service is first authored, since the catalogue's text is
 * what a client actually reads in a recommendation — quality matters more
 * there than byte-matching the source. Comparing on the raw bytes would
 * therefore flag that one formatting quirk as "drift" forever, on every
 * run, permanently — so both sides are normalized here before comparing.
 * A real content change still shows up; a punctuation artifact doesn't.
 */
function normalizeForComparison(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function diff(local, live) {
  const localByName = new Map(local.map((s) => [s.name, s]));
  const liveByName = new Map(live.map((s) => [s.name, s]));

  const added = live.filter((s) => !localByName.has(s.name));
  const removed = local.filter((s) => !liveByName.has(s.name));
  const changed = [];
  for (const [name, localSvc] of localByName) {
    const liveSvc = liveByName.get(name);
    if (!liveSvc) continue;
    const descChanged = normalizeForComparison(liveSvc.description) !== normalizeForComparison(localSvc.description);
    const outcomeChanged = normalizeForComparison(liveSvc.outcome) !== normalizeForComparison(localSvc.outcome);
    if (descChanged || outcomeChanged) {
      changed.push({ name, local: { description: localSvc.description, outcome: localSvc.outcome }, live: { description: liveSvc.description, outcome: liveSvc.outcome } });
    }
  }
  return { added, removed, changed };
}

/**
 * Opens a PR when GITHUB_TOKEN + GITHUB_REPOSITORY are set (the Cloud Run
 * Job's expected config — see the gcloud commands below); otherwise writes
 * a local report and logs what a human needs to look at. Either way, never
 * writes to catalogue/blaynes-services.json directly — that stays a
 * reviewed, human-authored change.
 */
async function openReviewTask(report) {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${REPORT_PATH}`);

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
  if (!token || !repo) {
    console.warn('GITHUB_TOKEN/GITHUB_REPOSITORY not set — skipping PR creation. Review catalogue-freshness-report.json manually.');
    return;
  }

  const title = `Catalogue drift detected: ${report.diff.added.length} added, ${report.diff.removed.length} removed, ${report.diff.changed.length} changed`;
  const body = [
    'Automated weekly freshness check found the live site and catalogue/blaynes-services.json disagree.',
    'This is a review task, not an auto-merge — verify each change before touching the catalogue file.',
    '',
    '```json',
    JSON.stringify(report.diff, null, 2),
    '```',
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['catalogue-drift'] }),
  });
  if (!res.ok) {
    console.error(`Failed to open a review issue: HTTP ${res.status} ${await res.text()}`);
    return;
  }
  const issue = await res.json();
  console.log(`Opened review issue: ${issue.html_url}`);
}

// --- staleness check, independent of whether the scrape succeeds ----------
const ageDays = Math.floor((Date.now() - Date.parse(catalogue.last_verified)) / 86_400_000);
const stale = ageDays > STALE_DAYS;
if (stale) {
  console.warn(`ALERT: catalogue last_verified is ${ageDays} days old (> ${STALE_DAYS}-day limit).`);
}

// --- content diff -----------------------------------------------------------
let exitCode = stale ? 1 : 0;
try {
  const live = await fetchLiveCatalogue();
  const liveCount = live.reduce((n, c) => n + c.services.length, 0);
  if (liveCount === 0) {
    // EXTRACTION FAILURE: the bundle fetched fine but nothing matched the
    // expected shape — treat this as drift worth a human's attention rather
    // than silently reporting "no changes."
    throw new Error('Fetched the live bundle but extracted zero services — the site\'s data shape may have changed.');
  }

  const report = {
    checked_at: new Date().toISOString(),
    catalogue_version: catalogue.version,
    catalogue_last_verified: catalogue.last_verified,
    diff: diff(flattenLocal(catalogue), flattenLive(live)),
  };

  const hasDrift = report.diff.added.length || report.diff.removed.length || report.diff.changed.length;
  if (hasDrift) {
    console.log(`Drift found: +${report.diff.added.length} -${report.diff.removed.length} ~${report.diff.changed.length}`);
    await openReviewTask(report);
    exitCode = 1;
  } else {
    console.log('No drift — live site matches catalogue/blaynes-services.json.');
  }
} catch (err) {
  console.error('Freshness check could not complete:', err.message);
  await openReviewTask({ checked_at: new Date().toISOString(), error: err.message, diff: { added: [], removed: [], changed: [] } });
  exitCode = 1;
}

process.exit(exitCode);

/*
 * ---- Cloud Scheduler wiring (run once per environment) --------------------
 *
 * 1. Build and push this script as part of the existing container image
 *    (it already ships in the repo — no separate image needed) — or build a
 *    minimal Cloud Run Job image that just runs `node scripts/check-catalogue-freshness.mjs`.
 *
 * gcloud run jobs create blayne-catalogue-freshness \
 *   --image=<same image as blayne-web, or a slim variant> \
 *   --region=us-central1 \
 *   --command=node --args=scripts/check-catalogue-freshness.mjs \
 *   --set-secrets=GITHUB_TOKEN=BLAYNE_GITHUB_TOKEN:latest \
 *   --set-env-vars=GITHUB_REPOSITORY=<owner>/<repo>
 *
 * gcloud scheduler jobs create http blayne-catalogue-freshness-weekly \
 *   --schedule="0 9 * * 1" \
 *   --uri="https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<project>/jobs/blayne-catalogue-freshness:run" \
 *   --http-method=POST \
 *   --oauth-service-account-email=<runtime-sa>@<project>.iam.gserviceaccount.com
 *
 * GITHUB_TOKEN needs `issues: write` on this repo (a fine-grained PAT, or a
 * GitHub App token) — kept in Secret Manager, never a plain env var, same
 * pattern as SUPABASE_SERVICE_ROLE_KEY in the README's Cloud Run deploy.
 */
