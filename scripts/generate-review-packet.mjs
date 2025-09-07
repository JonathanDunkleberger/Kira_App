#!/usr/bin/env zx
import { $, which } from 'zx';
import fs from 'node:fs';
import path from 'node:path';

// Ensure artifacts dir exists (cross-platform)
fs.mkdirSync(path.resolve('artifacts'), { recursive: true });

// project tree (3 levels, ignore big dirs)
try {
  if (await which('tree').catch(() => null)) {
    await $`tree -I node_modules;.next;dist;build;.git;artifacts -L 3 > artifacts/project_tree.txt`;
  } else {
    // Fallback Node walker
    const ignore = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'artifacts']);
    const lines = [];
    function walk(dir, depth = 0) {
      if (depth > 2) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (ignore.has(e.name)) continue;
        lines.push(`${'  '.repeat(depth)}- ${e.name}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
      }
    }
    walk('.');
    fs.writeFileSync('artifacts/project_tree.txt', lines.join('\n'));
  }
} catch {}

// dependency graph + cycles
try {
  await $`npm run graph --silent`;
} catch {}
try {
  await $`npx madge app lib components --image artifacts/cycles.png`;
} catch {}

// dead/unused code & deps
try {
  await $`npm run -s deadcode`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/tsprune.txt', p.stdout ?? ''));
} catch {}
try {
  await $`npx knip --reporter json`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/knip.json', p.stdout ?? ''));
} catch {}
try {
  await $`npm run -s deps:unused`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/depcheck.txt', p.stdout ?? ''));
} catch {}

// lint & typecheck
try {
  await $`npx eslint . -f json`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/eslint.json', p.stdout ?? ''));
} catch {}
try {
  await $`npx tsc --noEmit --pretty false`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/tsc.txt', p.stdout ?? ''));
} catch {}

// routes (Next.js 13+/App Router)
try {
  if (await which('rg').catch(() => null)) {
    await $`rg -n "createRouteHandler|generateStaticParams|metadata|export const dynamic|export const revalidate" app`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/routes_signals.txt', p.stdout ?? ''));
  }
} catch {}

// API endpoints (Next.js route handlers)
try {
  if (await which('rg').catch(() => null)) {
    await $`rg -n "/api/.*(GET|POST|PUT|DELETE|PATCH)" app`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/endpoints_guess.txt', p.stdout ?? ''));
  }
} catch {}

// TODO / flags
try {
  if (await which('rg').catch(() => null)) {
    await $`rg -n "(TODO|FIXME|@deprecated|featureFlag|killSwitch)"`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/todos.txt', p.stdout ?? ''));
  }
} catch {}

// env usage (uppercase vars) vs example file
try {
  if (await which('rg').catch(() => null)) {
    await $`rg -oN "[A-Z][A-Z0-9_]{2,}" app lib components | sort -u`.stdio('pipe').then((p) => fs.writeFileSync('artifacts/env_in_code.txt', p.stdout ?? ''));
  } else {
    // simple fallback: scan files with a regex in Node
    const globs = ['app', 'lib', 'components'];
    const re = /[A-Z][A-Z0-9_]{2,}/g;
    const set = new Set();
    function scan(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (/(\.[jt]sx?|\.m?js|\.ts)$/.test(e.name)) {
          const txt = fs.readFileSync(p, 'utf8');
          const matches = txt.match(re) || [];
          for (const m of matches) set.add(m);
        }
      }
    }
    for (const g of globs) if (fs.existsSync(g)) scan(g);
    fs.writeFileSync('artifacts/env_in_code.txt', Array.from(set).sort().join('\n'));
  }
  if (fs.existsSync('.env.example')) {
    const lines = fs.readFileSync('.env.example', 'utf8').split(/\r?\n/).filter(Boolean).sort();
    fs.writeFileSync('artifacts/env_example_sorted.txt', lines.join('\n'));
  }
} catch {}

console.log('✅ Review packet generated in artifacts/');
