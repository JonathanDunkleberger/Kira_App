'use client';
type Variant = 'panel' | 'page';
export default function SettingsPanel({ variant = 'panel' }: { variant?: Variant }) {
  const shell =
    variant === 'panel'
      ? 'px-4 py-3 space-y-4 text-sm'
      : 'container mx-auto max-w-3xl py-10 space-y-6 text-sm';
  return (
    <div className={shell}>
      <h2 className="text-lg font-semibold">Settings</h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-white/70">Autoplay voice replies</span>
          <span className="text-white/40">Always on</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/70">Session timeout</span>
          <span className="text-white/40">Default</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/70">Model</span>
          <span className="text-white/40">gpt-4o-mini</span>
        </div>
      </div>
    </div>
  );
}
