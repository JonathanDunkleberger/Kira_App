import { supabase } from './supabaseClient';

export function subscribeToConversation(conversationId: string, callback: (message: any) => void) {
  return supabase
    .channel(`conversation:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        callback((payload as any).new);
      }
    )
    .subscribe();
}

export function unsubscribeFromConversation(subscription: any) {
  try { supabase.removeChannel(subscription); } catch {}
}
