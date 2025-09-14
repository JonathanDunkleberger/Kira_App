import { Suspense } from 'react';
import BillingStatus from '../../../components/BillingStatus';

export const dynamic = 'force-dynamic';

export default function BillingPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-white/60 mt-1">Manage your subscription and plan.</p>
      </div>
      <Suspense fallback={<div className="text-sm text-white/50">Loading subscription…</div>}>
        {/* BillingStatus is client-side fetching */}
        <BillingStatus />
      </Suspense>
    </div>
  );
}
