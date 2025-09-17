#!/usr/bin/env node
/*
 * Gemini Code Dump Generator
 * Produces a sanitized, concatenated snapshot of source code for LLM review.
 * Key improvements vs original dump-code.js:
 *  - Different output filename (CODE_DUMP_GEMINI.txt by default)
 *  - Extended secret pattern scanning (warn-only, never prints secrets)
 *  - Directory / file allow + deny lists
 *  - CLI args: --out <file>, --max-size <bytes>, --include-tests, --no-tests
 *  - Summary section with potential secret hits & skipped files
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argValue(flag, def) {
  const i = args.indexOf(flag);
  if (i !== -1 && i < args.length - 1) return args[i + 1];
  return def;
}
function hasFlag(flag) { return args.includes(flag); }

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, argValue('--out', 'CODE_DUMP_GEMINI.txt'));
const MAX_SIZE = parseInt(argValue('--max-size', '2000000'), 10); // 2MB default per file
const INCLUDE_TESTS = hasFlag('--include-tests') ? true : (hasFlag('--no-tests') ? false : true);

// Deny/Exclude patterns
const EXCLUDED_DIRS = new Set([
  'node_modules','dist','build','.next','coverage','.turbo','.git','pnpm-store','.venv','.idea','.vscode','artifacts','.vercel'
]);
const EXCLUDED_FILE_NAMES = new Set([
  'pnpm-lock.yaml','.DS_Store','.env','.env.local','.env.example','.env.production','.env.development','CODE_DUMP_GEMINI.txt','PROJECT_CODE_DUMP.txt'
]);
const EXCLUDED_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.ico','.ttf','.woff','.woff2','.otf','.bin','.dat','.mp3','.mp4','.webm','.ogg','.exe','.dll','.so','.dylib','.zip','.gz','.tgz','.7z','.onnx'
]);

// Secret patterns (broad). We only log masked matches.
const SECRET_PATTERNS = [
  { name: 'OPENAI_KEY', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'AZURE_SPEECH_KEY', re: /(?:azure|speech)[-_]?(?:key)?['"=: ]+([A-Za-z0-9+\/_]{16,})/gi },
  { name: 'STRIPE_KEY', re: /sk_live_[A-Za-z0-9]{10,}/g },
  { name: 'STRIPE_TEST_KEY', re: /sk_test_[A-Za-z0-9]{10,}/g },
  { name: 'CLERK_KEY', re: /clerk_(?:pub|sec)_[A-Za-z0-9]{20,}/g },
  { name: 'SUPABASE_KEY', re: /sbp_[A-Za-z0-9]{20,}/g },
  { name: 'GENERIC_API_KEY', re: /api[_-]?key['"=:\s]+[A-Za-z0-9+\/_-]{16,}/gi },
];

const potentialSecrets = [];
const skipped = [];

function includeFile(fullPath, rel) {
  const base = path.basename(fullPath);
  if (EXCLUDED_FILE_NAMES.has(base)) { skipped.push(rel + ' (name)'); return false; }
  const ext = path.extname(base).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) { skipped.push(rel + ' (ext)'); return false; }
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_SIZE) { skipped.push(rel + ` (>max ${MAX_SIZE})`); return false; }
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    const suspiciousBinary = /[\x00\x01\x02\x03]/.test(buf.slice(0, bytesRead).toString('latin1'));
    if (suspiciousBinary) { skipped.push(rel + ' (binary)'); return false; }
  } catch (e) {
    skipped.push(rel + ' (stat error)');
    return false;
  }
  if (!INCLUDE_TESTS && /(^|\/)tests?(-examples)?\//i.test(rel)) { skipped.push(rel + ' (tests)'); return false; }
  return true;
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      if (includeFile(full, rel)) yield { full, rel };
    }
  }
}

function scanForSecrets(rel, content) {
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const raw = m[0];
      const masked = raw.slice(0, 4) + '...' + raw.slice(-4);
      potentialSecrets.push({ file: rel, type: name, sample: masked });
      if (potentialSecrets.length > 200) return; // cap noise
    }
  }
}

console.log('[dump-code-gemini] Generating sanitized code dump...');
const files = Array.from(walk(ROOT)).sort((a,b)=>a.rel.localeCompare(b.rel));
const headerLines = [
  '# GEMINI CODE DUMP GENERATED: ' + new Date().toISOString(),
  '# TOTAL INCLUDED FILES: ' + files.length,
  '# MAX FILE SIZE: ' + MAX_SIZE + ' bytes',
  '# INCLUDE TESTS: ' + INCLUDE_TESTS,
  '# NOTE: Potential secrets are SCANNED but NOT included; review summary below.'
];
fs.writeFileSync(OUTPUT, headerLines.join('\n') + '\n');

let count = 0;
for (const { full, rel } of files) {
  const banner = '\n################################################################################\n';
  fs.appendFileSync(OUTPUT, banner + '# FILE: ' + rel + '\n' + banner + '\n');
  try {
    const content = fs.readFileSync(full, 'utf8');
    scanForSecrets(rel, content);
    fs.appendFileSync(OUTPUT, content + '\n');
    count++;
  } catch (e) {
    fs.appendFileSync(OUTPUT, '# ERROR READING FILE: ' + e.message + '\n');
  }
}

// Summary footer
fs.appendFileSync(OUTPUT, '\n\n################################################################################\n# SUMMARY\n################################################################################\n');
fs.appendFileSync(OUTPUT, `# FILES_WRITTEN: ${count}\n`);
fs.appendFileSync(OUTPUT, `# FILES_SKIPPED: ${skipped.length}\n`);
if (skipped.length) {
  fs.appendFileSync(OUTPUT, '# SKIPPED_LIST (first 100):\n');
  for (const s of skipped.slice(0,100)) fs.appendFileSync(OUTPUT, '#  - ' + s + '\n');
}
if (potentialSecrets.length) {
  fs.appendFileSync(OUTPUT, `# POTENTIAL_SECRETS_FOUND: ${potentialSecrets.length} (masked)\n`);
  fs.appendFileSync(OUTPUT, '# REVIEW THESE FILE LOCATIONS MANUALLY:\n');
  for (const p of potentialSecrets.slice(0,200)) {
    fs.appendFileSync(OUTPUT, `#  - [${p.type}] ${p.file} => ${p.sample}\n`);
  }
} else {
  fs.appendFileSync(OUTPUT, '# POTENTIAL_SECRETS_FOUND: 0\n');
}

console.log(`[dump-code-gemini] Wrote ${count} files to ${OUTPUT}`);
if (potentialSecrets.length) {
  console.warn(`[dump-code-gemini] WARNING: Detected ${potentialSecrets.length} potential secret-like strings. Check summary in output file before sharing.`);
}
