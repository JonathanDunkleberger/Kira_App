'use client';
import { useState } from 'react';
import { supabase } from '@/lib/client/supabaseClient';

export default function AuthForm({
  mode, // 'signup' | 'signin'
  afterSuccessHref = '/',
}: {
  mode: 'signup' | 'signin';
  afterSuccessHref?: string;
}) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        // if email confirmation is disabled, the session is active; otherwise require confirm
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setMsg('Check your email to confirm your account, then return to sign in.');
        } else {
          window.location.href = afterSuccessHref;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        window.location.href = afterSuccessHref;
      }
    } catch (e: any) {
      setErr(e?.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1 text-left">
        <label className="text-sm text-white/80">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white placeholder-white/30"
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1 text-left">
        <label className="text-sm text-white/80">Password</label>
        <input
          type="password"
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white placeholder-white/30"
          placeholder="••••••••"
        />
      </div>

      {err && <p className="text-rose-400 text-sm">{err}</p>}
      {msg && <p className="text-emerald-400 text-sm">{msg}</p>}

      <button
        disabled={busy}
        className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-2.5 hover:bg-fuchsia-700 disabled:opacity-60"
      >
        {mode === 'signup' ? 'Create account' : 'Log in'}
      </button>
    </form>
  );
}
