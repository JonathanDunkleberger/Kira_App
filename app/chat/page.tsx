export const dynamic = 'force-dynamic';
export const revalidate = 0;

import ChatClient from '@/components/chat/ChatClient';

export default function ChatPage({ searchParams }: { searchParams: { chatSessionId?: string } }) {
  const chatSessionId = searchParams?.chatSessionId;
  return <ChatClient chatSessionId={chatSessionId} />;
}
