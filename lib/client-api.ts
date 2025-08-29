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

export type Entitlement = {
  plan: 'free' | 'supporter';
  status: 'inactive' | 'active' | 'past_due' | 'canceled';
  secondsRemaining: number;
};

export async function fetchEntitlement(): Promise<Entitlement | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const r = await fetch('/api/session', { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!r.ok) return null;

  const j = await r.json();
  return {
    plan: (j?.plan ?? 'free') as Entitlement['plan'],
    status: (j?.status ?? 'inactive') as Entitlement['status'],
    secondsRemaining: typeof j?.secondsRemaining === 'number' ? j.secondsRemaining : 0,
  };
}

// Backward compat for callers that only want seconds
export async function fetchSessionSeconds(): Promise<number | null> {
  const ent = await fetchEntitlement();
  return ent ? ent.secondsRemaining : null;
}

export async function startCheckout(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Authentication session not found. Please refresh and try again.');

    const r = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.url) throw new Error(j?.error || `Server error: ${r.status}`);
    window.location.href = j.url;
  } catch (err: any) {
    console.error("Checkout failed:", err);
    alert(`Checkout Error: ${err.message}`);
  }
}

export async function openBillingPortal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const r = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) throw new Error(j?.error || 'Portal error');
  window.location.href = j.url;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();
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