"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function SuccessPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'error' | 'done'>('loading');
  const [message, setMessage] = useState<string>('Finalizing your session, please wait...');

  useEffect(() => {
    const sessionId = params.get('session_id');
    if (!sessionId) {
      setStatus('error');
      setMessage('Missing session id. If you completed payment, please contact support.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/auth/session-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to finalize session');
        }

        if (data?.access_token && data?.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token
          });
          if (error) throw error;
        }

        setStatus('done');
        router.replace('/');
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.message || 'Something went wrong finishing your session. Please contact support.');
      }
    })();
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-3">{status === 'loading' ? 'Finalizing your session…' : status === 'done' ? 'All set!' : 'There was an issue'}</h1>
        <p className="text-gray-500">{message}</p>
      </div>
    </div>
  );
}
