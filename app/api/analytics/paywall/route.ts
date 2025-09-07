import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const { event, properties, timestamp, userAgent, url } = await req.json();
    const sb = getSupabaseServerAdmin();
    await sb.from('paywall_events').insert({
      event,
      properties,
      timestamp: timestamp || new Date().toISOString(),
      user_agent: userAgent,
      url,
      user_id: properties?.userId || null,
      user_type: properties?.userType,
      plan: properties?.plan,
      seconds_remaining: properties?.secondsRemaining,
      conversation_id: properties?.conversationId || null,
    });
    console.log('Paywall event logged:', event, properties);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Paywall analytics error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
