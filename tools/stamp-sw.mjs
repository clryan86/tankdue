#!/usr/bin/env node
// Rewrites the asset list and version in app/sw.js from the files on disk.
// Run after changing anything under app/:   node tools/stamp-sw.mjs
// With --check it only reports whether sw.js is up to date.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const skip = new Set(['sw.js']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return [p];
  });
}

export function compute() {
  const files = walk(root).map((p) => relative(root, p).split('\\').join('/')).filter((p) => !skip.has(p) && !p.endsWith('.md')).sort();
  const hash = createHash('sha256');
  for (const f of files) { hash.update(f); hash.update(readFileSync(join(root, f))); }
  return { version: hash.digest('hex').slice(0, 12), assets: ['./', ...files.map((f) => './' + f)] };
}

export function stamped(source, { version, assets }) {
  return source
    .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
    .replace(/const ASSETS = \[[^\]]*\];/, `const ASSETS = ${JSON.stringify(assets)};`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const swPath = join(root, 'sw.js');
  const current = readFileSync(swPath, 'utf8');
  const next = stamped(current, compute());
  if (process.argv.includes('--check')) {
    if (current !== next) { console.error('app/sw.js is stale. Run: node tools/stamp-sw.mjs'); process.exit(1); }
    console.log('app/sw.js is up to date');
  } else {
    writeFileSync(swPath, next);
    console.log('Stamped app/sw.js', compute().version);
  }
}
