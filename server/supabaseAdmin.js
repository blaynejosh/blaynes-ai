/**
 * The server-side Supabase client, built with the service role key.
 *
 * This key bypasses Row Level Security entirely — it is what lets the server
 * verify any tester's token and read/write the shared `usage_daily` table.
 * It must never reach the browser; see .env.example for the naming rule that
 * keeps Vite from bundling it (no VITE_ prefix).
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabase = Boolean(url && serviceKey);

export const supabaseAdmin = hasSupabase
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : null;
