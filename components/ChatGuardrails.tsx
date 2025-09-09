'use client';
import { useEffect, useState } from 'react';

import PaywallModal from '@/components/PaywallModal';
import ChatCapModal from '@/components/ChatCapModal';

export default function ChatGuardrails({ children }: { children: React.ReactNode }) {
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCap, setShowCap] = useState(false);
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.t === 'heartbeat') {
        if (msg.paywall) setShowPaywall(true);
        if (msg.hardStop) setShowCap(true);
      }
    };
    (window as any).__onHeartbeat = handler;
    return () => {
      if ((window as any).__onHeartbeat === handler) (window as any).__onHeartbeat = null;
    };
  }, []);
  return (
    <>
      {children}
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} />}
      {showCap && <ChatCapModal onNewChat={() => (location.href = '/chat')} />}
    </>
  );
}
