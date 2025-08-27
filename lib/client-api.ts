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

export async function fetchSessionSeconds(): Promise<number> {
  const supabase = (await import('@/lib/supabaseClient')).getSupabaseBrowser();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return 0;
  const r = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return 0;
  const j = await r.json();
  return j?.secondsRemaining ?? 0;
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
