"use client";
import { useEffect, useState } from 'react';

import LimitDialog, { type LimitDialogMode } from '@/components/dialogs/LimitDialog';
import { useUsage } from '@/lib/useUsage';

export default function ChatGuardrails({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LimitDialogMode>('paywall');
  const [remainingToday, setRemainingToday] = useState(0);
  const [remainingThisChat, setRemainingThisChat] = useState(0);
  const { server } = useUsage();

  useEffect(() => {
    const handler = (msg: any) => {
      if (!msg || msg.t !== 'heartbeat') return;
      const isPro = server?.todaySecondsLimit === 0;
      if (!isPro) {
        if (msg.remainingToday > 0 && msg.remainingToday <= 120) {
          setMode('paywall'); setRemainingToday(msg.remainingToday); setOpen(true);
        }
        if (msg.paywall) { setMode('paywall'); setRemainingToday(0); setOpen(true); }
      }
      if (msg.remainingThisChat > 0 && msg.remainingThisChat <= 120) {
        setMode('chat-cap'); setRemainingThisChat(msg.remainingThisChat); setOpen(true);
      }
      if (msg.hardStop) { setMode('chat-cap'); setRemainingThisChat(0); setOpen(true); }
    };
    (window as any).__onHeartbeat = handler;
    return () => { if ((window as any).__onHeartbeat === handler) (window as any).__onHeartbeat = null; };
  }, [server]);

  return (
    <>
      {children}
      <LimitDialog
        open={open}
        mode={mode}
        remainingToday={remainingToday}
        remainingThisChat={remainingThisChat}
        onClose={() => setOpen(false)}
        onUpgrade={() => (location.href = '/upgrade')}
        onNewChat={() => (location.href = '/chat')}
      />
    </>
  );
}
