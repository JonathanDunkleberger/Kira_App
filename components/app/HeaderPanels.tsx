'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export type Panel = 'profile' | 'settings' | 'billing' | 'auth' | null;

// Minimal inline Sheet implementation using portal + basic styles (replace with shadcn/ui if available)
export default function HeaderPanels({
  panel,
  onOpenChange,
}: {
  panel: Panel;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(panel);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div className="w-[380px] sm:w-[420px] h-full bg-background text-foreground border-l border-border p-5 overflow-y-auto shadow-xl">
        {panel === 'profile' && (
          <div>
            <h2 className="text-lg font-semibold">Profile</h2>
            <p className="text-sm text-muted-foreground">Update your display and preferences.</p>
            <div className="mt-4 text-sm text-muted-foreground">Profile settings go here.</div>
          </div>
        )}
        {panel === 'settings' && (
          <div>
            <h2 className="text-lg font-semibold">Settings</h2>
            <p className="text-sm text-muted-foreground">App preferences (UI-only).</p>
            <div className="mt-4 text-sm text-muted-foreground">App settings go here.</div>
          </div>
        )}
        {panel === 'billing' && (
          <div>
            <h2 className="text-lg font-semibold">Billing</h2>
            <p className="text-sm text-muted-foreground">Upgrade to Pro or manage your plan.</p>
            <div className="mt-4 space-y-3">
              <Button onClick={() => (window.location.href = '/upgrade')}>Upgrade to Pro</Button>
              <Button variant="outline" onClick={() => (window.location.href = '/billing')}>
                Manage subscription
              </Button>
            </div>
          </div>
        )}
        {panel === 'auth' && (
          <div>
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground">You need to sign in before subscribing.</p>
            <div className="mt-4 space-y-3">
              <Button onClick={() => (window.location.href = '/login')}>Sign in</Button>
              <Button variant="outline" onClick={() => (window.location.href = '/signup')}>
                Create account
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
