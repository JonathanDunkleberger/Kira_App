"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { useKiraSocket, KiraState } from "@/hooks/useKiraSocket";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, PhoneOff } from "lucide-react";

export default function ChatClient() {
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  // Create a stable guest ID if the user is not logged in
  const [guestId] = useState(() => {
    if (typeof window !== "undefined" && !userId) {
      let id = localStorage.getItem("kira-guest-id");
      if (!id) {
        id = `guest_${crypto.randomUUID()}`;
        localStorage.setItem("kira-guest-id", id);
      }
      return id;
    }
    return "";
  });

  const { connect, disconnect, startConversation, socketState, kiraState } = useKiraSocket(
    token || "",
    guestId
  );
  const connectedOnceRef = useRef(false);

  // 1. Get Clerk auth token
  useEffect(() => {
    if (userId) {
      getToken().then(setToken);
    }
  }, [getToken, userId]);

  // 2. Connect to WebSocket once when ready; keep alive across re-renders.
  useEffect(() => {
    if (!connectedOnceRef.current && (guestId || (userId && token))) {
      connect();
      connectedOnceRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, userId, token]);

  // Disconnect only on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = () => {
    startConversation();
  };

  // --- UI Logic ---
  const getOrbStyle = (state: KiraState) => {
    switch (state) {
      case "speaking":
        return "bg-kira-orb shadow-orb animate-pulse"; // Speaking
      case "thinking":
        return "bg-kira-orb shadow-orb animate-pulse-slow"; // Thinking
      case "listening":
      default:
        return "bg-kira-orb shadow-orb"; // Listening
    }
  };

  const handleEndCall = () => {
    disconnect();
    // This is where we will show the 5-star rating modal (Goal 3)
    router.push("/"); // For now, just go home
  };

  if (socketState === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-kira-bg text-gray-900">
        <div className="p-12 bg-kira-green rounded-lg text-xl font-medium text-gray-800 animate-pulse">
          Connecting to Kira...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-kira-bg">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center">
        <Link href="/">
          <span className="font-semibold text-lg flex items-center gap-2">
            {/* Your Logo */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2L2 7L12 12L22 7L12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 17L12 22L22 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Kira
          </span>
        </Link>
        {/* TODO: GOAL 3 - Add real free trial timer */}
        <span className="text-sm text-gray-500">00:19</span>
      </div>

      {/* Main Orb */}
      <div className="flex-grow flex items-center justify-center">
        <div
          className={`w-48 h-48 rounded-full transition-all duration-300 ${getOrbStyle(
            kiraState
          )}`}
        />
      </div>

      {/* Footer Controls */}
      <div className="flex items-center gap-6 p-8">
        <button
          onClick={handleStart}
          disabled={socketState !== "connected"}
          className="flex flex-col items-center justify-center w-20 h-20 bg-kira-green rounded-full text-gray-900 disabled:opacity-50"
          title={socketState !== "connected" ? "Waiting for connection" : "Start"}
        >
          <Mic size={28} />
          <span className="text-sm mt-1">Start</span>
        </button>
        <button
          onClick={handleEndCall}
          className="flex flex-col items-center justify-center w-20 h-20 bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
        >
          <PhoneOff size={28} />
          <span className="text-sm mt-1">End call</span>
        </button>
      </div>
    </div>
  );
}
