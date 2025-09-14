'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../ui/Button';

// TODO: Replace with real panels (using existing paths; fallbacks to stubs if missing)
// For now, attempt imports dynamically (non-SSR) would add complexity; keep static assuming they exist.
import ProfilePanel from './ProfilePanel';
// Optional specialized panels; if they do not exist, you can add them later.
// import PreferencesPanel from '@/components/panels/PreferencesPanel';
// import BillingPanel from '@/components/panels/BillingPanel';
// import FeedbackPanel from '@/components/panels/FeedbackPanel';
// import AuthPanel from '@/components/panels/AuthPanel';

export type ProfileHubProps = { open: boolean; onOpenChange(open: boolean): void };

export default function ProfileHub({ open, onOpenChange }: ProfileHubProps) {
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;

  const el = (
    <div className="fixed inset-0 z-[200] grid place-items-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[min(720px,92vw)] max-h-[86vh] overflow-y-auto rounded-2xl shadow-xl bg-[rgba(255,255,245,0.96)] dark:bg-[rgba(18,20,14,0.96)] p-5 md:p-6 custom-scrollbar"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Your account</h2>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
        <HubBody />
      </div>
    </div>
  );
  return createPortal(el, typeof document !== 'undefined' ? document.body : ({} as any));
}

function HubBody() {
  // Supabase removed: always show profile panel placeholder for now.
  return (
    <div className="py-6">
      <ProfilePanel variant="panel" />
    </div>
  );
}
