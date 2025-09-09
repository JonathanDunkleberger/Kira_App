// scripts/check-env.cjs (build-time safe)
require('dotenv').config({ path: '.env.local' });

const requiredAtBuild = [
  'NEXT_PUBLIC_WEBSOCKET_URL',
  // add other NEXT_PUBLIC_ vars needed at build
];

const optionalDefaultsAtBuild = [
  'DEFAULT_DAILY_FREE_SECONDS',
  'DEFAULT_PRO_PER_CHAT_SECONDS',
];

const requiredAtRuntime = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  // 'SUPABASE_SERVICE_ROLE_KEY',
  // 'STRIPE_SECRET_KEY',
];

if (process.env.SKIP_ENV_VALIDATION === '1') {
  console.warn('[env] SKIP_ENV_VALIDATION=1 set. Skipping checks.');
  process.exit(0);
}

const missingBuild = requiredAtBuild.filter((k) => !process.env[k]);
if (missingBuild.length) {
  console.error('[env] Missing build env:', missingBuild.join(', '));
  process.exit(1);
}

optionalDefaultsAtBuild.forEach((k) => {
  if (!process.env[k]) console.warn(`[env] Optional default not set: ${k}`);
});

const missingRuntime = requiredAtRuntime.filter((k) => !process.env[k]);
if (missingRuntime.length) {
  console.warn('[env] These must exist at RUNTIME (not required for build):', missingRuntime.join(', '));
}

console.log('[env] Build env check complete.');
