'use client';

import { useEffect, useState } from 'react';
import MicButton from '@/components/MicButton';
import Transcript from '@/components/Transcript';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { getSupabaseBrowser } from '@/lib/supabaseClient';

export default function Home() {
  const [items, setItems] = useState<{ user: string; reply: string }[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // sign in anonymously (magic link-less) with Supabase — we’ll use a per-device key
  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // quick anonymous sign-in: create or reuse a persisted key
        const email = `guest_${crypto.randomUUID()}@example.local`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password: crypto.randomUUID()
        });
        // if email verification is enforced, convert project to “email optional” or turn off confirm for dev
        if (error) console.warn(error);
      }
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      // create a session token and read remaining seconds
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/session', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const j = await res.json();
      setSessionToken(j.token);
      setSecondsRemaining(j.secondsRemaining);
      setLoading(false);
    })();
  }, []);

  function onResult(t: { user: string; reply: string; estSeconds?: number }) {
    setItems(prev => [t, ...prev]);
    if (typeof t.estSeconds === 'number') {
      setSecondsRemaining(prev => (prev === null ? prev : Math.max(0, prev - t.estSeconds!)));
    }
  }

  if (loading) return <main className="container-page"><EmptyState /></main>;

  const outOfTime = secondsRemaining !== null && secondsRemaining <= 0;

  return (
    <main className="container-page space-y-6">
      <h1 className="section-title">Kira — your media companion</h1>
      <p className="subtle text-sm">Hold to talk. She answers in short, smart bursts; no filler.</p>

      <div className="row">
        <MicButton onResult={onResult} sessionToken={sessionToken} disabled={outOfTime}/>
        <span className="pill">
          {secondsRemaining !== null ? `Minutes left: ${Math.ceil(secondsRemaining/60)}` : '…'}
        </span>
      </div>

      {outOfTime && <Paywall userId={userId || 'anon'} />}

      <Transcript items={items}/>
    </main>
  );
}
