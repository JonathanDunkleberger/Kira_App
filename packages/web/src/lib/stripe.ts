import Stripe from "stripe";

const apiKey = process.env.STRIPE_SECRET_KEY;

if (!apiKey) {
  console.error("⚠️ STRIPE_SECRET_KEY is missing in environment variables! Stripe calls will fail.");
}

export const stripe = new Stripe(apiKey || "", {
  apiVersion: "2024-06-20",
  typescript: true,
});
