import { createBrowserClient } from '@supabase/ssr'
import { envClient } from '@/lib/client/env.client';

export const supabase = createBrowserClient(
  envClient.NEXT_PUBLIC_SUPABASE_URL,
  envClient.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
