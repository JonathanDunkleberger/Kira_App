'use client';
import { useState } from 'react';
import { supabase } from '@/lib/client/supabaseClient';
import { envClient } from '@/lib/env.client';
import { loadStripe } from '@stripe/stripe-js';
// Note: We include CardElement for UX parity, but payment is completed on Stripe Checkout after redirect.
import { CardElement, Elements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(envClient.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

export default function CheckoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // 1) Create permanent account
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error('Sign up failed');

      // 2) Create Checkout Session linked to this user via client_reference_id
      const r = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Checkout failed: ${r.status}`);
      }
      const j = await r.json();
      if (j?.url) {
        window.location.href = j.url as string;
        return;
      }
      throw new Error('Invalid checkout response');
    } catch (e: any) {
      setError(e?.message || String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-xl border border-purple-700/40 bg-[#161221] p-6 text-gray-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        <h2 className="text-2xl font-semibold mb-1">Subscribe</h2>
        <p className="text-gray-300 mb-4">Create your account and subscribe to continue.</p>

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            className="w-full rounded-md bg-[#201b2e] border border-purple-800/40 px-3 py-2 outline-none focus:border-purple-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-md bg-[#201b2e] border border-purple-800/40 px-3 py-2 outline-none focus:border-purple-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* Stripe Card Element for familiar UX; actual payment happens on Stripe Checkout */}
          <Elements stripe={stripePromise}>
            <div className="rounded-md bg-[#201b2e] border border-purple-800/40 px-3 py-2">
              <CardElement options={{ hidePostalCode: true }} />
            </div>
          </Elements>
        </div>

        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting || !email || !password}
          className="mt-5 w-full rounded-lg bg-purple-600 py-3 font-semibold text-white hover:bg-purple-700 transition-colors disabled:opacity-60"
        >
          {submitting ? 'Processing…' : 'Pay & Create Account'}
        </button>
      </div>
    </div>
  );
}
