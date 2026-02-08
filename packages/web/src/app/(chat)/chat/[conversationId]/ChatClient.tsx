"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { useKiraSocket, KiraState } from "@/hooks/useKiraSocket";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneOff, Star, User, Mic, MicOff, Eye, EyeOff } from "lucide-react";
import ProfileModal from "@/components/ProfileModal";
import KiraOrb from "@/components/KiraOrb";

export default function ChatClient() {
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const hasShownRating = useRef(false); // Prevent rating dialog from showing twice
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [guestId, setGuestId] = useState("");

  // Create a stable guest ID if the user is not logged in
  useEffect(() => {
    if (!userId) {
      let id = localStorage.getItem("kira-guest-id");
      if (!id) {
        id = `guest_${crypto.randomUUID()}`;
        localStorage.setItem("kira-guest-id", id);
      }
      setGuestId(id);
    }
  }, [userId]);

  const { 
    connect, 
    disconnect, 
    socketState, 
    kiraState, 
    micVolume, 
    playerVolume, 
    transcript, 
    error, 
    isAudioBlocked, 
    resumeAudio,
    isMuted,
    toggleMute,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    isPro
  } = useKiraSocket(
    token || "",
    guestId
  );
  // Removed hasStarted state to allow auto-start

  // 1. Get Clerk auth token
  useEffect(() => {
    if (userId) {
      getToken().then(setToken);
    }
  }, [getToken, userId]);

  // Disconnect only on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- UI Logic ---

  const handleEndCall = () => {
    disconnect();
    if (!hasShownRating.current) {
      hasShownRating.current = true;
      setShowRatingModal(true);
    }
  };

  const handleRate = () => {
    // TODO: Save rating to backend
    console.log("User rated conversation:", rating);
    setShowRatingModal(false);
    router.push("/");
  };

  const handleContinue = () => {
    setShowRatingModal(false);
    router.push("/");
  };

  const handleUpgrade = async () => {
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        console.error("Failed to start checkout");
      }
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  if (socketState === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-kira-bg text-gray-900 dark:bg-tokyo-bg dark:text-tokyo-fg transition-colors duration-300">
        <div className="p-12 bg-kira-green rounded-lg text-xl font-medium text-gray-800 animate-pulse dark:bg-tokyo-card dark:text-tokyo-fg">
          Connecting to Kira...
        </div>
      </div>
    );
  }

  // Start Screen (Initial State for ALL users)
  if (socketState === "idle") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-kira-bg dark:bg-tokyo-bg transition-colors duration-300">
        <button
          onClick={() => connect()}
          className="group relative flex flex-col items-center gap-6 p-10 rounded-[2.5rem] bg-white dark:bg-tokyo-card shadow-2xl transition-transform hover:scale-105 active:scale-95"
        >
          <div className="absolute inset-0 bg-kira-green/20 dark:bg-tokyo-accent/20 rounded-[2.5rem] animate-pulse" />
          
          <div className="relative z-10 w-24 h-24 bg-kira-green dark:bg-tokyo-accent rounded-full flex items-center justify-center text-white shadow-lg group-hover:shadow-kira-green/50 dark:group-hover:shadow-tokyo-accent/50 transition-shadow">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          
          <div className="relative z-10 text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-tokyo-fg mb-2">
              Ready to talk?
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              Tap to start conversation
            </p>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-kira-bg dark:bg-tokyo-bg transition-colors duration-300">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
        <Link href="/">
          <span className="font-semibold text-lg flex items-center gap-2 dark:text-tokyo-fg">
            {/* Your Logo */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-black dark:text-tokyo-fg"
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
        
        {/* Profile Link */}
        <button 
          onClick={() => setShowProfileModal(true)}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
        >
            <User size={24} className="text-gray-600 dark:text-tokyo-fg" />
        </button>
      </div>

      {/* Profile Modal */}
      <ProfileModal 
        isOpen={showProfileModal} 
        onClose={() => setShowProfileModal(false)} 
        isPro={isPro}
      />

      {/* Main Orb */}
      <div className="flex-grow flex flex-col items-center justify-center gap-12 relative w-full max-w-4xl mx-auto">
        <KiraOrb
          kiraState={kiraState}
          micVolume={micVolume}
          speakerVolume={playerVolume}
          size={280}
        />

        {/* Live Transcript - Positioned absolutely to avoid layout shift, but constrained */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl px-6 text-center pointer-events-none flex items-center justify-center h-full">
        </div>
      </div>
      
      {/* Transcript Container - Scrollable Box */}
      <div className="w-full max-w-3xl px-6 pb-8 z-10 flex justify-center flex-col items-center">
          {error && error !== "limit_reached" && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded relative dark:bg-red-900/30 dark:border-red-800 dark:text-red-400">
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          <div className="w-full max-w-2xl h-32 overflow-y-auto scrollbar-discreet text-center flex flex-col items-center justify-start pt-2">
            {transcript ? (
              <div
                className={`text-xl md:text-2xl font-medium transition-opacity duration-300 leading-relaxed ${
                  transcript.role === "user" ? "text-gray-600 dark:text-tokyo-fg/70" : "text-kira-green-dark dark:text-tokyo-accent"
                }`}
              >
                {transcript.text}
                {transcript.role === "user" && kiraState === "listening" && (
                  <span className="animate-pulse">|</span>
                )}
              </div>
            ) : (
              <div className="text-gray-400 dark:text-gray-600 text-sm italic mt-10">
                Listening...
              </div>
            )}
          </div>
      </div>

      {/* Footer Controls */}
      <div className="flex items-center gap-6 p-8">
        {/* Vision Button */}
        <button
          onClick={isScreenSharing ? stopScreenShare : startScreenShare}
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-full transition-colors ${
            isScreenSharing 
              ? "bg-white text-black hover:bg-gray-200" 
              : "bg-black/20 text-white hover:bg-black/30 dark:bg-white/10 dark:hover:bg-white/20"
          }`}
        >
          {isScreenSharing ? <Eye size={24} /> : <EyeOff size={24} />}
        </button>

        {/* Mute Button */}
        <button
          onClick={toggleMute}
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-full transition-colors ${
            isMuted 
              ? "bg-white text-black hover:bg-gray-200" 
              : "bg-black/20 text-white hover:bg-black/30 dark:bg-white/10 dark:hover:bg-white/20"
          }`}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>

        {/* End Call Button */}
        <button
          onClick={handleEndCall}
          className="flex flex-col items-center justify-center w-16 h-16 bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
          title="End Call"
        >
          <PhoneOff size={24} />
        </button>
      </div>

      {/* Rating Modal */}
      {showRatingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center gap-6 max-w-sm w-full mx-4 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Rate your conversation
            </h2>

            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110 focus:outline-none p-1"
                >
                  <Star
                    size={32}
                    className={`${
                      star <= (hoverRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-gray-300"
                    } transition-colors duration-150`}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-col w-full gap-3">
              <button
                onClick={handleRate}
                disabled={rating === 0}
                className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Rate it
              </button>
              <button
                onClick={handleContinue}
                className="w-full py-3 text-gray-500 hover:text-gray-900 font-medium transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Limit Reached Modal */}
      {error === "limit_reached" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-white dark:bg-tokyo-card p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 max-w-md w-full mx-4 animate-in fade-in zoom-in duration-300 border border-gray-200 dark:border-tokyo-fg/10">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 dark:text-red-400 mb-2">
              <PhoneOff size={32} />
            </div>
            
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-tokyo-fg">
                Daily Limit Reached
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                You've used all your free conversation time for today.
              </p>
            </div>

            <div className="flex flex-col w-full gap-3 mt-4">
              {!isPro && (
                <button
                  onClick={handleUpgrade}
                  className="w-full py-3 bg-kira-green text-gray-900 rounded-lg font-bold hover:bg-kira-green-dark transition-all hover:scale-[1.02] text-center shadow-lg dark:bg-tokyo-accent dark:text-tokyo-bg"
                >
                  Upgrade to Pro
                </button>
              )}
              <Link
                href="/"
                className="w-full py-3 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-tokyo-fg font-medium transition-colors text-center"
              >
                Come back tomorrow
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Audio Unlock Overlay */}
      {isAudioBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <button
            onClick={resumeAudio}
            className="group relative flex flex-col items-center gap-4 p-8 rounded-3xl bg-white dark:bg-tokyo-card shadow-2xl transition-transform hover:scale-105 active:scale-95"
          >
            <div className="absolute inset-0 bg-kira-green/20 dark:bg-tokyo-accent/20 rounded-3xl animate-pulse" />
            <div className="relative z-10 w-20 h-20 bg-kira-green dark:bg-tokyo-accent rounded-full flex items-center justify-center text-white shadow-lg group-hover:shadow-kira-green/50 dark:group-hover:shadow-tokyo-accent/50 transition-shadow">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <span className="relative z-10 text-lg font-semibold text-gray-900 dark:text-tokyo-fg">
              Tap to Start
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
