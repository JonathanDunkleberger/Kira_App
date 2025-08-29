"use client";

import { useEffect, useMemo, useState } from "react";
import HotMic from "@/components/HotMic";
import Transcript from "@/components/Transcript";
import Paywall from "@/components/Paywall";
import { createConversation, fetchEntitlement } from "@/lib/client-api";
import { supabase } from "@/lib/supabaseClient";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [paywalled, setPaywalled] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<'inactive'|'active'|'past_due'|'canceled'>('inactive');
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

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
                onResult={({ user, reply, estSeconds }) => {
                  setLastUser(user);
                  setLastReply(reply);
                  if (!isPro && typeof estSeconds === 'number') {
                    setSecondsRemaining((prev) => (prev != null ? Math.max(0, prev - estSeconds) : prev));
                  }
                }}
                onPaywall={() => setPaywalled(true)}
              />
            </div>

            <div className="text-left max-w-xl">
              <Transcript text={lastUser ? `You: ${lastUser}` : ''} />
              <Transcript text={lastReply ? `Kira: ${lastReply}` : ''} />
            </div>

            {paywalled && <Paywall />}
          </div>
        )}
      </section>
    </main>
  );
}