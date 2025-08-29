"use client";

import { useEffect, useMemo, useState } from "react";
import HotMic from "@/components/HotMic";
import Transcript from "@/components/Transcript";
import Paywall from "@/components/Paywall";
import { createConversation, fetchEntitlement } from "@/lib/client-api";
import { supabase } from "@/lib/supabaseClient";
import { getUsageState, syncUsageWithServer } from "@/lib/usageTracking";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [paywalled, setPaywalled] = useState(false);
  const [usage, setUsage] = useState({ secondsRemaining: 15 * 60, plan: 'free' });
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<'inactive'|'active'|'past_due'|'canceled'>('inactive');
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []);
  const success = query.get('success') === '1';
  const canceled = query.get('canceled') === '1';
  const next = query.get('next');

  async function refreshEnt() {
    const ent = await fetchEntitlement();
    if (ent) {
      setSecondsRemaining(ent.secondsRemaining);
      setStatus(ent.status);
    }
  }

  useEffect(() => {
    setMounted(true);
    refreshEnt();
    // track usage locally for guests and show paywall when out
    const checkUsage = () => {
      const current = getUsageState();
      setUsage({ secondsRemaining: current.secondsRemaining, plan: current.plan });
      if (current.secondsRemaining <= 0 && current.plan === 'free') setPaywalled(true);
    };
    checkUsage();
  // if signed in, sync local usage cache with server entitlements once on mount
  syncUsageWithServer().then(u => setUsage({ secondsRemaining: u.secondsRemaining, plan: u.plan }));
    const usageInterval = setInterval(checkUsage, 5000);
    const url = new URL(window.location.href);
    const c = url.searchParams.get('c');
    if (c) setConversationId(c);
    (async () => {
      // If signed in and no conversation, create one to keep context from the first message
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !c) {
        const conv = await createConversation().catch(() => null);
        if (conv?.id) {
          setConversationId(conv.id);
          url.searchParams.set('c', conv.id);
          history.replaceState({}, '', url.toString());
        }
      }
    })();
    return () => clearInterval(usageInterval);
  }, []);

  // After returning from Stripe success, poll until webhook flips to active
  useEffect(() => {
    if (!mounted || !success) return;

    let stopped = false;
    (async () => {
      // poll for up to ~30s
      for (let i = 0; i < 15 && !stopped; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const ent = await fetchEntitlement();
        if (ent) {
          setSecondsRemaining(ent.secondsRemaining);
          setStatus(ent.status);
          if (ent.status === 'active') {
            setPaywalled(false);
            // Let header know to refresh
            window.dispatchEvent(new Event('entitlement:updated'));
            break;
          }
        }
      }
      // scrub query either way
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      history.replaceState({}, '', url.toString());
    })();

    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, success]);

  // If user came from sign-up with intent to upgrade, pre-open the paywall when not Pro
  useEffect(() => {
    if (next === 'upgrade' && status !== 'active') setPaywalled(true);
  }, [next, status]);

  const isPro = status === 'active';
  const outOfMinutes = !isPro && secondsRemaining !== null && secondsRemaining <= 0;

  const handleResult = ({ user, reply, estSeconds }: { user: string; reply: string; estSeconds?: number }) => {
    setLastUser(user);
    setLastReply(reply);
    setError(null);
    if (!isPro && typeof estSeconds === 'number') {
      setSecondsRemaining((prev) => (prev != null ? Math.max(0, prev - estSeconds) : prev));
    }
  };

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white">
      <section className="mx-auto max-w-3xl px-6 py-20 text-center flex flex-col items-center gap-8">
        <div>
          <h1 className="text-4xl font-semibold mb-2">Talk with Kira</h1>
          {!isPro && (
            <p className="text-gray-400">
              Enjoy 15 minutes of free chats per day.
            </p>
          )}
          {secondsRemaining != null && !isPro && (
            <p className="text-xs text-gray-500 mt-2">Remaining today: {Math.ceil(secondsRemaining / 60)} min</p>
          )}
          {canceled && <p className="text-xs text-rose-400 mt-2">Checkout canceled.</p>}
          {success && !isPro && <p className="text-xs text-emerald-400 mt-2">Payment successful — unlocking…</p>}
        </div>

        {mounted && (
          <div className="flex flex-col items-center gap-8">
      <div className="scale-125">
              <HotMic
                disabled={paywalled}
                mode={outOfMinutes ? 'launcher' : 'mic'}
                conversationId={conversationId}
                outOfMinutes={outOfMinutes}
                onResult={handleResult}
                onPaywall={() => setPaywalled(true)}
              />
            </div>

            {error && (
              <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg z-50">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                  <button onClick={() => setError(null)} className="ml-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div className="text-left max-w-xl">
              <Transcript text={lastUser ? `You: ${lastUser}` : ''} />
              <Transcript text={lastReply ? `Kira: ${lastReply}` : ''} />
            </div>

            <Paywall isOpen={paywalled} onClose={() => setPaywalled(false)} />
          </div>
        )}
      </section>
    </main>
  );
}