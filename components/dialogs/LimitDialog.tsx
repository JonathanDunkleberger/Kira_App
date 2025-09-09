'use client';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export type LimitDialogMode = 'paywall' | 'chat-cap';

function fmt(s: number) {
  const m = Math.floor(s / 60),
    ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

type Props = {
  open: boolean;
  mode: LimitDialogMode;
  remainingToday?: number; // seconds (for paywall heads-up; 0 when reached)
  remainingThisChat?: number; // seconds (for chat-cap heads-up; 0 when reached)
  onClose?: () => void;
  onUpgrade?: () => void; // paywall CTA
  onNewChat?: () => void; // chat-cap CTA
};

export default function LimitDialog({
  open,
  mode,
  remainingToday,
  remainingThisChat,
  onClose,
  onUpgrade,
  onNewChat,
}: Props) {
  const isPaywall = mode === 'paywall';
  const capped = isPaywall ? remainingToday === 0 : remainingThisChat === 0;

  const title = isPaywall
    ? capped
      ? 'Daily free limit reached'
      : 'You’re nearing today’s free limit'
    : capped
      ? 'This chat hit its time limit'
      : 'This chat is nearing its limit';

  const desc = isPaywall
    ? capped
      ? 'You’ve used your free minutes for today. Come back tomorrow or upgrade to Pro for unlimited daily usage.'
      : `You have ${fmt(remainingToday ?? 0)} of free time left today.`
    : capped
      ? 'Start a new chat to keep going.'
      : `You have ${fmt(remainingThisChat ?? 0)} left in this chat.`;

  const footer = isPaywall ? (
    <>
      <Button variant="ghost" onClick={onClose!}>
        Close
      </Button>
      <Button onClick={onUpgrade!}>Upgrade</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose!}>
        Not now
      </Button>
      <Button onClick={onNewChat!}>{capped ? 'Start new chat' : 'Keep chatting'}</Button>
    </>
  );

  return <Modal open={open} onClose={onClose} title={title} description={desc} footer={footer} />;
}
