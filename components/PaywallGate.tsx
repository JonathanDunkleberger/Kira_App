'use client';
import { ReactNode, useMemo } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function PaywallGate({ children }: { children: ReactNode }) {
  const { usageRemaining } = useConversation();
  const out = useMemo(
    () => typeof usageRemaining === 'number' && usageRemaining <= 0,
    [usageRemaining],
  );

  if (!out) return <>{children}</>;

  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-4 text-center">
      <div className="text-lg font-semibold mb-1">You’ve hit today’s free limit</div>
      <div className="text-sm opacity-80 mb-4">
        Come back tomorrow or upgrade to keep the convo going.
      </div>
      <div className="flex justify-center gap-3">
        <a className="px-3 py-2 rounded bg-white text-black" href="/subscribe">
          Upgrade
        </a>
        <a className="px-3 py-2 rounded bg-white/10 hover:bg-white/20" href="/pricing">
          See plans
        </a>
      </div>
    </div>
  );
}
