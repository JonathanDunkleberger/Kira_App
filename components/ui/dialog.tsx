"use client";
import * as React from 'react';
import { clsx } from 'clsx';

interface DialogRootProps {
  open: boolean;
  onOpenChange?: (o: boolean) => void;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogRootProps> = ({ open, onOpenChange, children }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange?.(false);
      }}
    >
      {children}
    </div>
  );
};

const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    role="dialog"
    aria-modal="true"
    className={clsx(
      'w-full max-w-lg rounded-xl border border-white/10 bg-neutral-900 text-cream-100 shadow-lg animate-in fade-in zoom-in-95',
      className,
    )}
    {...props}
  />
);

const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...p }) => (
  <div className={clsx('space-y-1.5 mb-4', className)} {...p} />
);
const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...p }) => (
  <h2 className={clsx('text-lg font-semibold tracking-tight', className)} {...p} />
);
const DialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...p }) => (
  <p className={clsx('text-xs text-cream-300/70', className)} {...p} />
);
const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...p }) => (
  <div className={clsx('mt-6 flex items-center justify-end gap-2', className)} {...p} />
);

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
