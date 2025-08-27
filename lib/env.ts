import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string(),
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
  STRIPE_WEBHOOK_SECRET: z.string(),
  APP_URL: z.string().url(),
  FREE_TRIAL_SECONDS: z.string(),
  ALLOWED_ORIGIN: z.string()
});

export const env = EnvSchema.parse({ ...process.env });
export const FREE_TRIAL_SECONDS = parseInt(env.FREE_TRIAL_SECONDS, 10);
