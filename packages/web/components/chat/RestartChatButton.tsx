'use client';
import { Button } from '../ui/Button';
import { useUsage } from '../../lib/useUsage';
import { connectVoice, startMic, endCall } from '../../lib/voice';

export default function RestartChatButton({ persona = 'kira' }: { persona?: string }) {
  const usage: any = useUsage();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          usage.setChatSessionId(undefined);
        } catch {}
        try {
          endCall();
        } catch {}
        try {
          await connectVoice({ persona, conversationId: undefined });
        } catch {}
        try {
          await startMic();
        } catch {}
      }}
    >
      Restart chat
    </Button>
  );
}
