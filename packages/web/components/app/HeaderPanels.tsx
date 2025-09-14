'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';

export type Panel = 'profile' | 'settings' | 'billing' | 'auth' | 'feedback' | null;

// Dynamic imports (client-only) – point to component stubs
const ProfilePanel = dynamic(() => import('../profile/ProfilePanel'), { ssr: false });
const SettingsPanel = dynamic(() => import('../settings/SettingsPanel'), { ssr: false });
const BillingPanel = dynamic(() => import('../billing/BillingPanel'), { ssr: false });
const FeedbackPanel = dynamic(() => import('../feedback/FeedbackPanel'), { ssr: false });

export default function HeaderPanels({
  panel,
  onOpenChange,
}: {
  panel: Panel;
  onOpenChange: (o: boolean) => void;
}) {
  const open = !!panel;
  return (
    <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
      <SheetContent side="right">
        {panel && (
          <>
            <SheetHeader className="pb-2">
              <SheetTitle className="capitalize">{panel}</SheetTitle>
            </SheetHeader>
            <div className="pt-2 pb-4 overflow-y-auto custom-scrollbar pr-2 max-h-[calc(100vh-6rem)]">
              {panel === 'profile' && <ProfilePanel variant="panel" />}
              {panel === 'settings' && <SettingsPanel variant="panel" />}
              {panel === 'billing' && <BillingPanel variant="panel" />}
              {panel === 'auth' && (
                <div className="px-2 py-1.5 text-sm space-y-3">
                  <p className="text-white/70">Sign in to access account features.</p>
                  <div className="flex gap-2 flex-wrap">
                    <Link
                      href="/sign-in"
                      className="px-3 py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs"
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/sign-up"
                      className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs"
                    >
                      Create account
                    </Link>
                  </div>
                </div>
              )}
              {panel === 'feedback' && <FeedbackPanel variant="panel" />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
