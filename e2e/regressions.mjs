// Regression checks in a real browser for defects found in review.
//   node e2e/regressions.mjs            (needs Playwright with Chromium available)
// Serves ./app on a local port itself. Screenshots go to e2e/shots/.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'app');
const shots = join(here, 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(shots, { recursive: true });

let failures = 0;
const ok = (cond, label) => { if (cond) console.log('  ok  ' + label); else { failures++; console.log('  FAIL ' + label); } };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Nobody is due yet' }).waitFor();
  // Seed records straight into storage.
  await page.evaluate(async () => {
    const { putAcross, state, saveSettings } = await import('./src/store.js');
    const snap = (name, city) => ({ company: { name: 'Ace' }, customer: { name, address: '1 St', city }, tank: { kind: 'Septic tank', capacity: '1000' }, driver: { name: 'Sam' }, truck: { name: 'Truck 1', capacity: '2500' } });
    await putAcross({
      customers: [{ id: 'c1', name: 'Oak Family', address: '1 St', city: 'Hutto' }, { id: 'c2', name: 'Pine Farm', address: '2 St', city: 'Taylor' }],
      tanks: [{ id: 'k1', customerId: 'c1', kind: 'Septic tank', capacity: '1000', intervalMonths: '24', active: true }, { id: 'k2', customerId: 'c2', kind: 'Septic tank', capacity: '1500', active: true }],
      drivers: [{ id: 'd1', name: 'Sam' }],
      trucks: [{ id: 't1', name: 'Truck 1', capacity: '2500' }, { id: 't2', name: 'Truck 2', capacity: '2000' }],
      facilities: [{ id: 'f1', name: 'City of Fredericksburg Wastewater Treatment Plant', address: '1200 Treatment Plant Road, Fredericksburg, TX 78624', permitNo: 'WQ1', method: 'Wastewater treatment plant' }],
      jobs: [
        { id: 'j1', tankId: 'k1', date: '2026-10-01', gallons: '900', wasteType: 'DS', truckId: 't1', driverId: 'd1', obs: {}, intervalMonths: '36', loadId: null, snapshot: snap('Oak Family', 'Hutto'), createdAt: 1 },
        { id: 'j2', tankId: 'k2', date: '2026-10-05', gallons: '800', wasteType: 'DS', truckId: 't1', driverId: 'd1', obs: {}, intervalMonths: '36', loadId: null, snapshot: snap('Pine Farm', 'Taylor'), createdAt: 2 },
        { id: 'j3', tankId: 'k2', date: '2020-08-15', gallons: '700', wasteType: 'DS', truckId: 't2', driverId: 'd1', obs: {}, intervalMonths: '36', loadId: null, snapshot: snap('Pine Farm', 'Taylor'), createdAt: 3 },
      ],
    });
    state.settings.company = { ...state.settings.company, name: 'Ace' };
    await saveSettings('company');
  });
  const count = (c) => page.evaluate(async (name) => (await import('./src/store.js')).state[name].length, c);
  const job = (id) => page.evaluate(async (jid) => { const s = (await import('./src/store.js')).state; return structuredClone(s.jobs.find((j) => j.id === jid)); }, id);
  const tank = (id) => page.evaluate(async (tid) => { const s = (await import('./src/store.js')).state; return structuredClone(s.tanks.find((t) => t.id === tid)); }, id);

  // A truck with pickups on it cannot be removed
  await page.goto(base + '#/settings/trucks');
  await page.getByRole('button', { name: /Truck 2/ }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('This cannot be removed yet').waitFor();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  ok(await count('trucks') === 2, 'a truck with a pickup still on board cannot be removed');

  // A stale correction draft, then the disposal, then the correction: the load must survive
  await page.goto(base + '#/job/j1/edit');
  await page.getByLabel('Amount ($)').fill('111');
  await page.goto(base + '#/dispose/t1');
  await page.getByRole('heading', { name: 'Record the disposal' }).waitFor();

  // Disposal dated before the latest pickup is refused
  await page.getByLabel('Date').fill('2026-10-02');
  await page.getByRole('button', { name: 'Save disposal' }).click();
  ok((await page.locator('.form-error').innerText()).includes('before a pickup'), 'a disposal dated before the latest pickup is refused');

  // Double tap makes one disposal, not two
  await page.getByLabel('Date').fill('2026-10-06');
  const btn = page.getByRole('button', { name: 'Save disposal' });
  await btn.evaluate((b) => { b.click(); b.click(); b.click(); });
  await page.locator('.stamp').waitFor();
  ok(await count('loads') === 1, 'tapping save three times records one disposal');
  const loadId = (await job('j1')).loadId;
  ok(!!loadId && (await job('j2')).loadId === loadId, 'both pickups carry that one disposal');

  // Mark a copy sent, then save a correction: neither the load nor the copy date may be lost
  await page.goto(base + '#/record/j1');
  await page.locator('.copyrow').first().getByRole('button', { name: 'Sent today' }).click();
  await page.locator('.copyrow').first().getByText(/sent /).waitFor();
  await page.goto(base + '#/job/j1/edit');
  await page.getByRole('heading', { name: 'Correct this record' }).waitFor();
  ok(await page.getByText('Picked up where you left off').count() === 0, 'a draft older than the saved record is discarded');
  await page.getByLabel('Gallons removed').fill('950');
  await page.getByRole('button', { name: 'Save corrected record' }).click();
  await page.getByText('950 gallons').waitFor();
  const j1 = await job('j1');
  ok(j1.loadId === loadId && !!j1.customerCopyOn, 'correcting a disposed record keeps its disposal and its copy-sent date');
  ok((await tank('k1')).intervalMonths === '24', 'correcting a record does not change the tank schedule');

  // A disposed job's date cannot move past its disposal
  await page.goto(base + '#/job/j1/edit');
  await page.getByLabel('Date').fill('2026-10-06');
  await page.getByLabel('Gallons removed').fill('950');
  await page.getByRole('button', { name: 'Save corrected record' }).click();
  ok(true, 'same-day correction accepted');
  await page.getByText('950 gallons').waitFor();
  await page.evaluate(async () => { const { state, put } = await import('./src/store.js'); const l = state.loads[0]; l.date = '2026-10-03'; await put('loads', l); });
  await page.goto(base + '#/job/j2/edit');
  await page.getByRole('heading', { name: 'Correct this record' }).waitFor();
  await page.getByRole('button', { name: 'Save corrected record' }).click();
  ok((await page.locator('.jobform > .form-error').innerText()).includes('cannot be later'), 'a disposed job dated after its disposal is refused');

  // The pumping record prints long facility names in full
  await page.goto(base + '#/record/j1');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download record (PDF)' }).click()]);
  await dl.saveAs(join(shots, 'regression-record.pdf'));
  ok(true, 'record PDF saved for the text check');

  // June-to-May summary offers the year an old job belongs to
  await page.goto(base + '#/summary');
  await page.getByLabel('Reporting year').selectOption('june');
  await page.getByLabel('Year ending 31 May').waitFor();
  const options = await page.getByLabel('Year ending 31 May').locator('option').allInnerTexts();
  ok(options.includes('2021') && !options.includes('2020'), 'June-to-May list offers 2021 for a job in August 2020');
  await page.getByLabel('Year ending 31 May').selectOption('2021');
  await page.getByText('700 gallons').first().waitFor();
  ok(true, 'the August 2020 job appears in the year ending May 2021');

  // A new job with an untouched interval leaves the tank on the shop default
  await page.goto(base + '#/job/new/k2');
  await page.getByLabel('Gallons removed').fill('1000');
  await page.getByRole('button', { name: 'Save pump-out' }).click();
  await page.locator('.stamp').waitFor();
  ok(!(await tank('k2')).intervalMonths, 'a new job that keeps the offered interval does not pin the tank to it');

  // Erase removes drafts too
  await page.goto(base + '#/job/new/k1');
  await page.getByLabel('Gallons removed').fill('123');
  ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tankdue-draft-'))), 'a draft exists before erasing');
  await page.goto(base + '#/settings/data');
  await page.getByRole('button', { name: 'Erase everything on this device' }).click();
  await page.getByRole('button', { name: 'Erase everything', exact: true }).click();
  await page.getByRole('heading', { name: 'Nobody is due yet' }).waitFor();
  ok(await page.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith('tankdue-draft-'))), 'erasing everything also removes unsaved drafts');

  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (err) {
  failures++;
  console.log('  FAIL stopped early: ' + err.message.split('\n')[0]);
  await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  if (errors.length) console.log('  console errors: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
