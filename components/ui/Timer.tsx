"use client";
import * as React from 'react';

export interface TimerProps {
  start?: boolean;
  onTick?: (seconds: number) => void;
  className?: string;
  initialSeconds?: number;
}

export function Timer({ start = false, onTick, className, initialSeconds = 0 }: TimerProps) {
  const [seconds, setSeconds] = React.useState(initialSeconds);
  React.useEffect(() => {
    if (!start) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        onTick?.(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [start, onTick]);

  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');

  return (
    <span className={className} aria-label="Elapsed time">
      {mm}:{ss}
    </span>
  );
}
