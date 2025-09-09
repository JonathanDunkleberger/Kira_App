'use client';
import dynamic from 'next/dynamic';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export type Panel = 'profile' | 'settings' | 'billing' | 'auth' | 'feedback' | null;

// Dynamic imports (client-only) – point to component stubs
const ProfilePanel = dynamic(() => import('@/components/profile/ProfilePanel'), { ssr: false });
const SettingsPanel = dynamic(() => import('@/components/settings/SettingsPanel'), { ssr: false });
const BillingPanel = dynamic(() => import('@/components/billing/BillingPanel'), { ssr: false });
const AuthPanel = dynamic(() => import('@/components/auth/AuthPanel'), { ssr: false });
const FeedbackPanel = dynamic(() => import('@/components/feedback/FeedbackPanel'), { ssr: false });

export default function HeaderPanels({ panel, onOpenChange }: { panel: Panel; onOpenChange: (o: boolean) => void }) {
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
              {panel === 'auth' && <AuthPanel variant="panel" />}
              {panel === 'feedback' && <FeedbackPanel variant="panel" />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
