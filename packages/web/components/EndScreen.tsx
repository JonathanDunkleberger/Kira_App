'use client';
import { useState } from 'react';

import { Button } from './ui/Button';

interface EndScreenProps {
  conversationId?: string;
  onRestart?: () => void;
}

export function EndScreen({ conversationId, onRestart }: EndScreenProps) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    if (stars === 0 && !note.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stars,
          note: note.trim() || null,
          conversationId: conversationId || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed'));
      setSubmitted(true);
      setNote('');
      setStars(0);
      setTimeout(() => setSubmitted(false), 2500);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto w-full text-sm">
      <h2 className="text-xl font-semibold text-[var(--text)] mb-2">How was it?</h2>
      <p className="text-xs text-[var(--muted-text)] mb-4">
        Rate your call and share optional feedback.
      </p>
      <div className="flex items-center gap-1 mb-4">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || stars) >= n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n}`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setStars(n === stars ? 0 : n)}
              className="text-lg"
            >
              <span className={active ? 'text-amber-400' : 'text-gray-400'}>
                {active ? '★' : '☆'}
              </span>
            </button>
          );
        })}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional notes..."
        className="w-full h-28 resize-none rounded-md border border-black/10 dark:border-white/10 bg-[var(--surface)] p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 mb-4"
      />
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending || (stars === 0 && !note.trim())}>
          {pending ? 'Sending...' : 'Submit'}
        </Button>
        <Button variant="ghost" onClick={onRestart}>
          Restart
        </Button>
        {submitted && !error && (
          <span className="text-[10px] text-[var(--muted-text)]">Thanks!</span>
        )}
        {error && <span className="text-[10px] text-red-500">{error}</span>}
      </div>
    </div>
  );
}
