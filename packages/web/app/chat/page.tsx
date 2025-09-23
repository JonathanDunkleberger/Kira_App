'use client';
import { useRef } from 'react';

import ChatClient from '../../components/chat/ChatClient';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const idRef = useRef<string>('');
  if (!idRef.current) {
    // Use browser crypto for stable per-session id
    idRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return (
    <main className="min-h-[100dvh] pt-14 flex items-center justify-center">
      <ChatClient conversationId={idRef.current} />
    </main>
  );
}
