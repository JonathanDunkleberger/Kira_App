"use client";

import { useConversation } from "@/lib/state/ConversationProvider";
import UpgradeSnackbar from "@/components/UpgradeSnackbar";

export default function UpgradeSnackbarPortal() {
  const {
    showUpgradeNudge,
    setShowUpgradeNudge,
    dailySecondsRemaining,
    currentConversationId,
  } = useConversation();

  return (
    <UpgradeSnackbar
      open={!!showUpgradeNudge}
      onClose={() => setShowUpgradeNudge(false)}
      secondsRemaining={dailySecondsRemaining}
      conversationId={currentConversationId}
    />
  );
}
