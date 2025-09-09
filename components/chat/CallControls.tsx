'use client';
import { useState } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';
import type { useVoiceSocket } from '@/lib/useVoiceSocket';
import { Button } from '@/components/ui/Button';

export default function CallControls({ voice }: { voice: ReturnType<typeof useVoiceSocket> }) {
  const [ending, setEnding] = useState(false);
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
      <div className="rounded-2xl border bg-muted/70 backdrop-blur px-3 py-2 flex items-center gap-4">
        <Button
          variant={voice.isMuted ? 'primary' : 'outline'}
          onClick={() => voice.setMuted(!voice.isMuted)}
        >
          {voice.isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
          {voice.isMuted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          variant="primary"
          className="bg-rose-600 hover:bg-rose-600/90 text-white"
          disabled={ending}
          onClick={async () => {
            setEnding(true);
            await voice.endCall();
            location.assign('/chat?persona=kira');
          }}
        >
          <Square className="mr-2 h-4 w-4" /> End call
        </Button>
      </div>
    </div>
  );
}
