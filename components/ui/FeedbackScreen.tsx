"use client";
import { useState } from 'react';
import { Button } from './Button';

interface FeedbackScreenProps {
  onContinue?: () => void;
}

export function FeedbackScreen({ onContinue }: FeedbackScreenProps) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = stars > 0 || note.trim().length > 0;

  async function submit() {
    if (!canSubmit) return onContinue?.();
    setSubmitting(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: stars || null, note: note.trim() || null }),
      });
    } catch (e) {
      // swallow
    } finally {
      setSubmitting(false);
      onContinue?.();
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto text-center space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">How was your conversation?</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Your feedback helps improve Kira.
        </p>
      </div>
      <div className="flex items-center justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || stars) >= n;
          return (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setStars(n === stars ? 0 : n)}
              className="text-2xl"
              aria-label={`Rate ${n}`}
            >
              <span className={active ? 'text-amber-400' : 'text-neutral-400'}>{active ? '★' : '☆'}</span>
            </button>
          );
        })}
      </div>
      <textarea
        placeholder="Optional comments..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full h-28 resize-none rounded-md border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300/40"
      />
      <div>
        <Button onClick={submit} disabled={submitting || !canSubmit} className="w-full">
          {submitting ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
