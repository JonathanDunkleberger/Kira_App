"use client";
// FILE: packages/web/app/chat/[conversationId]/page.tsx
import ChatClient from '@/components/chat/ChatClient';

export default function ChatPage({ params }: { params: { conversationId: string } }) {
  return (
    <main className="min-h-[100dvh] pt-14 flex items-center justify-center">
      <ChatClient conversationId={params.conversationId} />
    </main>
  );
}
