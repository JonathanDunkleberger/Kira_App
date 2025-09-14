'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { FeedbackScreen } from '../../../components/ui/FeedbackScreen';
import { Button } from '../../../components/ui/Button';
import { useAudioCapture } from '../../../lib/useAudioCapture';
import { publicEnv } from '../../../lib/config';

type CallState = 'connecting' | 'listening' | 'speaking' | 'ended';

export default function ConversationPage({ params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  const router = useRouter();
  if (!conversationId) notFound();

  const [state, setState] = useState<CallState>('connecting');
  const [muted, setMuted] = useState(false);
  const [lastUserText, setLastUserText] = useState('');
  const [lastAssistantText, setLastAssistantText] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [serverSeconds, setServerSeconds] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pendingSpeakingEndRef = useRef(false);

  const { rms } = useAudioCapture(!muted && state !== 'ended');

  // Timer
  useEffect(() => {
    if (state === 'ended') return;
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt, state]);

  // Connect WebSocket (minimal handshake; listen-first)
  useEffect(() => {
    if (state === 'ended') return;
    const base =
      publicEnv.NEXT_PUBLIC_WEBSOCKET_URL ||
      process.env.NEXT_PUBLIC_WS_URL ||
      'ws://localhost:10000';
    const url = `${base}?conversationId=${conversationId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      // Send handshake letting server know we are ready
      ws.send(
        JSON.stringify({
          type: 'client_ready',
          conversationId,
          // userId omitted for guests (server treats absence as guest)
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case 'server_ack':
            setState('listening');
            setStartedAt((s) => s || Date.now());
            break;
          case 'limit_exceeded':
            setLimitReached(true);
            endCall();
            break;
          case 'assistant_speaking_start':
            setState('speaking');
            break;
          case 'assistant_speaking_end':
            // If audio still playing, mark pending; else transition now
            if (pendingSpeakingEndRef.current) {
              // already pending
            } else if (state === 'speaking') {
              // Audio may not yet have arrived; set pending until playback finishes
              pendingSpeakingEndRef.current = true;
            } else {
              setState('listening');
            }
            break;
          case 'user_transcript':
            setLastUserText(msg.text || '');
            break;
          case 'assistant_message':
            setLastAssistantText(msg.text || '');
            break;
          case 'assistant_audio': {
            // Lazy init audio context
            if (!audioCtxRef.current) {
              audioCtxRef.current = new (window.AudioContext ||
                (window as any).webkitAudioContext)();
            }
            const ctx = audioCtxRef.current;
            const { data, encoding } = msg;
            if (encoding === 'base64' && data) {
              try {
                setState('speaking');
                const binary = atob(data);
                const len = binary.length;
                const buffer = new ArrayBuffer(len);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < len; i++) view[i] = binary.charCodeAt(i);
                ctx.decodeAudioData(buffer.slice(0)).then((audioBuffer) => {
                  const src = ctx.createBufferSource();
                  src.buffer = audioBuffer;
                  src.connect(ctx.destination);
                  src.onended = () => {
                    if (pendingSpeakingEndRef.current) {
                      pendingSpeakingEndRef.current = false;
                      setState('listening');
                    } else if (state === 'speaking') {
                      setState('listening');
                    }
                  };
                  src.start();
                });
              } catch {}
            }
            break;
          }
          case 'usage_update':
            if (typeof msg.seconds === 'number') setServerSeconds(msg.seconds);
            break;
          default:
            break;
        }
      } catch {}
    };
    ws.onclose = () => {
      // use functional update to read the latest state safely
      setState((prev) => {
        if (prev === 'ended') return prev;
        if (reconnectAttempts.current < 1) {
          reconnectAttempts.current += 1;
          setTimeout(() => setState('connecting'), 400);
          return prev; // keep prior state until reconnect attempt sets connecting
        }
        return 'ended';
      });
    };
    ws.onerror = () => {
      ws.close();
    };
    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, state === 'connecting']);

  const endCall = useCallback(() => {
    wsRef.current?.close();
    setState('ended');
  }, []);

  // Animated orb style (scale with rms)
  const orbScale = 1 + Math.min(1, rms * 40);

  if (state === 'ended') {
    return (
      <main className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6">
        <FeedbackScreen onContinue={() => router.push('/')} />
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center gap-12 p-6 text-center">
      {/* Timer */}
      <div className="absolute top-20 text-xs tracking-wide text-neutral-600 dark:text-neutral-400 flex gap-2 items-center">
        <span>
          {state === 'connecting'
            ? 'Connecting to Kira…'
            : `${Math.floor(elapsed / 1000)}s ${state === 'speaking' ? '•' : ''}`}
        </span>
        {serverSeconds !== null && (
          <span className="px-1.5 py-0.5 rounded bg-neutral-200/60 dark:bg-neutral-700/50 text-[10px] font-medium">
            {serverSeconds}s
          </span>
        )}
      </div>
      {/* Orb */}
      <div className="flex flex-col items-center gap-6">
        <div
          className="relative w-56 h-56 rounded-full bg-gradient-to-br from-amber-300/70 to-amber-500/60 dark:from-amber-400/40 dark:to-amber-600/30 shadow-lg transition-transform duration-150 ease-out flex items-center justify-center"
          style={{
            transform: `scale(${orbScale.toFixed(3)})`,
            filter: muted ? 'grayscale(0.5)' : 'none',
          }}
        >
          <div className="absolute inset-0 rounded-full animate-ping bg-amber-300/10 dark:bg-amber-500/10" />
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-100">
            {state === 'connecting' && '...'}
            {state === 'listening' && 'Listening'}
            {state === 'speaking' && 'Speaking'}
          </span>
        </div>
        <div className="w-72 text-left text-xs space-y-2 text-neutral-600 dark:text-neutral-300">
          {limitReached && (
            <p className="text-amber-600 dark:text-amber-400 font-medium">
              Daily free limit reached.
            </p>
          )}
          {lastUserText && (
            <p>
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">You:</span>{' '}
              {lastUserText}
            </p>
          )}
          {lastAssistantText && (
            <p>
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">Kira:</span>{' '}
              {lastAssistantText}
            </p>
          )}
        </div>
      </div>
      {/* Controls */}
      <div className="flex items-center gap-6">
        <Button
          variant={muted ? 'outline' : 'secondary'}
          onClick={() => setMuted((m) => !m)}
          disabled={state === 'connecting' || limitReached}
        >
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button variant="destructive" onClick={endCall} disabled={state === 'connecting'}>
          End call
        </Button>
      </div>
      <div className="text-[10px] text-neutral-400">Session: {conversationId}</div>
    </main>
  );
}
