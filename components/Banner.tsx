'use client';
import { useEffect, useState } from 'react';

export default function Banner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('success') === '1') setMsg('Payment successful — Pro unlocked.');
    if (q.get('canceled') === '1') setMsg('Checkout canceled.');
    const sid = q.get('session_id');
    if (sid) {
      (async () => {
        try {
          const r = await fetch('/api/auth/session-exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sid }),
          });
          const j = await r.json();
          if (j.access_token && j.refresh_token) {
            const { supabase } = await import('@/lib/supabaseClient');
            await supabase.auth.setSession({
              access_token: j.access_token,
              refresh_token: j.refresh_token,
            });
            try {
              const guestConvId = sessionStorage.getItem('guestConversationId');
              if (guestConvId) {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                  await fetch('/api/auth/claim-conversation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({ guestConvId })
                  });
                  sessionStorage.removeItem('guestConversationId');
                }
              }
            } catch {}
            window.dispatchEvent(new Event('entitlement:updated'));
          }
        } catch {}
      })();
    }
    if (q.get('success') === '1' || q.get('canceled') === '1' || q.get('session_id')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      url.searchParams.delete('canceled');
      url.searchParams.delete('session_id');
      history.replaceState({}, '', url.toString());
    }
  }, []);

  if (!msg) return null;

  return (
    <div className="sticky top-0 z-40 w-full bg-emerald-600/20 backdrop-blur border-b border-emerald-700/30 text-emerald-200">
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between text-sm">
        <span>{msg}</span>
        <button onClick={() => setMsg(null)} className="text-emerald-200/80 hover:text-emerald-100">Dismiss</button>
      </div>
    </div>
  );
}
