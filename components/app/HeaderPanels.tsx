"use client";
import { useEffect } from 'react';

export type Panel = 'profile' | 'settings' | 'billing' | 'auth' | null;

export default function HeaderPanels({ panel, onOpenChange }: { panel: Panel; onOpenChange: (o: boolean) => void }) {
  const open = !!panel;
  const src =
    panel === 'profile' ? '/profile' :
    panel === 'settings' ? '/settings' :
    panel === 'billing' ? '/billing' :
    panel === 'auth' ? '/login' : '';

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onOpenChange(false); }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="w-[380px] sm:w-[420px] h-full bg-background text-foreground border-l border-border shadow-xl flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-base font-medium capitalize">{panel}</div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-xs px-2 py-1 rounded-md bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
          >Close</button>
        </div>
        {panel && (
          <iframe key={src} src={src} className="w-full flex-1" style={{ border: 0 }} />
        )}
      </div>
    </div>
  );
}
