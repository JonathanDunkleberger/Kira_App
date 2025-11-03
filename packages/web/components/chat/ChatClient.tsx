// packages/web/components/chat/ChatClient.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Square, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import VoiceOrb from '../VoiceOrb';

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [timer, setTimer] = useState(0);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (recording) {
      interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    } else {
      setTimer(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [recording]);

  const startRecording = useCallback(async () => {
    if (recording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const form = new FormData();
        form.append('file', blob, 'audio.webm');
        const res = await fetch('/api/v1/voice', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          console.error('Voice API error', await res.text());
          return;
        }
        const arrayBuf = await res.arrayBuffer();
        const audioBlob = new Blob([arrayBuf], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(audioBlob);
        if (!audioRef.current) {
          const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
          audioRef.current = el;
        }
        if (audioRef.current) {
          audioRef.current.src = url;
          await audioRef.current.play().catch(() => {});
        } else {
          new Audio(url).play().catch(() => {});
        }
      } catch (err) {
        console.error('Playback error', err);
      } finally {
        setRecording(false);
        chunksRef.current = [];
        mr.stream.getTracks().forEach((t) => t.stop());
      }
    };
    mediaRecorderRef.current = mr;
    mr.start(250);
    setRecording(true);
  }, [recording]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop();
    }
  }, []);

  // Auto-start recording when page loads
  useEffect(() => {
    startRecording().catch(console.error);
  }, [startRecording]);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center p-4">
      <audio id="tts-audio" className="hidden" autoPlay />

      <div className="absolute top-16 text-center">
        <h2 className="text-2xl font-medium">Kira</h2>
        <p className="text-lg text-neutral-500">{recording ? formatTime(timer) : 'idle'}</p>
      </div>

      <VoiceOrb size={280} />

      <div className="fixed bottom-16 left-1/2 -translate-x-1/2">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={startRecording}
            disabled={recording}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-500/30 text-white transition-colors hover:bg-neutral-500/50 disabled:opacity-50"
            title="Start"
          >
            <Mic size={24} />
          </button>
          <button
            onClick={stopRecording}
            disabled={!recording}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            title="Stop"
          >
            <Square size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
