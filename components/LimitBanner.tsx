'use client';
import { useEffect, useState } from 'react';

import { startCheckout } from '@/lib/client-api';

// Lightweight banner shown when server sends limit_exceeded over voice WS.
export function LimitBanner() {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState('Daily free usage exhausted.');

  useEffect(() => {
    const handler = (e: any) => {
      setMessage(e?.detail?.message || 'Daily free usage exhausted.');
      setShow(true);
    };
    window.addEventListener('kira-limit-exceeded', handler as any);
    if ((window as any).__kiraLimitExceeded) setShow(true);
    return () => window.removeEventListener('kira-limit-exceeded', handler as any);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[70]">
      <div className="mx-auto max-w-xl mt-4 px-4">
        <div className="rounded-xl border border-rose-600/40 bg-gradient-to-br from-rose-900/70 to-fuchsia-900/60 backdrop-blur p-4 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-white">You reached today’s free limit</h3>
              <p className="text-xs text-white/70 mt-1">
                {message} Go unlimited to keep the conversation going without interruptions.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => startCheckout()}
                className="rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-medium px-3 py-2"
              >
                Upgrade
              </button>
              <button
                onClick={() => setShow(false)}
                className="rounded-lg border border-white/20 text-white/80 hover:bg-white/5 text-xs font-medium px-3 py-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LimitBanner;
