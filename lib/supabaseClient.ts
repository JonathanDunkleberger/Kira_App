import { createClient } from '@supabase/supabase-js';
import { envClient } from './env.client';

// Create the client a single time and export the instance
export const supabase = createClient(
  envClient.NEXT_PUBLIC_SUPABASE_URL,
  envClient.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
