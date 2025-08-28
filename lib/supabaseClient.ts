// lib/supabaseClient.ts

import { createBrowserClient } from '@supabase/ssr'
import { envClient } from './env.client';

// The new, recommended way to create a browser client for Next.js App Router
export const supabase = createBrowserClient(
  envClient.NEXT_PUBLIC_SUPABASE_URL,
  envClient.NEXT_PUBLIC_SUPABASE_ANON_KEY
);