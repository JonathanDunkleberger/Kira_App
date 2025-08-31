"use client";

import HotMic from '@/components/HotMic';
import ConversationView from '@/components/ConversationView';
import { useConversation } from '@/lib/state/ConversationProvider';
import Paywall from '@/components/Paywall';
import StreakIndicator from '@/components/StreakIndicator';
import DailyTopicBanner from '@/components/DailyTopicBanner';
import AchievementToast from '@/components/AchievementToast';

function ConversationShell() {
  const { showPaywall, setShowPaywall } = useConversation();
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="scale-125">
        <HotMic />
      </div>
      <ConversationView />
      <Paywall isOpen={showPaywall} onClose={() => setShowPaywall(false)} />
    </div>
  );
}

export default function HomePage() {
  const { error, viewMode } = useConversation();
  return (
    <main className="h-[calc(100vh-56px)] bg-[#0b0b12] text-white flex flex-col items-center scrollbar-hover">
  <StreakIndicator />
  <DailyTopicBanner />
  <AchievementToast />
      {viewMode === 'conversation' ? (
        <>
          <section className="flex-1 container mx-auto max-w-4xl px-6 pt-10 text-center flex flex-col items-center gap-8 justify-center">
            <h1 className="text-4xl font-semibold">Talk with Kira</h1>
            <p className="text-gray-400">Speak naturally. Kira will listen and reply.</p>
            <HotMic />
            {error && <p className="text-rose-400 mt-2">Error: {error}</p>}
          </section>
          <ConversationView />
        </>
      ) : (
        <section className="w-full h-full flex flex-col items-center pt-8">
          <h2 className="text-2xl font-semibold mb-4">Conversation History</h2>
          <ConversationView />
        </section>
      )}
    </main>
  );
}