export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getSessions() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const res = await fetch(`${base}/api/history/sessions`, { cache: 'no-store' });
  if (!res.ok) return [] as any[];
  return res.json();
}

export default async function HistoryPage() {
  const sessions = await getSessions();
  return (
    <main className="max-w-3xl mx-auto p-4 space-y-3">
      <h1 className="text-xl font-semibold">Past chats</h1>
      <ul className="space-y-2">
        {sessions.map((s: any) => (
          <li key={s.id} className="border rounded p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{new Date(s.started_at).toLocaleString()}</div>
              <div className="text-sm text-gray-400">Elapsed: {(s.seconds_elapsed / 60) | 0} min</div>
            </div>
            <a
              href={`/chat?chatSessionId=${s.id}`}
              className="rounded px-3 py-1 border hover:bg-white/5 text-sm"
            >
              Resume
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}