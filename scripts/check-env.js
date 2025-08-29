// scripts/check-env.js
require('dotenv').config({ path: '.env.local' }); // <-- load env from .env.local
const { z } = require('zod');

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['openai', 'gemini']).optional(),
  OPENAI_MODEL: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  AZURE_SPEECH_KEY: z.string(),
  AZURE_SPEECH_REGION: z.string(),
  AZURE_TTS_VOICE: z.string().optional(),
  AZURE_TTS_RATE: z.string().optional(),
  AZURE_TTS_PITCH: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_PRICE_ID: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(), // allow missing in Preview
  APP_URL: z.string(),
  FREE_TRIAL_SECONDS: z.string(),
  ALLOWED_ORIGIN: z.string(),
  DEV_ALLOW_NOAUTH: z.string().optional()
});

// In CI/Preview, warn instead of fail. Locally, fail fast.
const isVercel = !!process.env.VERCEL;
try {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n - ');
    if (isVercel) {
  console.warn('⚠️ Environment warnings (continuing on Vercel):\n - ' + issues);
      process.exit(0);
    } else {
      console.error('❌ Invalid environment variables:\n - ' + issues);
      process.exit(1);
    }
  } else {
    console.log('✅ Environment variables look OK.');
  }
} catch (err) {
  if (isVercel) {
    console.warn('⚠️ Env check error (continuing on Vercel):', err?.message || err);
    process.exit(0);
  } else {
    console.error('❌ Env check error:', err?.message || err);
    process.exit(1);
  }
}
