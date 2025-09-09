'use client';
import { useState } from 'react';

import { Mic, MicOff, Square } from 'lucide-react';
import type { useVoiceSocket } from '../../lib/useVoiceSocket';
import { Button } from '../ui/Button';
import RestartChatButton from './RestartChatButton';

export default function CallControls({ voice }: { voice: ReturnType<typeof useVoiceSocket> }) {
  const [ending, setEnding] = useState(false);
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
      <div className="rounded-2xl border bg-muted/70 backdrop-blur px-3 py-2 flex items-center gap-4">
        <RestartChatButton />
        <Button
          variant={voice.isMuted ? 'primary' : 'outline'}
          onMouseDown={async () => {
            if (voice.isMuted) {
              voice.setMuted(false);
              await voice.startUtterance?.();
            }
          }}
          onMouseUp={() => {
            if (!voice.isMuted) {
              voice.stopUtterance?.();
              voice.setMuted(true);
            }
          }}
          onClick={() => {
            // fallback toggle for keyboard users
            const next = !voice.isMuted;
            voice.setMuted(!next);
            if (next) {
              void voice.startUtterance?.();
            } else {
              voice.stopUtterance?.();
            }
          }}
        >
          {voice.isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
          {voice.isMuted ? 'Hold to Talk' : 'Release to Stop'}
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
