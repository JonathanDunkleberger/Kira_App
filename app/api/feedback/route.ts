export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { message, rating, meta } = body || {};
  if (!message || typeof message !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  // Auth user (if any) via cookie-based client
  const cookieStore = cookies();
  const anon = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          // @ts-ignore - cookieStore from next/headers conforms sufficiently
          return cookieStore.get(name)?.value;
        },
      },
    },
  );
  const { data: { user } } = await anon.auth.getUser();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { error } = await admin.from('feedback').insert({
    user_id: user?.id ?? null,
    message,
    rating: Number.isFinite(rating) ? rating : null,
    meta: meta ?? null,
  });
  if (error) return new Response(error.message, { status: 500 });
  return new Response(null, { status: 204 });
}
