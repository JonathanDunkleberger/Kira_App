'use client';
import { useEffect, useMemo, useState } from 'react';
import { voiceBus } from '@/lib/voiceBus';
import { useAudioLevel } from '@/lib/hooks/useAudioLevel';
import { cn } from '@/lib/utils';

// Subtle, natural motion constants
const ORB_BREATHE_MS = 7500; // slower breathe
const ORB_BREATHE_MIN = 0.992; // 0.992 → 1.008 scale
const ORB_BREATHE_MAX = 1.008;
const REACTIVE_GAIN = 0.04; // was 0.08

const WAVE_MS = 3000; // slower wave
const WAVE_SCALE_MAX = 2.2; // was ~2.8
const WAVE_RING_PX = 1.25; // thinner stroke
const WAVE_OPACITY = 0.26; // start opacity

type Props = {
  audioEl?: HTMLAudioElement | null;
  size?: number; // px
  className?: string;
  multiHue?: boolean; // enable gradient animated rings
};

export default function VoiceOrb({ audioEl, size = 260, className, multiHue = true }: Props) {
  const { level, isSpeaking: fromAudio } = useAudioLevel({ audioEl });
  const [fromEvents, setFromEvents] = useState(false);
  const isSpeaking = fromAudio || fromEvents;

  useEffect(() => {
    const off = voiceBus.on<boolean>('speaking', (v) => setFromEvents(Boolean(v)));
    return off;
  }, []);

  // Baseline breathing scale
  const breatheScale = useMemo(() => (isSpeaking ? 1.02 : 1.015), [isSpeaking]);
  const reactive = 1 + level * REACTIVE_GAIN; // gentler audio-reactive scale

  const s = size;
  const ring1 = s * 1.25;
  const ring2 = s * 1.65;

  return (
    <div
      className={cn('relative mx-auto my-8 select-none', className)}
      style={{ width: s, height: s }}
    >
      {/* Speaking waves */}
  <Waves active={isSpeaking} baseSize={s} multiHue={multiHue} />

      {/* GLOW RINGS */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          transform: `scale(${breatheScale})`,
          transition: 'transform 1200ms cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '0 0 42px 14px rgba(139,153,100,0.14)',
        }}
      />
      <div
        data-orb-halo="1"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: ring1,
          height: ring1,
          borderRadius: '9999px',
          border: '6px solid rgba(0,0,0,0.05)',
        }}
      />
      <div
        data-orb-halo="2"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: ring2,
          height: ring2,
          borderRadius: '9999px',
          border: '3px solid rgba(0,0,0,0.035)',
        }}
      />

      {/* CORE ORB — palantír style, always breathing */}
      <div
        className="orb-breathe absolute inset-0 rounded-full"
        style={{
          animation: `orb-breathe ${ORB_BREATHE_MS}ms ease-in-out infinite`,
          // pass min/max as CSS vars so CSS can read them
          // @ts-ignore
          ['--min' as any]: ORB_BREATHE_MIN,
          // @ts-ignore
          ['--max' as any]: ORB_BREATHE_MAX,
        }}
      >
        <div
          className="orb-core absolute inset-0 rounded-full"
          /* inner layer handles audio-reactive scale so both effects compose */
          style={{ transform: `scale(${reactive})`, transition: 'transform 120ms ease-out' }}
        >
          {/* base color bed (radial pistachio -> olive) */}
          <div className="orb-bg absolute inset-0 rounded-full" />

          {/* slow swirling caustics (conic gradient masked to center) */}
            <div className="orb-swirls absolute inset-0 rounded-full" />
            <div className="orb-swirls orb-swirls--rev absolute inset-0 rounded-full" />

          {/* soft top-left specular highlight */}
          <div className="orb-sheen absolute inset-0 rounded-full" />

          {/* inner rim / vignette for depth */}
          <div className="orb-rim absolute inset-0 rounded-full pointer-events-none" />
        </div>

        {/* style block specific to the orb */}
        <style jsx>{`
          /* breathing scale (outer wrapper) */
          @keyframes orb-breathe {
            0%, 100% { transform: scale(var(--min)); filter: saturate(1) brightness(1); }
            50%      { transform: scale(var(--max)); filter: saturate(1.03) brightness(1.02); }
          }

          /* base bed: soft pistachio gradient */
          .orb-bg {
            background:
              radial-gradient(120% 120% at 30% 20%,
                #eef4df 0%,
                #dbe6bf 38%,
                #c3d197 62%,
                #a9ba7b 100%);
            box-shadow:
              inset 0 10px 30px rgba(255,255,255,0.55),
              inset 0 -22px 40px rgba(90,90,60,0.15);
          }
          :global(.dark) .orb-bg {
            background:
              radial-gradient(120% 120% at 30% 20%,
                #d6e4b6 0%,
                #bfd487 40%,
                #a6c06a 70%,
                #8cab55 100%);
            box-shadow:
              inset 0 10px 34px rgba(255,255,255,0.45),
              inset 0 -24px 44px rgba(40,50,25,0.35);
          }

          /* swirling caustics */
          .orb-swirls {
            background:
              conic-gradient(
                from 0deg,
                hsl(78 65% 68% / 0.35),
                hsl(95 60% 64% / 0.35),
                hsl(60 75% 72% / 0.35),
                hsl(78 65% 68% / 0.35)
              );
            /* keep swirls near the center; fade at edge */
            -webkit-mask: radial-gradient(closest-side, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 65%, rgba(0,0,0,0) 100%);
                    mask: radial-gradient(closest-side, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 65%, rgba(0,0,0,0) 100%);
            mix-blend-mode: multiply;
            animation: orb-spin 18s linear infinite, hue-shift 14s linear infinite;
          }
          .orb-swirls--rev { animation-duration: 24s; animation-direction: reverse; opacity: 0.8; }
          @keyframes orb-spin { to { transform: rotate(360deg); } }
          @keyframes hue-shift { to { filter: hue-rotate(360deg); } }

          :global(.dark) .orb-swirls {
            mix-blend-mode: screen; /* additive look in dark */
            background:
              conic-gradient(
                from 0deg,
                hsl(78 92% 78% / 0.55),
                hsl(95 88% 72% / 0.55),
                hsl(60 95% 76% / 0.55),
                hsl(78 92% 78% / 0.55)
              );
          }

          /* specular sheen */
            .orb-sheen {
            background:
              radial-gradient(60% 42% at 28% 22%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0) 70%);
            transform: rotate(-8deg);
            filter: blur(0.5px);
          }
          :global(.dark) .orb-sheen {
            background:
              radial-gradient(60% 42% at 28% 22%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0) 72%);
          }

          /* inner rim / vignette for depth */
          .orb-rim {
            box-shadow:
              inset 0 0 0 1px rgba(255,255,255,0.35),
              inset 0 0 40px rgba(0,0,0,0.08),
              inset 0 40px 80px rgba(0,0,0,0.10);
          }
          :global(.dark) .orb-rim {
            box-shadow:
              inset 0 0 0 1px rgba(255,255,255,0.22),
              inset 0 0 60px rgba(10,10,10,0.35),
              inset 0 50px 120px rgba(0,0,0,0.45);
          }

          /* accessibility: reduce motion */
          @media (prefers-reduced-motion: reduce) {
            .orb-swirls, .orb-swirls--rev { animation: none; }
            .orb-breathe { animation: none !important; }
          }
          /* dark overrides for halos */
          :global(.dark) div[data-orb-halo='1'] { border-color: rgba(255,255,255,0.06) !important; }
          :global(.dark) div[data-orb-halo='2'] { border-color: rgba(255,255,255,0.04) !important; }
        `}</style>
      </div>
    </div>
  );
}

