import { NextResponse } from 'next/server';
// Streak API removed. Return 410 Gone for any method.
export const runtime = 'edge';
export async function GET() { return NextResponse.json({ error: 'Streak API removed' }, { status: 410 }); }
export async function POST() { return NextResponse.json({ error: 'Streak API removed' }, { status: 410 }); }
