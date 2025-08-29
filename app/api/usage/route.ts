import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Get user's entitlement and usage
    const { data: entitlement, error } = await sb
      .from('entitlements')
      .select('plan, status, trial_seconds_remaining, trial_last_reset')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!entitlement) {
      return NextResponse.json({ 
        plan: 'free',
        status: 'inactive',
        secondsRemaining: 0,
        lastReset: new Date().toISOString().split('T')[0]
      });
    }

    return NextResponse.json({
      plan: entitlement.plan === 'supporter' ? 'pro' : (entitlement.plan ?? 'free'),
      status: entitlement.status ?? 'inactive',
      secondsRemaining: entitlement.trial_seconds_remaining || 0,
      lastReset: entitlement.trial_last_reset || new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Usage API error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
