'use client';
import * as React from 'react';
import { useVoiceSocket, startMic, endCall } from '../../../lib/voice';
import { ConversationOrb } from '../../../components/ui/ConversationOrb';
import { Timer } from '../../../components/ui/Timer';
import { Rating } from '../../../components/ui/Rating';
import CallControls from '../../../components/chat/CallControls';
import { Button } from '../../../components/ui/Button';

interface Props {
  id: string;
}
export default function ActiveConversation({ id }: Props) {
  const vs = useVoiceSocket();
  const [phase, setPhase] = React.useState<'connecting' | 'active' | 'ended'>('connecting');
  const [rating, setRating] = React.useState<number>(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await vs.connect({ persona: 'kira', conversationId: id });
        if (!cancelled) {
          setPhase('active');
          await startMic();
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, vs]);

  function handleEnd() {
    endCall();
    setPhase('ended');
  }

  return (
    <div className="w-full flex flex-col items-center gap-8">
      {phase === 'connecting' && (
        <div className="text-cream-300/70 text-sm">Connecting to Kira...</div>
      )}
      {phase === 'active' && (
        <>
          <Timer start className="text-cream-200 text-sm tracking-wide" />
          <ConversationOrb state={vs.status === 'connected' ? 'listening' : 'idle'} />
          <div className="fixed bottom-8 left-0 right-0 flex justify-center">
            <CallControls />
          </div>
        </>
      )}
      {phase === 'ended' && (
        <div className="flex flex-col items-center gap-6">
          <div className="text-cream-100 text-lg font-medium">How was that conversation?</div>
          <Rating value={rating} onChange={setRating} />
          <Button onClick={() => window.location.assign('/')}>Continue to next conversation</Button>
        </div>
      )}
      <div className="fixed top-4 inset-x-0 flex justify-center">
        {/* Paywall placeholder */}
        {/* TODO: Inject upgrade banner when usage near limit */}
      </div>
    </div>
  );
}
