'use client';
import { useEffect, useState } from 'react';

export default function Banner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('success') === '1') setMsg('Payment successful — Pro unlocked.');
    if (q.get('canceled') === '1') setMsg('Checkout canceled.');
    if (q.get('success') === '1' || q.get('canceled') === '1') {
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      url.searchParams.delete('canceled');
      history.replaceState({}, '', url.toString());
    }
  }, []);

  if (!msg) return null;

  return (
    <div className="sticky top-0 z-40 w-full bg-emerald-600/20 backdrop-blur border-b border-emerald-700/30 text-emerald-200">
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between text-sm">
        <span>{msg}</span>
        <button onClick={() => setMsg(null)} className="text-emerald-200/80 hover:text-emerald-100">Dismiss</button>
      </div>
    </div>
  );
}
