'use client';
import { useEffect, useMemo, useState } from 'react';
import { voiceBus } from '@/lib/voiceBus';
import { useAudioLevel } from '@/lib/hooks/useAudioLevel';
import { cn } from '@/lib/utils';

type Props = {
  audioEl?: HTMLAudioElement | null;
  size?: number; // px
  className?: string;
};

export default function VoiceOrb({ audioEl, size = 260, className }: Props) {
  const { level, isSpeaking: fromAudio } = useAudioLevel({ audioEl });
  const [fromEvents, setFromEvents] = useState(false);
  const isSpeaking = fromAudio || fromEvents;

  useEffect(() => {
    const off = voiceBus.on<boolean>('speaking', (v) => setFromEvents(Boolean(v)));
    return off;
  }, []);

  // Baseline breathing scale
  const breatheScale = useMemo(() => (isSpeaking ? 1.02 : 1.015), [isSpeaking]);
  const reactive = 1 + level * 0.08; // Audio-reactive subtle scale

  const s = size;
  const ring1 = s * 1.25;
  const ring2 = s * 1.65;

  return (
    <div
      className={cn('relative mx-auto my-8 select-none', className)}
      style={{ width: s, height: s }}
    >
      {/* Speaking waves */}
      <Waves active={isSpeaking} />

      {/* Glow ring/breath */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          transform: `scale(${breatheScale})`,
          transition: 'transform 1200ms cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '0 0 60px 20px rgba(139,153,100,0.12)',
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: ring1,
          height: ring1,
          border: '10px solid rgba(0,0,0,0.03)',
          borderRadius: '9999px',
          filter: 'blur(0.2px)',
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: ring2,
          height: ring2,
          border: '6px solid rgba(0,0,0,0.02)',
          borderRadius: '9999px',
          filter: 'blur(0.2px)',
        }}
      />

      {/* Core orb */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          transform: `scale(${reactive})`,
          transition: 'transform 120ms ease-out',
          background:
            'radial-gradient(120% 120% at 30% 20%, #e9efd8 0%, #c6d09a 50%, #aab97d 100%)',
          boxShadow:
            'inset 0 10px 30px rgba(255,255,255,0.6), inset 0 -20px 40px rgba(120,120,80,0.15)',
        }}
      />

      <style jsx>{`
        .wave {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${s}px;
          height: ${s}px;
          border-radius: 9999px;
          border: 2px solid rgba(139, 153, 100, 0.12);
          transform: translate(-50%, -50%) scale(1);
          opacity: 0;
          animation: wave 2.2s ease-out infinite;
          pointer-events: none;
        }
        .wave:nth-child(1) {
          animation-delay: 0s;
        }
        .wave:nth-child(2) {
          animation-delay: 0.6s;
        }
        .wave:nth-child(3) {
          animation-delay: 1.2s;
        }
        @keyframes wave {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.25;
          }
          70% {
            opacity: 0.12;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.4);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

function Waves({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <div className="wave" />
      <div className="wave" />
      <div className="wave" />
    </>
  );
}
