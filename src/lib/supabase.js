import { createClient } from '@supabase/supabase-js';

/*
 * The anon key is meant to be public — it ships in every Supabase browser
 * bundle by design. Row Level Security (see supabase/schema.sql) is what
 * actually protects the data; this key alone can't read or write anyone
 * else's row.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.',
  );
}

export const supabase = createClient(url, anonKey);
