#!/usr/bin/env node
// Concatenate all project source files (excluding secrets/binaries) into PROJECT_CODE_DUMP.txt
// Designed for external AI review; excludes env files and common build/product dirs.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'PROJECT_CODE_DUMP.txt');
const EXCLUDED_DIRS = new Set([
  'node_modules','dist','build','.next','coverage','.turbo','.git','pnpm-store','.venv','.idea','.vscode'
]);
const EXCLUDED_FILE_NAMES = new Set([
  'pnpm-lock.yaml','.env','.env.local','.env.example','.DS_Store'
]);
const EXCLUDED_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.ico','.ttf','.woff','.woff2','.otf','.bin','.dat','.mp3','.mp4','.webm','.ogg','.exe','.dll','.so','.dylib','.zip','.gz','.tgz','.7z'
]);

/** Return true if file should be included */
function includeFile(fullPath, rel) {
  const base = path.basename(fullPath);
  if (EXCLUDED_FILE_NAMES.has(base)) return false;
  const ext = path.extname(base).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) return false;
  // Skip large binary inference by sampling first bytes
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 2_000_000) return false; // skip >2MB
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    const suspiciousBinary = /[\x00\x01\x02\x03]/.test(buf.slice(0, bytesRead).toString('latin1'));
    if (suspiciousBinary) return false;
  } catch {}
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

console.log('[dump-code] Generating code dump...');
const files = Array.from(walk(ROOT)).sort((a,b)=>a.rel.localeCompare(b.rel));
const headerLines = [
  '# CODE DUMP GENERATED: ' + new Date().toISOString(),
  '# TOTAL FILES: ' + files.length,
  '# NOTE: Secrets (.env*) and binaries/build artifacts excluded.'
];
fs.writeFileSync(OUTPUT, headerLines.join('\n') + '\n');

let count = 0;
for (const { full, rel } of files) {
  const banner = '\n################################################################################\n';
  fs.appendFileSync(OUTPUT, banner + '# FILE: ' + rel + '\n' + banner + '\n');
  try {
    fs.appendFileSync(OUTPUT, fs.readFileSync(full, 'utf8') + '\n');
    count++;
  } catch (e) {
    fs.appendFileSync(OUTPUT, '# ERROR READING FILE: ' + e.message + '\n');
  }
}

console.log(`[dump-code] Wrote ${count} files to ${OUTPUT}`);