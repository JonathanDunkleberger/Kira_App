import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import { ConversationOrb } from '../../../components/ui/ConversationOrb';
import { Timer } from '../../../components/ui/Timer';
import { Rating } from '../../../components/ui/Rating';
import CallControls from '../../../components/chat/CallControls';

// Client wrapper for socket usage
const ActiveConversation = dynamic(() => import('./state'), { ssr: false });

export default function ConversationRoute({ params }: { params: { conversationId: string } }) {
  if (!params.conversationId) return notFound();
  return (
    <main className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center p-6 gap-8">
      <Suspense fallback={<div className="text-cream-300/70">Connecting to Kira...</div>}>
        <ActiveConversation id={params.conversationId} />
      </Suspense>
    </main>
  );
}
