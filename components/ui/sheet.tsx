'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Minimal sheet implementation (side drawer) for right side only
export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  return (
    <div
      className={cn('fixed inset-0 z-[120] transition', open ? '' : 'pointer-events-none')}
      aria-hidden={!open}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={() => onOpenChange(false)}
      />
      {children}
    </div>
  );
}

export function SheetContent({
  side = 'right',
  className,
  children,
}: {
  side?: 'right';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute top-0 h-full w-[380px] sm:w-[420px] bg-background text-foreground shadow-xl flex flex-col',
        side === 'right' ? 'right-0' : '',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SheetHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('px-4 pt-4', className)}>{children}</div>;
}

export function SheetTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <h2 className={cn('text-base font-medium', className)}>{children}</h2>;
}
