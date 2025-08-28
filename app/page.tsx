"use client";

import { useEffect, useState } from "react";
import HotMic from "@/components/HotMic";
import Transcript from "@/components/Transcript";
import Paywall from "@/components/Paywall";
import { ensureAnonSession, fetchSessionSeconds } from "@/lib/client-api";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [paywalled, setPaywalled] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");

  useEffect(() => {
    setMounted(true);
    (async () => {
      await ensureAnonSession();
      const s = await fetchSessionSeconds().catch(() => null);
      if (s != null) setSecondsRemaining(s);
      // Do not trigger paywall at load; only on 402 from API
    })();
  }, []);

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white">
      <section className="mx-auto max-w-3xl px-6 py-20 text-center flex flex-col items-center gap-8">
        <div>
          <h1 className="text-4xl font-semibold mb-2">Talk with Kira</h1>
          <p className="text-gray-400">
            Click the orb to start a conversation.
          </p>

          {secondsRemaining != null ? (
            <p className="text-xs text-gray-500 mt-2">
              Remaining: {Math.ceil(secondsRemaining / 60)} min
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-2">
              Free trial: 15 min
            </p>
          )}
        </div>

        {mounted && (
          <div className="flex flex-col items-center gap-8">
            <div className="scale-125">
              <HotMic
                disabled={paywalled}
                onResult={({ user, reply, estSeconds }) => {
                  setLastUser(user);
                  setLastReply(reply);
                  if (typeof estSeconds === 'number') {
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