import { z } from 'zod';

// Server-only environment schema (includes secrets). Never import this into client components.
const EnvSchema = z.object({
  // LLM providers
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['openai', 'gemini']).optional(),
  OPENAI_MODEL: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),

  // Azure TTS
  AZURE_SPEECH_KEY: z.string(),
  AZURE_SPEECH_REGION: z.string(),
  AZURE_TTS_VOICE: z.string().default('en-US-AshleyNeural'),
  AZURE_TTS_RATE: z.string().default('+25%'),
  AZURE_TTS_PITCH: z.string().default('+25%'),

  // Supabase (removed; no longer validated)

  // Stripe
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_PRICE_ID: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // App
  APP_URL: z.string().url(),
  FREE_TRIAL_SECONDS: z.string(),
  PRO_SESSION_SECONDS: z.string().default('1800'),
  ALLOWED_ORIGIN: z.string(),
  DEV_ALLOW_NOAUTH: z.string().optional(),
});

export const envServer = EnvSchema.parse(process.env);

// Parsed numeric conveniences
export const FREE_TRIAL_SECONDS = parseInt(envServer.FREE_TRIAL_SECONDS, 10);
export const PRO_SESSION_SECONDS = parseInt(envServer.PRO_SESSION_SECONDS, 10);
