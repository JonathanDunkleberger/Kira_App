'use client';
import { useRef, useState } from 'react';
import { playMp3Base64 } from '@/lib/audio';

export default function MicButton({
  onResult,
  sessionToken,
  disabled
}: {
  onResult: (t: { user: string; reply: string; estSeconds?: number }) => void;
  sessionToken: string | null;
  disabled?: boolean;
}) {
  const recRef = useRef<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);

  async function handleDown() {
    if (disabled || busy) return;
    if (playing) { playing.pause(); setPlaying(null); }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (!sessionToken) return;

      setBusy(true);
      const supabaseAccessToken = (await (await import('@/lib/supabaseClient')).getSupabaseBrowser()
        .auth.getSession()).data.session?.access_token;

      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('token', sessionToken);
      fd.append('audio', audioBlob, 'audio.webm');

      const res = await fetch('/api/utterance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseAccessToken}` },
        body: fd
      });

      if (res.status === 402) {
        setBusy(false);
        return; // paywall handled by parent state
      }

      const j = await res.json();
      onResult({ user: j.transcript, reply: j.reply, estSeconds: j.estSeconds });
      const a = await playMp3Base64(j.audioMp3Base64, () => setPlaying(null));
      setPlaying(a);
      setBusy(false);
    };
    recRef.current = rec;
    rec.start();
  }

  function handleUp() {
    recRef.current?.stop();
    recRef.current = null;
  }

  return (
    <button
      onMouseDown={handleDown}
      onMouseUp={handleUp}
      onTouchStart={handleDown}
      onTouchEnd={handleUp}
      disabled={busy || disabled}
      className="btn btn-primary rounded-full h-20 w-20 p-0"
      title={disabled ? 'Trial exhausted' : 'Hold to talk'}
    >
      <div className="orb" />
    </button>
  );
}
