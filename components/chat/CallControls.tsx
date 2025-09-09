'use client';
import { useState } from 'react';

import { Mic, Square } from 'lucide-react';
import { startMic, stopMicForUtterance } from '../../lib/useVoiceSocket';
import { Button } from '../ui/Button';
import RestartChatButton from './RestartChatButton';

export default function CallControls({ voice }: { voice: any }) {
  const [ptt, setPtt] = useState(false);
  const [ending, setEnding] = useState(false);
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
      <div className="rounded-2xl border bg-muted/70 backdrop-blur px-3 py-2 flex items-center gap-4">
        <RestartChatButton />
        <Button
          variant={ptt ? 'primary' : 'outline'}
          onMouseDown={async () => {
            if (!ptt) {
              setPtt(true);
              await startMic();
            }
          }}
          onMouseUp={() => {
            if (ptt) {
              stopMicForUtterance();
              setPtt(false);
            }
          }}
        >
          <Mic className="mr-2 h-4 w-4" /> {ptt ? 'Release to Send' : 'Hold to Talk'}
        </Button>
        <Button
          variant="primary"
          className="bg-rose-600 hover:bg-rose-600/90 text-white"
          disabled={ending}
          onClick={async () => {
            setEnding(true);
            await voice.endCall?.();
            location.assign('/chat?persona=kira');
          }}
        >
          <Square className="mr-2 h-4 w-4" /> End call
        </Button>
      </div>
    </div>
  );
}
