'use client';
import * as React from 'react';
import { clsx } from 'clsx';

import { Button } from './Button';

export interface CharacterCardProps {
  name: string;
  subtitle?: string;
  description?: string;
  avatar?: React.ReactNode; // image / illustration
  footer?: React.ReactNode; // actions
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  className?: string;
}

export function CharacterCard({
  name,
  subtitle,
  description,
  avatar,
  footer,
  onPrimaryAction,
  primaryActionLabel = 'Continue',
  className,
}: CharacterCardProps) {
  return (
    <div
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-200/60 backdrop-blur shadow-xl shadow-black/40',
        'p-6 gap-4 max-w-md',
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {avatar && (
          <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-surface-300 flex items-center justify-center">
            {avatar}
          </div>
        )}
        <div className="flex-1 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-cream-100">{name}</h2>
          {subtitle && <p className="text-sm text-cream-300/80">{subtitle}</p>}
        </div>
      </div>
      {description && <p className="text-sm leading-relaxed text-cream-200/90">{description}</p>}
      <div className="mt-2 flex gap-3 items-center">
        {onPrimaryAction && (
          <Button onClick={onPrimaryAction} variant="primary" className="flex-1">
            {primaryActionLabel}
          </Button>
        )}
        {footer}
      </div>
    </div>
  );
}
