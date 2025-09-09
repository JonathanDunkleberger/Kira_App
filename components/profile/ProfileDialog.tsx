"use client";
import { useEffect } from 'react';
import Link from 'next/link';

export interface ProfileDialogProps {
  open: boolean;
  onOpenChange(v: boolean): void;
  email?: string | null;
  displayName?: string | null;
}

export function ProfileDialog({ open, onOpenChange, email, displayName }: ProfileDialogProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div role="dialog" aria-modal="true" className="relative w-[min(480px,92vw)] rounded-2xl bg-[#12101b]/95 border border-white/10 shadow-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Profile</h2>
            {displayName ? <p className="text-sm text-white/60 mt-0.5">{displayName}</p> : null}
            {email ? <p className="text-xs text-white/40 mt-0.5">{email}</p> : null}
          </div>
          <button onClick={() => onOpenChange(false)} className="rounded-md px-2 py-1 text-xs bg-white/10 hover:bg-white/20">Close</button>
        </div>
        <div className="space-y-4 text-sm">
          <p className="text-white/70">Manage your account, subscription, and data preferences.</p>
          <ul className="text-xs text-white/60 space-y-1 list-disc pl-5">
            <li>Your conversations help improve Kira when you are signed in.</li>
            <li>Audio is not stored; only transcripts (if authenticated).</li>
          </ul>
          <div className="pt-2 border-t border-white/10">
            <p className="text-xs uppercase tracking-wide text-white/40 mb-2">Legal</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/privacy" className="text-fuchsia-300 hover:text-fuchsia-200 underline-offset-4 hover:underline">Privacy Policy</Link>
              <Link href="/terms" className="text-fuchsia-300 hover:text-fuchsia-200 underline-offset-4 hover:underline">Terms of Service</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfileDialog;