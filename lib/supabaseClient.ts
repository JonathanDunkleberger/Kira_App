import { createClient } from '@supabase/supabase-js';
import { envClient } from './env.client';

export function getSupabaseBrowser() {
  return createClient(envClient.NEXT_PUBLIC_SUPABASE_URL, envClient.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// server admin client moved to lib/supabaseAdmin.ts
