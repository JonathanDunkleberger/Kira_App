import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <Link
          href="/chat?persona=kira"
          className="group block rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 hover:border-white/20 transition"
        >
          <div className="text-lg font-semibold mb-2 flex items-center gap-2">
            Call Kira{' '}
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              Live
            </span>
          </div>
          <p className="text-sm text-white/60 group-hover:text-white/80">
            Real-time voice conversation. Just talk—she listens and replies.
          </p>
        </Link>
      </div>
    </main>
  );
}
