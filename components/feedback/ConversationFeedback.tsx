'use client';
import { useState } from 'react';

interface ConversationFeedbackProps {
  conversationId: string;
}

export function ConversationFeedback({ conversationId }: ConversationFeedbackProps) {
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    if (!text.trim() && rating === 0) return; // require at least something
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim() || '(no message)',
            rating: rating || null,
            meta: { conversationId, ts: Date.now(), source: 'conversation_inline' },
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed'));
      setSubmitted(true);
      setText('');
      setRating(0);
      setTimeout(() => setSubmitted(false), 2500);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-300">Rating:</span>
        <div className="flex items-center gap-1">
          {[1,2,3,4,5].map((n) => {
            const active = (hover || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                aria-label={`Rate ${n}`}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n === rating ? 0 : n)}
                className="transition-colors"
              >
                <span className={active ? 'text-amber-400' : 'text-gray-400'}>{active ? '★' : '☆'}</span>
              </button>
            );
          })}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Optional comments..."
        className="w-full rounded-md border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={submitting || (!text.trim() && rating === 0)}
          onClick={submit}
          className="px-3 py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 disabled:opacity-40 text-primary"
        >
          {submitting ? 'Sending…' : 'Submit'}
        </button>
        {submitted && !error && <span className="text-[10px] text-gray-500 dark:text-gray-400">Thanks!</span>}
        {error && <span className="text-[10px] text-red-500">{error}</span>}
      </div>
    </div>
  );
}
