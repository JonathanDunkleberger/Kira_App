import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <Link
          href="/chat?persona=kira"
          onClick={() => {
            try { sessionStorage.setItem('kira_auto_start', '1'); } catch {}
          }}
          className="group block rounded-2xl border border-border bg-card/70 backdrop-blur p-6 hover:border-border/80 transition"
        >
          <div className="flex items-center gap-2 text-[17px] font-medium text-foreground mb-2">
            Call Kira{' '}
            <span className="text-[10px] tracking-wide px-2 py-0.5 rounded-full bg-accent text-accent-foreground border border-border/40 uppercase">
              Live
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-6 text-foreground/85 group-hover:text-foreground">
            Real-time voice conversation. Just talk—she listens and replies.
          </p>
        </Link>
      </div>
    </main>
  );
}
