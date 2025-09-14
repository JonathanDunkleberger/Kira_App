'use client';
import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';

import { Button } from './Button';

export interface ProfileCardProps {
  trigger?: React.ReactNode;
  email?: string | null;
  tier?: string;
  onLogout?: () => void;
  onUpgrade?: () => void;
  children?: React.ReactNode;
}

export function ProfileCard({
  trigger,
  email,
  tier = 'free',
  onLogout,
  onUpgrade,
  children,
}: ProfileCardProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        {trigger ?? <Button variant="secondary">Account</Button>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          className={clsx(
            'fixed left-1/2 top-1/2 w-[95vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10',
            'bg-surface-200/80 backdrop-blur p-6 shadow-2xl shadow-black/50 focus:outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
          )}
        >
          <div className="space-y-1 mb-4">
            <Dialog.Title className="text-lg font-semibold text-cream-100">Account</Dialog.Title>
            <Dialog.Description className="text-xs text-cream-300/70">
              Manage your subscription and preferences.
            </Dialog.Description>
          </div>
          <div className="space-y-3 text-sm">
            {email && (
              <div className="flex justify-between">
                <span className="text-cream-300/80">Email</span>
                <span className="font-medium text-cream-100">{email}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-cream-300/80">Plan</span>
              <span className="font-medium capitalize text-cream-100">{tier}</span>
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            {tier === 'free' && (
              <Button variant="primary" className="flex-1" onClick={onUpgrade}>
                Upgrade
              </Button>
            )}
            <Button variant="ghost" className="flex-1" onClick={onLogout}>
              Log out
            </Button>
          </div>
          {children && <div className="mt-6 border-t border-white/10 pt-4 text-sm">{children}</div>}
          <Dialog.Close asChild>
            <button
              className="absolute right-3 top-3 text-cream-300/60 hover:text-cream-100 transition"
              aria-label="Close"
            >
              ✕
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
