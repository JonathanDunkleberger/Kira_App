import { supabase } from '@/lib/supabaseClient';

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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const r = await fetch('/api/session', { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return (typeof j?.secondsRemaining === 'number') ? j.secondsRemaining : null;
}

export async function startCheckout(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Authentication session not found. Please refresh the page and try again.');
    }

    const r = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    if (!r.ok) {
      // This will now catch the 500 error from the server
      const errorBody = await r.json().catch(() => ({ error: 'Failed to start checkout. Server returned an invalid response.' }));
      throw new Error(errorBody.error || `Server error: ${r.status}`);
    }
    
    const j = await r.json();
    if (j?.url) {
      window.location.href = j.url;
    } else {
      throw new Error('Could not retrieve a checkout URL.');
    }
  } catch (err: any) {
    console.error("Checkout failed:", err);
    alert(`Checkout Error: ${err.message}`);
  }
}

export async function ensureAnonSession(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;
  // @ts-ignore
  if (typeof supabase.auth.signInAnonymously === 'function') {
    // @ts-ignore
    await supabase.auth.signInAnonymously();
  }
}

export async function createPortalSession(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const r = await fetch('/api/stripe/create-portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!r.ok) throw new Error(`Portal error: ${r.status}`);
  const j = await r.json();
  if (j?.url) window.location.href = j.url; else throw new Error('Portal URL missing');
}