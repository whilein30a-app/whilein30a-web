import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && anon);

// The anon key is public by design. What protects the data is row level
// security and the portal_* / admin_* functions in sql/090, never this key.
export const supabase = createClient(url ?? 'http://localhost', anon ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
