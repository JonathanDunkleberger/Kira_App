export const dynamic = 'force-dynamic';
export const revalidate = 0;
// export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

const n = (v: any, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

export async function GET(req: Request) {
  const url = new URL(req.url); // reserved for future use
  const DEFAULT_DAILY_FREE_SECONDS = n(process.env.DEFAULT_DAILY_FREE_SECONDS, 900);
  const DEFAULT_PRO_PER_CHAT_SECONDS = n(process.env.DEFAULT_PRO_PER_CHAT_SECONDS, 7200);
  return NextResponse.json(
    {
      plan: 'free',
      todaySecondsLimit: DEFAULT_DAILY_FREE_SECONDS,
      chatSecondsCap: DEFAULT_PRO_PER_CHAT_SECONDS,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
