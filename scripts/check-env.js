// scripts/check-env.js

const { z } = require('zod');

// This schema must match the one in `lib/env.ts`
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
  STRIPE_WEBHOOK_SECRET: z.string(),
  APP_URL: z.string().url(),
  FREE_TRIAL_SECONDS: z.string(),
  ALLOWED_ORIGIN: z.string(),
  DEV_ALLOW_NOAUTH: z.string().optional()
});

try {
  EnvSchema.parse(process.env);
  console.log('✅ Environment variables are valid.');
} catch (err) {
  console.error('❌ Invalid environment variables:', err.format());
  process.exit(1); // Exit with an error code to fail the build
}
