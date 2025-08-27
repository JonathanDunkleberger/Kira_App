export async function sendUtterance(payload: { text: string }) {
  const r = await fetch("/api/utterance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (r.status === 402) {
    throw Object.assign(new Error("Paywall"), { code: 402 });
  }

  if (!r.ok) {
    let message = "Request failed";
    try {
      const body = await r.json();
      message = body?.error || message;
    } catch {}
    throw new Error(message);
  }

  return r.json();
}

export async function fetchSessionSeconds(): Promise<number | null> {
  const supabase = (await import('@/lib/supabaseClient')).getSupabaseBrowser();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return null;
  const r = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return (typeof j?.secondsRemaining === 'number') ? j.secondsRemaining : null;
}

export async function startCheckout(): Promise<void> {
  const supabase = (await import('@/lib/supabaseClient')).getSupabaseBrowser();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  const r = await fetch('/api/stripe/create-checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error('Failed to start checkout');
  const j = await r.json();
  if (j?.url) window.location.href = j.url;
}

export async function ensureAnonSession(): Promise<void> {
  const supabase = (await import('@/lib/supabaseClient')).getSupabaseBrowser();
  const existing = (await supabase.auth.getSession()).data.session;
  if (existing) return;
  // Anonymous sign-in (Supabase must have anonymous auth enabled)
  // Falls back silently if unsupported
  // @ts-ignore
  if (typeof supabase.auth.signInAnonymously === 'function') {
    // @ts-ignore
    await supabase.auth.signInAnonymously();
  }
}
