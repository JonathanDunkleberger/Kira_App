import ChatClient from '@/components/chat/ChatClient';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const conversationId = randomUUID();
  return (
    <main className="min-h-[100dvh] pt-14 flex items-center justify-center">
      <ChatClient conversationId={conversationId} />
    </main>
  );
}
