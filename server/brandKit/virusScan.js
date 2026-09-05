/**
 * Virus scanning — "a hard rule that no uploaded file is ever executed or
 * interpreted as instructions" starts with "no uploaded file is ever parsed
 * before it's scanned." This is a real, blocking gate, not a warning: every
 * caller in ingest.js runs scanBuffer() before any parser (pdf-parse,
 * mammoth, sharp, fontkit, ...) ever sees the bytes.
 *
 * Talks to a clamd daemon over TCP (CLAMD_HOST/CLAMD_PORT) via the
 * `clamscan` package's scanStream(), not the local `clamscan`/`clamdscan`
 * CLI — this process's container isn't expected to carry a ClamAV install
 * itself; clamd is meant to run as a sidecar/adjacent service. See the
 * Dockerfile comment and the README for what still needs standing up.
 *
 * Fails closed: with no CLAMD_HOST configured, uploads are refused rather
 * than silently skipping the scan — this repo already has one precedent for
 * an explicit, loudly-logged dev-only bypass (ANTHROPIC_API_KEY in
 * server/index.js), so BRAND_KIT_SKIP_VIRUS_SCAN=true follows the same
 * pattern for local development without ClamAV running.
 */
import { Readable } from 'node:stream';

// Read live off process.env rather than cached at module-load time: this
// module can be imported before a test (or a future config-loading step)
// sets these, and freezing them at import time would make that ordering a
// silent trap — see test/brand-kit-virus-scan.test.js, which sets
// CLAMD_HOST itself before calling in.
let scannerPromise = null;
let scannerHostPort = null; // invalidates the cached client if the host/port env ever changes between calls (only really happens in tests)

async function getScanner() {
  const host = process.env.CLAMD_HOST;
  if (!host) return null;
  const port = Number(process.env.CLAMD_PORT ?? 3310);

  const key = `${host}:${port}`;
  if (!scannerPromise || scannerHostPort !== key) {
    scannerHostPort = key;
    scannerPromise = (async () => {
      const { default: NodeClam } = await import('clamscan');
      return new NodeClam().init({
        removeInfected: false, // this process never has a local copy to remove — the buffer is ours to discard
        clamdscan: {
          host,
          port,
          timeout: 60_000,
          localFallback: false, // never silently fall back to a local clamscan/clamdscan binary that may not exist in this container
        },
        preference: 'clamdscan',
      });
    })();
  }
  return scannerPromise;
}

/**
 * Throws if the file is infected or if scanning can't be performed at all
 * (no CLAMD_HOST and no explicit dev bypass) — callers must treat either as
 * "reject the upload," never as "proceed anyway."
 *
 * @returns {Promise<{scanned: boolean, viruses: string[]}>}
 */
export async function scanBuffer(buffer, fileName) {
  const scanner = await getScanner();

  if (!scanner) {
    if (process.env.BRAND_KIT_SKIP_VIRUS_SCAN === 'true') {
      console.warn(
        `[blayne] BRAND_KIT_SKIP_VIRUS_SCAN=true — "${fileName}" was NOT virus-scanned. Dev-only; never set this in production.`,
      );
      return { scanned: false, viruses: [] };
    }
    throw new Error(
      'Virus scanning is not configured (set CLAMD_HOST) — refusing to accept an upload that cannot be scanned.',
    );
  }

  const { isInfected, viruses } = await scanner.scanStream(Readable.from(buffer));
  if (isInfected) {
    throw new Error(`"${fileName}" failed the virus scan (${viruses.join(', ') || 'unknown signature'}).`);
  }
  return { scanned: true, viruses: [] };
}
