import Link from 'next/link';

async function fetchMessages(id: string) {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const r = await fetch(`${base}/api/conversations/${id}/messages`, { cache: 'no-store' });
    if (!r.ok) return [] as any[];
    const j = await r.json();
    return Array.isArray(j?.messages) ? j.messages : j?.items || j || [];
  } catch {
    return [] as any[];
  }
}

export default async function ConversationDetail({ params }: { params: { id: string } }) {
  const messages = await fetchMessages(params.id);
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="container max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Conversation</h1>
          <Link href="/conversations" className="text-sm underline">
            Back
          </Link>
        </div>
        <div className="space-y-3">
          {messages.length === 0 && <div className="text-white/60">No messages yet.</div>}
          {messages.map((m: any, i: number) => (
            <div
              key={i}
              className={`p-3 rounded-lg border border-white/10 ${m.role === 'assistant' ? 'bg-fuchsia-500/10' : 'bg-white/5'}`}
            >
              <div className="text-xs text-white/50 mb-1">{m.role}</div>
              <div>{m.content}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
