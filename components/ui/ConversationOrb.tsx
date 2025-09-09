"use client";
import * as React from 'react';
import { clsx } from 'clsx';

export type OrbState = 'idle' | 'listening' | 'speaking' | 'error';

export interface ConversationOrbProps {
  state?: OrbState;
  size?: number;
  className?: string;
  pulse?: boolean; // force pulse animation
  children?: React.ReactNode; // overlay content (e.g., level, icon)
}

export function ConversationOrb({
  state = 'idle',
  size = 160,
  className,
  pulse,
  children,
}: ConversationOrbProps) {
  const glow =
    state === 'error'
      ? 'shadow-[0_0_40px_-5px_#ef4444aa] bg-red-600/30'
      : state === 'speaking'
        ? 'shadow-[0_0_50px_-10px_#55c966aa] bg-pistachio-500/25'
        : state === 'listening'
          ? 'shadow-[0_0_55px_-5px_#7dd486aa] bg-pistachio-400/20'
          : 'shadow-[0_0_35px_-8px_#ffffff33] bg-cream-200/5';

  const pulseAnim =
    pulse || state === 'listening'
      ? 'animate-[pulseSoft_2s_ease-in-out_infinite]'
      : state === 'speaking'
        ? 'animate-[breath_3.2s_ease-in-out_infinite]' 
        : '';

  return (
    <div
      className={clsx(
        'relative grid place-items-center rounded-full select-none transition-all duration-500',
        glow,
        pulseAnim,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div
        className={clsx(
          'absolute inset-0 rounded-full overflow-hidden opacity-70 mix-blend-screen',
          'bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.35),transparent_60%),radial-gradient(circle_at_70%_70%,rgba(85,201,102,0.35),transparent_55%)]',
        )}
      />
      <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#55c96622,#55c96600_60%,#ffffff11_80%,#55c96622)] animate-spin-slow" />
      {children && <div className="relative z-10 text-cream-100 drop-shadow-lg">{children}</div>}
      <style jsx>{`
        @keyframes pulseSoft {
          0%,100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.9; }
        }
        @keyframes breath {
          0%,100% { transform: scale(1); }
          25% { transform: scale(1.05); }
          50% { transform: scale(1.02); }
          75% { transform: scale(1.07); }
        }
        .animate-spin-slow { animation: spin 18s linear infinite; }
      `}</style>
    </div>
  );
}
