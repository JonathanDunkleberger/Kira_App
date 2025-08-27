"use client";

import { useEffect, useState } from "react";
import HotMic from "@/components/HotMic";
import Transcript from "@/components/Transcript";
import Paywall from "@/components/Paywall";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [paywalled, setPaywalled] = useState(false);
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  useEffect(() => setMounted(true), []);

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white">
      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold mb-2">Talk with Kira</h1>
        <p className="text-gray-400 mb-10">Click the orb to start a conversation. Trial is 20 minutes.</p>

        {mounted && (
          <div className="flex flex-col items-center gap-8">
            <HotMic
              disabled={paywalled}
              onResult={({ user, reply }) => {
                setLastUser(user);
                setLastReply(reply);
              }}
            />

            <div className="text-left max-w-xl">
              <Transcript text={lastUser ? `You: ${lastUser}` : ''} />
              <Transcript text={lastReply ? `Kira: ${lastReply}` : ''} />
            </div>

            {paywalled && (
              <Paywall onUnlock={() => (window.location.href = "/api/stripe/create-checkout")} />
            )}
          </div>
        )}
      </section>
    </main>
  );
}
