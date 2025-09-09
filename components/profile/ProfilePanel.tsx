'use client';
import { useEffect, useState } from 'react';
import { supaBrowser } from '@/lib/supabase-browser';

type Variant = 'panel' | 'page';

export default function ProfilePanel({ variant = 'panel' }: { variant?: Variant }) {
  const supa = supaBrowser();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supa.auth.getUser();
        if (user) {
          setEmail(user.email ?? '');
          const { data } = await supa
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .maybeSingle();
          setName(data?.display_name ?? '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [supa]);

  async function save() {
    setStatus(null);
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      setStatus('Not signed in');
      return;
    }
    await supa.from('profiles').upsert({ id: user.id, display_name: name });
    setStatus('Saved');
  }

  const shell =
    variant === 'panel'
      ? 'px-4 py-3 space-y-4 text-sm'
      : 'container mx-auto max-w-3xl py-10 space-y-6 text-sm';

  return (
    <div className={shell}>
      <h2 className="text-lg font-semibold">Profile</h2>
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-white/40">Email</label>
          <input
            value={email}
            disabled
            className="rounded-md bg-white/5 border border-white/10 px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-white/40">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md bg-white/5 border border-white/10 px-2 py-1.5 text-xs"
            placeholder="Your name"
          />
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <button
          onClick={save}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-primary/25 hover:bg-primary/35 text-primary text-xs disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Save changes'}
        </button>
        {status && <span className="text-xs text-white/50">{status}</span>}
      </div>
    </div>
  );
}
