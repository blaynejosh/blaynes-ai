import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * index.html carries %%PAGE_*%%/%%CSP_NONCE%% tokens so production
 * (server/index.js, ROUTE_META) can template real per-route title/
 * description/canonical/robots and a CSP nonce into every response. Vite's
 * own dev/preview server has no idea about any of that and would otherwise
 * serve the tokens verbatim — including in the browser tab title — so this
 * fills in the home page's defaults (kept in sync by hand with ROUTE_META)
 * and empties the nonce, since neither dev nor preview sends a CSP header
 * for it to match.
 */
function devHtmlDefaults() {
  const title = 'B.L.A.Y.N.E AI — Your Consulting Team, On Demand';
  const description =
    "B.L.A.Y.N.E AI — Business Leading Agent Yielding Next-Gen Enterprise Strategies. Twenty consulting capability modules, mapped to the roles of a fully staffed enterprise, from Blayne's Consulting.";
  const fillDefaults = (html) =>
    html
      .replaceAll('%%PAGE_TITLE%%', title)
      .replaceAll('%%PAGE_DESCRIPTION%%', description)
      .replaceAll('%%PAGE_CANONICAL%%', 'https://blaynes.ai/')
      .replaceAll('%%PAGE_ROBOTS%%', 'index, follow')
      .replaceAll('%%CSP_NONCE%%', '');

  return {
    name: 'blayne-dev-html-defaults',
    // `vite build` must leave the %%…%% tokens untouched — dist/index.html
    // is what server/index.js templates per-request. Without this, build
    // bakes the home page's values in permanently and every other route
    // (terms, privacy, the 404 fallback, …) silently gets Home's title and
    // an `index, follow` robots tag instead of its own.
    apply: 'serve',
    // `vite dev` — served straight off source, so the normal HTML transform
    // pipeline runs this on every request.
    transformIndexHtml: fillDefaults,
    // `vite preview` — a static server over dist/, which never calls
    // transformIndexHtml at all, so it needs its own pass over the same
    // already-built dist/index.html the production server also templates.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.headers.accept?.includes('text/html')) return next();
        const html = fs.readFileSync(path.join(server.config.root, 'dist/index.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.end(fillDefaults(html));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devHtmlDefaults()],
  build: {
    // Explicit, not just relying on the (already-false) default: never ship
    // .map files, or the sourceMappingURL comments pointing to them, to
    // production — no reason to expose unminified source/file layout publicly.
    sourcemap: false,
    rollupOptions: {
      output: {
        // React/router and Supabase change far less often than app code —
        // splitting them into their own chunks means a routine app deploy
        // doesn't bust the browser's cache for the biggest, most stable
        // dependencies.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    // The chat surface talks to the API server, which holds the Anthropic key.
    proxy: {
      '/api': {
        target: process.env.BLAYNE_API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
