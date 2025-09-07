import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Basic in-memory rate limit for API routes
const WINDOW_MS = 10_000;
const LIMIT = 30;
const bucket = new Map<string, { t: number; c: number }>();

export async function middleware(request: NextRequest) {
  // Rate limit only API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const forwarded = request.headers.get('x-forwarded-for') || 'local';
    const ip = (forwarded ? forwarded : 'local').split(',')[0]?.trim() || 'local';
    const now = Date.now();
    const k = bucket.get(ip) || { t: now, c: 0 };
    if (now - k.t > WINDOW_MS) {
      k.t = now;
      k.c = 0;
    }
    k.c++;
    bucket.set(ip, k);
    if (k.c > LIMIT) {
      return new NextResponse('Too Many Requests', { status: 429 });
    }
  }
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // This will refresh the user's session cookie if it's expired.
  await supabase.auth.getSession();

  return response;
}

// This config ensures middleware runs on all paths except for static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
