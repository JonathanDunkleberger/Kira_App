import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { event, properties, timestamp, userAgent, url } = await req.json();
    // Stub: log to console only
    console.log('Paywall event (stub):', {
      event,
      properties,
      timestamp: timestamp || new Date().toISOString(),
      userAgent,
      url,
    });
    return NextResponse.json({ success: true, stub: true });
  } catch (error) {
    console.error('Paywall analytics error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
