"use client";

import HotMic from '@/components/HotMic';
import ConversationView from '@/components/ConversationView';
import { useConversation } from '@/lib/state/ConversationProvider';
import Paywall from '@/components/Paywall';
import AchievementToast from '@/components/AchievementToast';

export default function HomePage() {
  const { error, conversationStatus, turnState } = useConversation();
  return (
    <main className="h-[calc(100vh-56px)] bg-[#0b0b12] text-white flex flex-col items-center scrollbar-hover">
  <AchievementToast />
      {/* Top-level conditional UI */}
      {conversationStatus === 'INACTIVE' ? (
        <section className="flex-1 container mx-auto max-w-4xl px-6 pt-10 text-center flex flex-col items-center gap-8 justify-center">
          <h1 className="text-4xl font-semibold">Talk with Kira</h1>
          <p className="text-gray-400">Speak naturally. Kira will listen and reply.</p>
          <HotMic />
          {error && <p className="text-rose-400 mt-2">Error: {error}</p>}
        </section>
      ) : (
        <>
          <section className="flex-1 container mx-auto max-w-4xl px-6 pt-4 text-center flex flex-col items-center gap-4">
            <HotMic />
          </section>
          <ConversationView />
        </>
      )}
      {/* Paywall mounted globally */}
      <Paywall />
    </main>
  );
}