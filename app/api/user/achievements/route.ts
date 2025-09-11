import { NextRequest, NextResponse } from 'next/server';


export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
  // Stub: return empty achievement list
  return NextResponse.json({ ids: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
  // Stub: accept posted ids and return ok
  return NextResponse.json({ ok: true, stub: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
