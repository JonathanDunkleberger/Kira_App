export default function EmptyState() {
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="orb h-10 w-10" />
        <div>
          <div className="font-medium">Warming up Kira…</div>
          <div className="subtle text-xs">Setting up your session</div>
        </div>
      </div>
    </div>
  );
}
