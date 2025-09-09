"use client";
import { Button } from '../ui/Button';
import { useUsage } from '../../lib/useUsage';
import { useVoiceSocket } from '../../lib/useVoiceSocket';

export default function RestartChatButton({ persona = 'kira' }: { persona?: string }) {
  const usage: any = useUsage();
  const voice: any = useVoiceSocket();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          usage.setChatSessionId(undefined);
        } catch {}
        try {
          await voice.endCall?.();
        } catch {}
        try {
          await voice.connect?.({ persona });
        } catch {}
        try {
          await voice.startMic?.();
        } catch {}
      }}
    >
      Restart chat
    </Button>
  );
}
