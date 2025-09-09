// scripts/postinstall.cjs
// Skip lefthook when not inside a git repo (e.g., Vercel/CI)
const { execSync } = require('child_process');
try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('npx lefthook install', { stdio: 'inherit' });
  console.log('[postinstall] lefthook installed.');
} catch {
  console.log('[postinstall] Skipping lefthook (no git repo / CI).');
}
