"use client";
import { startCheckout } from '@/lib/client-api';
import { useState } from 'react';

export default function Paywall() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null; // The modal is hidden, but the app remains paywalled in the background
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="relative max-w-md w-full rounded-xl border border-purple-700/40 bg-[#161221] p-6 text-gray-100 text-center shadow-2xl">
        
        {/* Close Button */}
        <button 
          onClick={() => setIsVisible(false)}
          className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <h2 className="text-2xl font-semibold mb-3">Trial Ended</h2>
        <p className="text-gray-300 mb-6">
          To continue the conversation with unlimited access, please subscribe.
        </p>
        <button
          onClick={() => startCheckout()}
          className="px-6 py-3 w-full rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
        >
          Subscribe for $1.99/mo
        </button>
      </div>
    </div>
  );
}