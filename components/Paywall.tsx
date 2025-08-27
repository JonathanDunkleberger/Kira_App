'use client';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseClient';

export default function Paywall({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);

  async function buy() {
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await res.json();
    window.location.href = j.url;
  }

  return (
    <div className="card">
      <div className="mb-2 font-semibold">Trial used up</div>
      <div className="mb-3 text-sm">Get more minutes for <b>$1.99</b>.</div>
      <button onClick={buy} disabled={loading} className="btn btn-warn">
        {loading ? 'Redirecting…' : 'Unlock minutes'}
      </button>
    </div>
  );
}
