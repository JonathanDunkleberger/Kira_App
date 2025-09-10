'use client';
import { useEffect } from 'react';

// Deprecated: Legacy CheckoutModal removed. Use Clerk-authenticated server routes instead.
// See lib/client-api.ts: startCheckout() and openBillingPortal().

export default function CheckoutModal() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.warn('[Deprecated] CheckoutModal was rendered. Migrate to startCheckout()/openBillingPortal() flows.');
    }
  }, []);
  return null;
}
