import Stripe from 'stripe';

import { envServer } from '../env.server';

let stripeSingleton: Stripe | null = null;

export function getStripe() {
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(envServer.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      appInfo: { name: 'Kira AI', version: '0.1.0' },
    });
  }
  return stripeSingleton;
}

export const priceId = envServer.STRIPE_PRICE_ID;
