'use client';

import { useEffect, useState } from 'react';
import { openBillingPortal, startCheckout } from '../lib/client-api';

type SubState = {
  status: string;
  plan: string;
  currentPeriodEnd?: string | null;
  cancelAt?: string | null;
  canceledAt?: string | null;
} | null;

export default function BillingStatus() {
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubState>(null);
  const [actionLoading, setActionLoading] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/billing/subscription', { cache: 'no-store' });
        const j = await r.json();
        if (!ignore) setSub(j?.subscription || null);
      } catch (e: any) {
        if (!ignore) setError(e?.message || 'Failed to load');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const active = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  const canceled = sub && ['canceled'].includes(sub.status);
  const dateFmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Subscription</h2>
        <p className="text-xs text-white/60 mt-1">Your current plan details.</p>
      </div>
      {loading && <div className="text-sm text-white/50">Loading...</div>}
      {error && <div className="text-sm text-rose-400">{error}</div>}
      {!loading && !error && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-sm text-white/60">Plan</div>
              <div className="font-medium capitalize">{active ? sub?.plan || 'pro' : 'Free'}</div>
            </div>
            <div>
              <div className="text-sm text-white/60">Status</div>
              <div className="font-medium capitalize">{sub?.status || 'none'}</div>
            </div>
            <div>
              <div className="text-sm text-white/60">Renews</div>
              <div className="font-medium">{sub?.currentPeriodEnd ? dateFmt(sub.currentPeriodEnd) : '—'}</div>
            </div>
            <div>
              <div className="text-sm text-white/60">Cancel At</div>
              <div className="font-medium">{dateFmt(sub?.cancelAt)}</div>
            </div>
          </div>
          <div className="pt-2 flex flex-wrap gap-3">
            {!active && (
              <button
                className="rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                disabled={actionLoading === 'checkout'}
                onClick={() => {
                  setActionLoading('checkout');
                  startCheckout();
                }}
              >
                {actionLoading === 'checkout' ? 'Redirecting…' : 'Upgrade to Pro'}
              </button>
            )}
            {active && (
              <button
                className="rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                disabled={actionLoading === 'portal'}
                onClick={() => {
                  setActionLoading('portal');
                  openBillingPortal();
                }}
              >
                {actionLoading === 'portal' ? 'Opening…' : 'Manage in Portal'}
              </button>
            )}
          </div>
          {!active && (
            <p className="text-xs text-white/50">
              Your free plan includes a limited amount of daily conversation time. Upgrade to Pro
              for unlimited access.
            </p>
          )}
          {active && canceled && (
            <p className="text-xs text-amber-400">
              Your subscription is canceled and will stop at the end of the current period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
