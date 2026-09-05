/**
 * Exercises server/brandKit/virusScan.js against a REAL clamd, not a mock —
 * the whole point of this gate is that it's a real external dependency the
 * upload path cannot proceed without (see the brief's "virus scan before
 * anything is parsed" and the Phase 1 report's decision to fail closed
 * rather than silently skip scanning).
 *
 * Needs CLAMD_HOST set and reachable:
 *   - Locally: `docker compose up -d clamd` (see docker-compose.yml), then
 *     `CLAMD_HOST=localhost npm test`.
 *   - CI: .github/workflows/ci.yml runs clamd as a service container and
 *     sets CLAMD_HOST=localhost for the test job automatically.
 * Without CLAMD_HOST set, these tests skip rather than fail — `npm test`
 * with no Docker running locally still exercises everything else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBuffer } from '../server/brandKit/virusScan.js';

const hasClamd = Boolean(process.env.CLAMD_HOST);

// Standard EICAR antivirus test string — not a real virus. Every AV engine,
// ClamAV included, is specifically built to flag this exact byte sequence
// as "Eicar-Test-Signature" so scanners can be tested safely.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

test('scanBuffer passes a clean file', { skip: !hasClamd && 'CLAMD_HOST not set — run `docker compose up -d clamd`' }, async () => {
  const result = await scanBuffer(Buffer.from('Just an ordinary brand guideline excerpt.'), 'clean.txt');
  assert.equal(result.scanned, true);
  assert.deepEqual(result.viruses, []);
});

test('scanBuffer rejects the EICAR test signature', { skip: !hasClamd && 'CLAMD_HOST not set — run `docker compose up -d clamd`' }, async () => {
  await assert.rejects(() => scanBuffer(Buffer.from(EICAR), 'eicar.txt'), /Eicar|virus scan/i);
});

test('scanBuffer fails closed when scanning is not configured', async () => {
  const savedHost = process.env.CLAMD_HOST;
  const savedSkip = process.env.BRAND_KIT_SKIP_VIRUS_SCAN;
  delete process.env.CLAMD_HOST;
  delete process.env.BRAND_KIT_SKIP_VIRUS_SCAN;
  try {
    await assert.rejects(() => scanBuffer(Buffer.from('anything'), 'file.txt'), /not configured/i);
  } finally {
    if (savedHost !== undefined) process.env.CLAMD_HOST = savedHost;
    if (savedSkip !== undefined) process.env.BRAND_KIT_SKIP_VIRUS_SCAN = savedSkip;
  }
});

test('scanBuffer honors the explicit dev bypass when unconfigured', async () => {
  const savedHost = process.env.CLAMD_HOST;
  delete process.env.CLAMD_HOST;
  process.env.BRAND_KIT_SKIP_VIRUS_SCAN = 'true';
  try {
    const result = await scanBuffer(Buffer.from('anything'), 'file.txt');
    assert.equal(result.scanned, false);
  } finally {
    if (savedHost !== undefined) process.env.CLAMD_HOST = savedHost;
    delete process.env.BRAND_KIT_SKIP_VIRUS_SCAN;
  }
});
