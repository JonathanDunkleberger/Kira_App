export const dynamic = 'force-dynamic';
export const revalidate = 0;

import ChatClient from '@/components/chat/ChatClient';

export default function ChatPage({ searchParams }: { searchParams: { persona?: string } }) {
  return (
    <main className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4">
      <ChatClient persona={searchParams.persona ?? 'kira'} />
    </main>
  );
}
