"use client";

import { useEffect } from "react";
import nextDynamic from "next/dynamic";
import { debugLog } from "@/hooks/useKiraSocket";

const DynamicChatClient = nextDynamic(() => import("./ChatClient"), {
  ssr: false,
});

export default function ChatPage() {
  useEffect(() => {
    debugLog("[ChatPage] MOUNTED. URL:", window.location.href);
    return () => {
      debugLog("[ChatPage] UNMOUNTING");
    };
  }, []);

  return <DynamicChatClient />;
}