function Waves({ active, baseSize, multiHue }: { active: boolean; baseSize: number; multiHue: boolean }) {
  if (!active) return null;
  return (
    <>
      <div className={multiHue ? 'wave wave-g' : 'wave'} />
      <div className={multiHue ? 'wave wave-g' : 'wave'} />
      <div className={multiHue ? 'wave wave-g' : 'wave'} />
      <style jsx>{`
        .wave {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${baseSize}px;
          height: ${baseSize}px;
          border-radius: 9999px;
          transform: translate(-50%, -50%) scale(1);
          opacity: 0;
          pointer-events: none;
          border: ${WAVE_RING_PX}px solid hsl(var(--primary) / 0.28);
          filter: blur(0.15px);
          animation: wave-expand ${WAVE_MS}ms ease-out infinite;
        }
        .wave:nth-child(1) { animation-delay: 0s; }
        .wave:nth-child(2) { animation-delay: ${WAVE_MS / 3}ms; }
        .wave:nth-child(3) { animation-delay: ${(WAVE_MS / 3) * 2}ms; }

        :global(.dark) .wave {
          border-color: hsl(78 45% 72% / 0.45);
          mix-blend-mode: screen;
        }

        .wave-g {
          border: none;
          background: conic-gradient(
            from 0deg,
            hsl(78 70% 70% / 0.85),
            hsl(95 70% 65% / 0.85),
            hsl(60 85% 72% / 0.85),
            hsl(78 70% 70% / 0.85)
          );
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - ${WAVE_RING_PX}px), #000 calc(100% - ${WAVE_RING_PX}px));
                  mask: radial-gradient(farthest-side, transparent calc(100% - ${WAVE_RING_PX}px), #000 calc(100% - ${WAVE_RING_PX}px));
          animation: wave-expand ${WAVE_MS}ms ease-out infinite, hue-shift 10s linear infinite;
        }
        :global(.dark) .wave-g { mix-blend-mode: screen; }

        @keyframes wave-expand {
          0%   { transform: translate(-50%, -50%) scale(1);    opacity: ${WAVE_OPACITY}; }
          70%  { opacity: ${Math.max(0.14, 0.26 * 0.6)}; }
          100% { transform: translate(-50%, -50%) scale(${WAVE_SCALE_MAX}); opacity: 0; }
        }
        @keyframes hue-shift { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .wave-g { animation: wave-expand ${WAVE_MS}ms ease-out infinite; } }
      `}</style>
    </>
  );
}
