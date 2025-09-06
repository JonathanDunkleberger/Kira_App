import { supabase } from '@/lib/client/supabaseClient';

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
  secondsRemaining: number; // daily remaining
  trialPerDay: number;
};

export async function fetchEntitlement(): Promise<Entitlement | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const r = await fetch('/api/session', { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!r.ok) return null;

  const j = await r.json();
  return {
    plan: (j?.plan ?? 'free'),
    status: (j?.status ?? 'inactive'),
    secondsRemaining: Number(j?.secondsRemaining ?? 0),
  trialPerDay: Number(j?.trialPerDay ?? 0)
  } as Entitlement;
}

// Backward compat for callers that only want seconds
export async function fetchSessionSeconds(): Promise<number | null> {
  const ent = await fetchEntitlement();
  return ent ? ent.secondsRemaining : null;
}

export async function startCheckout(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/sign-up?next=upgrade';
    return;
  }
  const r = await fetch('/api/stripe/create-checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) {
    alert(j?.error || `Server error: ${r.status}`);
    return;
  }
  window.location.href = j.url;
}

export async function openBillingPortal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/sign-in'; return; }
  const r = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) { alert(j?.error || 'Portal error'); return; }
  window.location.href = j.url;
}

export async function signOut() {
  await supabase.auth.signOut();

  // We intentionally DO NOT clear localStorage here.
  // This ensures that after sign-out the browser falls back to the
  // original guest identity (kiraGuestId) and does not get a new
  // free allocation by generating a fresh guest.
  window.location.reload();
}

export async function ensureAnonSession(): Promise<void> {
  // With email+password now in play, you might not want anon.
  // Keep it no-op for now.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;
}

// --- Conversations (HTTP) ---
async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return {} as Record<string, string>;
  return { Authorization: `Bearer ${session.access_token}` } as Record<string, string>;
}

export async function listConversations() {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/conversations', { headers });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function createConversation(title?: string) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ title: title || 'New Conversation' }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

export async function deleteConversation(id: string) {
  const headers = await getAuthHeaders();
  if (!('Authorization' in headers)) throw new Error('Unauthorized');
  const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

export async function getMessagesForConversation(id: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/conversations/${id}/messages`, { headers });
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function renameConversation(id: string, title: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ title })
  });
  if (!res.ok) throw new Error('Failed to rename conversation');
  return res.json();
}

export async function clearAllConversations() {
  const confirmed = window.confirm('Are you sure you want to delete your entire chat history? This cannot be undone.');
  if (!confirmed) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { error } = await supabase.from('conversations').delete().eq('user_id', user.id);
  if (error) throw new Error(error.message);
  window.location.reload();
}

// --- Account deletion ---
export async function deleteAccount() {
  const confirmed = window.confirm(
    'Are you sure you want to permanently delete your account? This will also cancel any active subscriptions and cannot be undone.'
  );

  if (!confirmed) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('You must be logged in to delete your account.');

    const response = await fetch('/api/user/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!response.ok) {
      let msg = 'Failed to delete account.';
      try { const j = await response.json(); msg = j?.error || msg; } catch {}
      throw new Error(msg);
    }

    alert('Your account has been successfully deleted.');
    await supabase.auth.signOut();
    window.location.href = '/';
  } catch (error: any) {
    alert(`Error: ${error?.message || 'Unknown error'}`);
  }
}