"use client";

import { useConversation } from "@/lib/state/ConversationProvider";
import UpgradeSnackbar from "@/components/UpgradeSnackbar";
import { mapPlan } from "@/lib/analytics";

export default function UpgradeSnackbarPortal() {
  const {
  showUpgradeNudge,
  setShowUpgradeNudge,
  upgradeNudgeSource,
    dailySecondsRemaining,
    currentConversationId,
    session,
    isPro,
  } = useConversation();

  return (
    <UpgradeSnackbar
      open={!!showUpgradeNudge}
      onClose={() => {
        setShowUpgradeNudge?.(false);
        try { window.dispatchEvent(new Event('upgrade_nudge:dismissed')); } catch {}
      }}
      secondsRemaining={dailySecondsRemaining}
      conversationId={currentConversationId}
      userType={session ? 'authenticated' : 'guest'}
      plan={mapPlan(isPro ? 'supporter' : 'free')}
  source={upgradeNudgeSource}
    />
  );
}
