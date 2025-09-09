'use client';
import { useState } from 'react';

import { Button } from '../ui/Button';
import { startMic, stopMicForUtterance, setMuted, sendJson } from '../../lib/useVoiceSocket';
import { useUsage } from '../../lib/useUsage';

export default function CallControls() {
  const [mutedState, setMutedState] = useState(false);
  const usage = useUsage() as any;

  async function onToggleMute() {
    const next = !mutedState;
    setMutedState(next);
    setMuted(next);
    if (next) {
      stopMicForUtterance();
    } else {
      await startMic();
    }
  }

  async function onEnd() {
    setMuted(true);
    stopMicForUtterance();
    sendJson({ t: 'end' });
    usage.setChatSessionId(undefined);
  }

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-[rgba(255,255,240,.85)] dark:bg-[rgba(18,20,14,.85)] shadow-md px-3 py-2">
      <Button
        variant={mutedState ? 'default' : 'outline'}
        onClick={onToggleMute}
        aria-pressed={mutedState}
      >
        {mutedState ? 'Unmute' : 'Mute'}
      </Button>
      <Button variant="destructive" onClick={onEnd}>
        End call
      </Button>
    </div>
  );
}
