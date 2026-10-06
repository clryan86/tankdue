import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { compute, stamped } from '../tools/stamp-sw.mjs';

test('service worker lists every app file and its version is current', () => {
  const sw = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  assert.equal(sw, stamped(sw, compute()), 'app/sw.js is stale. Run: node tools/stamp-sw.mjs');
  const { assets } = compute();
  for (const a of assets.slice(1)) assert.ok(existsSync(new URL('../app/' + a.slice(2), import.meta.url)), a);
  for (const needed of ['./index.html', './app.css', './src/main.js', './vendor/pdf-lib.esm.min.js', './manifest.webmanifest']) assert.ok(assets.includes(needed), needed);
});
