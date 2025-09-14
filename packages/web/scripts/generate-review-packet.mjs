#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const A = 'artifacts';
fs.mkdirSync(A, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });
  return { ok: r.status === 0, out: r.stdout?.trim() || '', err: r.stderr?.trim() || '' };
}
function write(p, s) {
  fs.writeFileSync(path.join(A, p), s ?? '', 'utf8');
}

// 1) project tree (Windows-safe)
{
  const treeCli = run('npx', [
    '-y',
    'tree-cli',
    '-L',
    '3',
    '-I',
    'node_modules,.next,dist,build,artifacts,.git,coverage,.vercel,.turbo',
  ]);
  if (treeCli.ok) write('project_tree.txt', treeCli.out);
  else {
    // fallback: directories/files (depth <= 3)
    const root = process.cwd().split(path.sep);
    const max = root.length + 3;
    const lines = [];
    function walk(dir) {
      const parts = dir.split(path.sep);
      if (parts.length > max) return;
      const rel = dir === process.cwd() ? '' : dir.slice(process.cwd().length + 1);
      if (rel) lines.push(rel);
      for (const e of fs.readdirSync(dir)) {
        if (
          [
            'node_modules',
            '.next',
            'dist',
            'build',
            'artifacts',
            '.git',
            'coverage',
            '.vercel',
            '.turbo',
          ].includes(e)
        )
          continue;
        const p = path.join(dir, e);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
      }
    }
    walk(process.cwd());
    write('project_tree.txt', lines.sort().join('\n'));
  }
}

// 2) dependency graph & cycles
{
  // JSON graph (always works)
  const depcruiseJson = run('npx', [
    '-y',
    'dependency-cruiser',
    'src',
    'app',
    'lib',
    '--include-only',
    '^src|^app|^lib',
    '--output-type',
    'json',
  ]);
  if (depcruiseJson.ok) write('deps.json', depcruiseJson.out);

  // DOT → SVG/PNG if dot exists
  const depcruiseDot = run('npx', [
    '-y',
    'dependency-cruiser',
    'src',
    'app',
    'lib',
    '--include-only',
    '^src|^app|^lib',
    '--output-type',
    'dot',
  ]);
  const dotExists = run('dot', ['-V']).ok;
  if (depcruiseDot.ok && dotExists) {
    write('deps.dot', depcruiseDot.out);
    run('dot', ['-Tsvg', path.join(A, 'deps.dot'), '-o', path.join(A, 'deps.svg')]);
  }

  // cycles via madge
  const madgeJson = run('npx', ['-y', 'madge', 'app', 'lib', '--json', '--circular']);
  write('cycles.json', madgeJson.ok ? madgeJson.out : '[]');
}

// 3) dead/unused code & deps
{
  const knip = run('npx', ['-y', 'knip', '--reporter', 'json']);
  write('knip.json', knip.ok ? knip.out : '[]');

  const tsprune = run('npx', ['-y', 'ts-prune']);
  write('tsprune.txt', tsprune.ok ? tsprune.out : '');

  const depcheck = run('npx', ['-y', 'depcheck']);
  write('depcheck.txt', depcheck.ok ? depcheck.out : depcheck.err);
}

// 4) lint & typecheck
{
  write('eslint.json', run('npx', ['-y', 'eslint', '.', '-f', 'json']).out);
  write('tsc.txt', run('npx', ['-y', 'tsc', '--noEmit', '--pretty', 'false']).out);
}

// 5) routes / endpoints / todos (ripgrep if present)
{
  const hasRg = run('rg', ['--version']).ok;
  if (hasRg) {
    write(
      'routes_signals.txt',
      run('rg', [
        '-n',
        'createRouteHandler|generateStaticParams|export const dynamic|export const revalidate',
        'app',
      ]).out,
    );
    write(
      'endpoints_guess.txt',
      run('rg', ['-n', '/api/.*(GET|POST|PUT|DELETE|PATCH)', 'app']).out,
    );
    write('todos.txt', run('rg', ['-n', '(TODO|FIXME|@deprecated|featureFlag|killSwitch)']).out);
    write('env_in_code.txt', run('rg', ['-oN', '[A-Z][A-Z0-9_]{2,}', 'app', 'lib']).out);
  } else {
    write('routes_signals.txt', '');
    write('endpoints_guess.txt', '');
    write('todos.txt', '');
    write('env_in_code.txt', '');
  }
}

console.log('✅ Review packet written to artifacts/');
