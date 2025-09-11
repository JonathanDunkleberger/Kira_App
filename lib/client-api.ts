// Supabase client removed; adjust or replace data layer if needed.

export async function sendUtterance(payload: { text: string }) {
  const r = await fetch('/api/utterance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (r.status === 402) {
    throw Object.assign(new Error('Paywall'), { code: 402 });
  }

  if (!r.ok) {
    let message = 'Request failed';
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
  // Supabase session removed; rely on server routes that read Clerk cookies directly.
  const r = await fetch('/api/session', { headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) return null;

  const j = await r.json();
  return {
    plan: j?.plan ?? 'free',
    status: j?.status ?? 'inactive',
    secondsRemaining: Number(j?.secondsRemaining ?? 0),
    trialPerDay: Number(j?.trialPerDay ?? 0),
  } as Entitlement;
}

// Backward compat for callers that only want seconds
export async function fetchSessionSeconds(): Promise<number | null> {
  const ent = await fetchEntitlement();
  return ent ? ent.secondsRemaining : null;
}

export async function startCheckout(): Promise<void> {
  // Require Clerk session on client; redirect to Clerk sign up if missing
  // We call the server route without bearer token (Clerk server reads from cookies)
  // which avoids the previous Supabase token coupling.
  // If unauthenticated, server will 401 and we send to sign-up.
  const r = await fetch('/api/stripe/create-checkout', {
    method: 'POST',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) {
    if (r.status === 401) {
      window.location.href = '/sign-up?next=upgrade';
      return;
    }
    alert(j?.error || `Server error: ${r.status}`);
    return;
  }
  window.location.href = j.url;
}

export async function openBillingPortal() {
  const r = await fetch('/api/stripe/portal', {
    method: 'POST',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) {
    if (r.status === 401) {
      window.location.href = '/sign-in';
      return;
    }
    alert(j?.error || 'Portal error');
    return;
  }
  window.location.href = j.url;
}

export async function signOut() {
  // Redirect to Clerk sign out if available; fallback to location.
  try {
    window.location.href = '/sign-out';
  } catch {
    window.location.reload();
  }
}

export async function ensureAnonSession(): Promise<void> {
  // No-op: anon session concept removed with Clerk-only auth.
}

// --- Conversations (HTTP) ---
async function getAuthHeaders() {
  // Rely on Clerk cookie auth; no bearer header needed.
  return { 'Content-Type': 'application/json' } as Record<string, string>;
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
  const res = await fetch(`/api/conversations/${id}/messages`, { headers, cache: 'no-store' });
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {}
    const code = detail?.error || res.status;
    if (res.status === 401) throw new Error('unauthorized');
    if (res.status === 404) throw new Error('not_found');
    throw new Error(`messages_fetch_failed:${code}`);
  }
  return res.json();
}

export async function renameConversation(id: string, title: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to rename conversation');
  return res.json();
}

export async function clearAllConversations() {
  const confirmed = window.confirm(
    'Are you sure you want to delete your entire chat history? This cannot be undone.',
  );
  if (!confirmed) return;
  // Replace with server route that performs authenticated purge
  const res = await fetch('/api/conversations/purge', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to clear conversations');
  window.location.reload();
}

// --- Account deletion ---
export async function deleteAccount() {
  const confirmed = window.confirm(
    'Are you sure you want to permanently delete your account? This will also cancel any active subscriptions and cannot be undone.',
  );

  if (!confirmed) return;

  try {
  const response = await fetch('/api/user/delete', { method: 'POST' });

    if (!response.ok) {
      let msg = 'Failed to delete account.';
      try {
        const j = await response.json();
        msg = j?.error || msg;
      } catch {}
      throw new Error(msg);
    }

    alert('Your account has been successfully deleted.');
  window.location.href = '/';
  } catch (error: any) {
    alert(`Error: ${error?.message || 'Unknown error'}`);
  }
}
