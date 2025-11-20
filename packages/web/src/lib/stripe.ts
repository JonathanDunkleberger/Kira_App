import Stripe from "stripe";

// Fallback to prevent crash on import if env var is missing
const apiKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_key";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("⚠️ STRIPE_SECRET_KEY is missing in environment variables! Stripe calls will fail.");
}

export const stripe = new Stripe(apiKey, {
  apiVersion: "2024-06-20",
  typescript: true,
});
