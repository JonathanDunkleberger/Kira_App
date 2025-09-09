'use client';
import { useState } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';

export default function CallControls() {
  const [muted, setMuted] = useState(false);
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
      <div className="rounded-2xl border border-white/10 bg-white/10 backdrop-blur px-3 py-2 flex items-center gap-4">
        <button
          onClick={() => setMuted((m) => !m)}
          className={`text-sm px-3 py-2 rounded-md flex items-center gap-2 border transition ${muted ? 'bg-rose-600/20 border-rose-500/40 text-rose-200' : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/20'}`}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={() => (window.location.href = '/')}
          className="text-sm px-3 py-2 rounded-md flex items-center gap-2 bg-rose-600/80 hover:bg-rose-600 text-white shadow border border-rose-400/40"
        >
          <Square className="h-4 w-4" /> End call
        </button>
      </div>
    </div>
  );
}
