/**
 * Validates the shape of catalogue/blaynes-services.json before anything
 * downstream (the loader, the search tool) trusts it.
 *
 * Hand-rolled rather than a schema library (Zod, ajv, ...): the shape is
 * small and fixed, and this repo has no validation library anywhere else —
 * adding one for a single 30-row file would be the abstraction the rest of
 * this codebase deliberately avoids.
 *
 * Every check throws a specific, actionable message. The caller (loader.js)
 * is the one that turns a thrown error into a hard boot failure — this file
 * only decides what "valid" means.
 */

function fail(path, message) {
  throw new Error(`Invalid catalogue at ${path}: ${message}`);
}

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
}

function requireStringArray(value, path, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) fail(path, 'expected an array of strings');
  if (value.length < minLength) fail(path, `expected at least ${minLength} entries`);
  value.forEach((v, i) => requireString(v, `${path}[${i}]`));
}

/**
 * Throws on the first problem found. Returns nothing — callers pass the
 * catalogue in and either get a clean return or a thrown Error.
 */
export function validateCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== 'object') fail('$', 'expected an object');

  requireString(catalogue.version, '$.version');
  requireString(catalogue.source_url, '$.source_url');
  requireString(catalogue.last_verified, '$.last_verified');
  if (Number.isNaN(Date.parse(catalogue.last_verified))) {
    fail('$.last_verified', 'expected an ISO date string');
  }

  if (!Array.isArray(catalogue.categories) || catalogue.categories.length === 0) {
    fail('$.categories', 'expected a non-empty array');
  }

  const seenIds = new Set();
  let serviceCount = 0;

  catalogue.categories.forEach((cat, ci) => {
    const cPath = `$.categories[${ci}]`;
    requireString(cat.id, `${cPath}.id`);
    requireString(cat.name, `${cPath}.name`);
    requireString(cat.scope, `${cPath}.scope`);
    if (seenIds.has(cat.id)) fail(`${cPath}.id`, `duplicate id "${cat.id}"`);
    seenIds.add(cat.id);

    if (!Array.isArray(cat.services) || cat.services.length === 0) {
      fail(`${cPath}.services`, 'expected a non-empty array');
    }

    cat.services.forEach((svc, si) => {
      const sPath = `${cPath}.services[${si}]`;
      requireString(svc.id, `${sPath}.id`);
      requireString(svc.name, `${sPath}.name`);
      requireString(svc.description, `${sPath}.description`);
      requireString(svc.outcome, `${sPath}.outcome`);
      requireStringArray(svc.aliases, `${sPath}.aliases`, { minLength: 1 });
      if (seenIds.has(svc.id)) fail(`${sPath}.id`, `duplicate id "${svc.id}"`);
      seenIds.add(svc.id);
      serviceCount += 1;
    });
  });

  if (serviceCount === 0) fail('$.categories', 'catalogue has zero services');
}
