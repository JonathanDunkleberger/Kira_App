"use client";
import { Check, Lock, MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import Modal from '../ui/Modal';

export type LimitDialogMode = 'paywall' | 'chat-cap';

export type LimitDialogProps = {
  open: boolean;
  mode: LimitDialogMode;
  remainingToday?: number;
  remainingThisChat?: number;
  usedToday?: number;
  usedThisChat?: number;
  todayCap?: number;
  chatCap?: number;
  isAuthed?: boolean;
  isPro?: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  onLogin?: () => void;
  onNewChat?: () => void;
};

function fmt(s?: number) {
  if (!Number.isFinite(s as number)) return '00:00';
  const n = Math.max(0, Math.floor(s as number));
  const m = Math.floor(n / 60);
  const ss = n % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function LimitDialog(props: LimitDialogProps) {
  const {
    open,
    mode,
    remainingToday,
    remainingThisChat,
    usedToday,
    usedThisChat,
    todayCap,
    chatCap,
    isAuthed,
    isPro,
    onClose,
    onUpgrade,
    onLogin,
    onNewChat,
  } = props;

  const title = mode === 'paywall' ? 'Daily free limit reached' : 'This chat hit its time limit';
  const blurb = mode === 'paywall'
    ? (isAuthed
        ? 'Upgrade to Pro to keep talking without daily limits.'
        : 'Sign in and upgrade to keep talking without daily limits.')
    : 'Each Pro conversation is capped to keep things fresh. Start a new chat to continue.';

  const Stat = ({ label, value, cap }: { label: string; value?: number; cap?: number }) => (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-white/50 dark:text-white/50 text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{fmt(value)}{cap ? ` / ${fmt(cap)}` : ''}</span>
    </div>
  );

  const Primary = () => {
    if (mode === 'paywall') {
      if (!isAuthed) {
        return (
          <Button className="w-full" onClick={onLogin}>
            <Lock className="mr-2 h-4 w-4" /> Sign in to upgrade
          </Button>
        );
      }
      if (!isPro) {
        return (
          <Button className="w-full" onClick={onUpgrade}>
            <Sparkles className="mr-2 h-4 w-4" /> Upgrade to Pro
          </Button>
        );
      }
      return (
  <Button className="w-full" onClick={onNewChat}>
          <MessageSquare className="mr-2 h-4 w-4" /> Start a new chat
        </Button>
      );
    }
    return (
      <Button className="w-full" onClick={onNewChat}>
        <MessageSquare className="mr-2 h-4 w-4" /> Start a new chat
      </Button>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={blurb}
      footer={
        <div className="flex flex-col w-full">
          <Primary />
          <Button variant="outline" className="w-full mt-2" onClick={onClose}>
            <Check className="mr-2 h-4 w-4" /> Close
          </Button>
        </div>
      }
    >
      <div className="rounded-xl border border-neutral-200/60 bg-neutral-50 p-3 space-y-2 text-sm">
        {mode === 'paywall' ? (
          <>
            <Stat label="Today" value={usedToday} cap={todayCap} />
            <Stat label="Remaining today" value={remainingToday} />
          </>
        ) : (
          <>
            <Stat label="This chat" value={usedThisChat} cap={chatCap} />
            <Stat label="Remaining in this chat" value={remainingThisChat} />
          </>
        )}
      </div>
    </Modal>
  );
}
