import Link from 'next/link';

async function fetchConversations() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/conversations`, {
      cache: 'no-store',
    });
    if (!r.ok) return [] as any[];
    const j = await r.json();
    return Array.isArray(j?.conversations) ? j.conversations : j?.items || j || [];
  } catch {
    return [] as any[];
  }
}

export default async function ConversationsPage() {
  const convos = await fetchConversations();
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="container max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold mb-6">Conversations</h1>
        <ul className="space-y-2">
          {convos.length === 0 && <li className="text-white/60">No conversations yet.</li>}
          {convos.map((c: any) => (
            <li
              key={c.id}
              className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
            >
              <div>
                <div className="font-medium">{c.title || 'Untitled'}</div>
                <div className="text-xs text-white/50">
                  {new Date(c.updated_at || c.created_at).toLocaleString()}
                </div>
              </div>
              <Link href={`/conversations/${c.id}`} className="text-sm underline">
                Open
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
