#!/usr/bin/env node
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const globs = ['app', 'lib', 'components', 'pages', 'src'];
const re = /FLAG:\s*([a-zA-Z0-9_-]+)\s+expires=(\d{4}-\d{2}-\d{2})/;

let files = [];
try {
  files = execSync(`git ls-files ${globs.join(' ')}`, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  // Not a git repo or no files, skip
}

const today = new Date().toISOString().slice(0, 10);
let failed = false;

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) {
      const [, name, date] = m;
      if (date < today) {
        console.error(`Expired flag: ${name} in ${f} (expired ${date})`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log('No expired flags 🎉');
