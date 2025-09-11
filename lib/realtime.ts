// Supabase realtime removed; this module can be refactored or deleted.

export function subscribeToConversation(_conversationId: string, _callback: (message: any) => void) {
  // Realtime disabled; return disposable no-op
  return { unsubscribe: () => {} };
}

export function unsubscribeFromConversation(_subscription: any) {
  // No-op
}
