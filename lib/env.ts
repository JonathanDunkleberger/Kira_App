import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['openai', 'gemini']).optional(),
  OPENAI_MODEL: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  AZURE_SPEECH_KEY: z.string(),
  AZURE_SPEECH_REGION: z.string(),
  AZURE_TTS_VOICE: z.string().default('en-US-AshleyNeural'),
  AZURE_TTS_RATE: z.string().default('+25%'),
  AZURE_TTS_PITCH: z.string().default('+25%'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_PRICE_ID: z.string(),
  // Made optional to avoid build failures on missing secret in preview
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().url(),
  FREE_TRIAL_SECONDS: z.string(),
  PRO_SESSION_SECONDS: z.string().default('1800'),
  ALLOWED_ORIGIN: z.string(),
  DEV_ALLOW_NOAUTH: z.string().optional()
});

export const env = EnvSchema.parse({ ...process.env });
export const FREE_TRIAL_SECONDS = parseInt(env.FREE_TRIAL_SECONDS, 10);
export const PRO_SESSION_SECONDS = parseInt(env.PRO_SESSION_SECONDS, 10);
