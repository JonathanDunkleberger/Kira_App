"use client";
import { useEffect, useState } from "react";
import CheckoutModal from "@/components/CheckoutModal";
import { supabase } from "@/lib/supabaseClient";
import { createPortalSession } from "@/lib/client-api";
import { useProfile } from "@/components/ProfileProvider";

type Entitlement = { plan: string };

export default function UserProfile() {
  const [open, setOpen] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const { email, profile } = useProfile();
  const supporter = profile?.plan === 'supporter';

  function Icon({ active }: { active: boolean }) {
    return (
      <div className={`h-8 w-8 rounded-full bg-white/90 flex items-center justify-center relative`}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#111" className="h-5 w-5">
          <path fillRule="evenodd" d="M12 2a5 5 0 100 10 5 5 0 000-10zM3 20.25a8.25 8.25 0 1118 0V21H3v-.75z" clipRule="evenodd" />
        </svg>
        {active && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-purple-500/90 border-2 border-[#0b0b12] shadow-[0_0_8px_rgba(168,85,247,0.9)]" />
        )}
      </div>
    );
  }

  return (
    <div className="fixed top-3 right-3 z-50">
      <button onClick={() => setOpen((v) => !v)} aria-label="User menu">
        <Icon active={!!email && supporter} />
      </button>
      {open && (
        <div className="mt-2 w-64 rounded-lg border border-purple-700/40 bg-[#161221] text-gray-100 shadow-xl p-2">
          {email ? (
            <div className="space-y-2">
              <div className="px-2 py-1 text-sm text-gray-300 truncate">{email}</div>
              {supporter ? (
                <button
                  onClick={async () => {
                    setOpen(false);
                    await createPortalSession();
                  }}
                  className="w-full text-left px-2 py-2 rounded-md hover:bg-white/10"
                >
                  Manage Subscription
                </button>
              ) : (
                <button
                  onClick={() => { setOpen(false); setShowCheckout(true); }}
                  className="w-full text-left px-2 py-2 rounded-md hover:bg-white/10"
                >
                  Subscribe Now
                </button>
              )}
              <button
                onClick={async () => { setOpen(false); await supabase.auth.signOut(); }}
                className="w-full text-left px-2 py-2 rounded-md hover:bg-white/10"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => { setOpen(false); setShowCheckout(true); }}
                className="w-full text-left px-2 py-2 rounded-md hover:bg-white/10"
              >
                Create Account & Subscribe
              </button>
            </div>
          )}
        </div>
      )}

      <CheckoutModal open={showCheckout} onClose={() => setShowCheckout(false)} />
    </div>
  );
}