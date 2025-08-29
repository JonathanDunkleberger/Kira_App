"use client";

import HotMic from '@/components/HotMic';
import ConversationView from '@/components/ConversationView';
import ConversationProvider, { useConversation } from '@/lib/state/ConversationProvider';
import Paywall from '@/components/Paywall';

function ConversationShell() {
  const { isPro, secondsRemaining, conversationStatus } = useConversation();
  const paywalled = !isPro && secondsRemaining <= 0 && conversationStatus !== 'active';
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="scale-125">
        <HotMic />
      </div>
      <ConversationView />
      <Paywall isOpen={paywalled} onClose={() => { /* kept controlled by provider state */ }} />
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white">
      <section className="mx-auto max-w-3xl px-6 py-20 text-center flex flex-col items-center gap-8">
        <div>
          <h1 className="text-4xl font-semibold mb-2">Talk with Kira</h1>
          <p className="text-gray-400">Speak naturally. Kira will listen and reply.</p>
        </div>
        <ConversationProvider>
          <ConversationShell />
        </ConversationProvider>
      </section>
    </main>
  );
}