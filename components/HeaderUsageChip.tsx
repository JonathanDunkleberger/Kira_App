"use client";
import { useConversation } from "@/lib/state/ConversationProvider";

export default function HeaderUsageChip() {
  const { isPro } = useConversation();

  if (!isPro) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <span className="font-medium">Pro</span>
      <span className="text-white/60">Unlimited</span>
    </div>
  );
}
