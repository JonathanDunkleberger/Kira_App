'use client';
import { useState } from 'react';

type Variant = 'panel' | 'page';

export default function FeedbackPanel({ variant = 'panel' }: { variant?: Variant }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submitFeedback(message: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed'));
      setSubmitted(true);
      setText('');
      setTimeout(() => setSubmitted(false), 2500);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setPending(false);
    }
  }
  const shell =
    variant === 'panel'
      ? 'px-4 py-3 space-y-4 text-sm'
      : 'container mx-auto max-w-2xl py-10 space-y-6 text-sm';
  return (
    <form
      className={shell}
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim() || pending) return;
        submitFeedback(text.trim());
      }}
    >
      <h2 className="text-lg font-semibold">Feedback</h2>
      <p className="text-white/70">Have feedback? Let us know.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-black/20 p-2 h-32 text-xs resize-none"
        placeholder="Share your thoughts..."
      />
      <div className="flex gap-2 items-center">
        <button
          type="submit"
          disabled={!text.trim() || pending}
          className="px-3 py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 disabled:opacity-40 text-primary text-xs"
        >
          {pending ? 'Sending…' : 'Submit'}
        </button>
        {submitted && !error && <span className="text-xs text-white/50">Thanks!</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </form>
  );
}
