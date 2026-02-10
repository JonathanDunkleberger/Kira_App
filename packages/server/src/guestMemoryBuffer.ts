/**
 * In-memory buffer for guest conversations.
 * When a guest disconnects, their conversation is buffered here for 24 hours.
 * If they reconnect, recent history is loaded for continuity.
 * If they sign up within that window, the conversation is migrated to their new account.
 */

interface GuestConversationBuffer {
  messages: Array<{ role: string; content: string }>;
  summary: string;
  timestamp: number;
}

// Simple in-memory map with TTL
const guestBuffers = new Map<string, GuestConversationBuffer>();

const BUFFER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Clean up expired buffers every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, buf] of guestBuffers) {
    if (now - buf.timestamp > BUFFER_TTL_MS) {
      guestBuffers.delete(id);
      console.log(`[Memory] Expired guest buffer for ${id}`);
    }
  }
}, 5 * 60 * 1000);

export function bufferGuestConversation(
  guestId: string,
  messages: Array<{ role: string; content: string }>,
  summary: string
): void {
  guestBuffers.set(guestId, {
    messages,
    summary,
    timestamp: Date.now(),
  });
  console.log(`[Memory] Buffered guest conversation for ${guestId} (${messages.length} msgs)`);
}

export function getGuestBuffer(guestId: string): GuestConversationBuffer | null {
  return guestBuffers.get(guestId) || null;
}

export function clearGuestBuffer(guestId: string): void {
  guestBuffers.delete(guestId);
}
