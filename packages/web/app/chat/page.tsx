export const dynamic = 'force-dynamic';
export const revalidate = 0;

import ChatClient from '@/components/chat/ChatClient';

export default function ChatPage({ searchParams }: { searchParams: { persona?: string } }) {
  return (
    <main className="min-h-[100dvh] pt-14 flex items-center justify-center">
      <ChatClient persona={searchParams.persona ?? 'kira'} />
    </main>
  );
}
