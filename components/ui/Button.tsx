'use client';
import React from 'react';

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' };
export function Button({ variant = 'primary', className, ...props }: Props) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm transition font-medium',
        variant === 'primary'
          ? 'bg-black text-white hover:bg-neutral-900 active:bg-neutral-800'
          : 'border border-neutral-200 text-neutral-800 hover:bg-neutral-50',
        className,
      )}
    />
  );
}
