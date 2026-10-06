// End-to-end check in a real browser: the full tester journey, then offline.
//   node e2e/smoke.mjs            (needs Playwright with Chromium available)
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
  await page.screenshot({ path: join(shots, '01-empty.png') });

  // Settings: company, driver, truck, facility
  await page.goto(base + '#/settings/company');
  await page.getByLabel('Company name').fill('Ace Septic Service');
  await page.getByLabel('Phone').fill('(512) 555-0100');
  await page.getByLabel('Hauler registration, permit or licence number').fill('24680');
  await page.getByRole('button', { name: 'Save company' }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.goto(base + '#/settings/drivers');
  await page.getByRole('button', { name: 'Add a driver' }).click();
  await page.getByLabel('Name').fill('Sam Lee');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Sam Lee').waitFor();
  await page.goto(base + '#/settings/trucks');
  await page.getByRole('button', { name: 'Add a truck' }).click();
  await page.getByLabel('Name or unit number').fill('Truck 1');
  await page.getByLabel('Tank size (gallons)').fill('2,500');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('2,500 gallons').waitFor();
  await page.goto(base + '#/settings/facilities');
  await page.getByRole('button', { name: 'Add a receiving facility' }).click();
  await page.getByLabel('Facility name').fill('County WWTP');
  await page.getByLabel('Permit or registration number').fill('WQ0012345');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('County WWTP').waitFor();
  ok(true, 'company, driver, truck and facility saved');

  // Customer and tank, with a suggested interval
  await page.goto(base + '#/customer/new');
  await page.getByLabel('Customer or business name').fill('Oak Family');
  await page.getByLabel('Email').fill('oak@family.example');
  await page.getByLabel('Phone').fill('512-555-0111');
  await page.getByLabel('Street address').fill('12 Oak St');
  await page.getByLabel('City or town').fill('Hutto');
  await page.getByLabel('County or township').fill('Williamson');
  await page.getByRole('button', { name: 'Save and add a tank' }).click();
  await page.getByRole('heading', { name: /Add a tank/ }).waitFor();
  await page.getByLabel('Size (gallons)').fill('1000');
  await page.getByLabel('People in the home').fill('4');
  await page.getByText(/suggests about 31 months/).waitFor();
  ok(true, 'suggests 31 months for a 1,000 gallon tank and 4 people');
  await page.getByRole('button', { name: 'Use 31 months' }).click();
  ok(await page.getByLabel('Pump every (months)').inputValue() === '31', 'the suggestion fills the interval');
  await page.getByRole('button', { name: 'Save tank' }).click();
  await page.getByRole('link', { name: 'Record a pump-out' }).click();
  await page.getByRole('heading', { name: 'Record a pump-out' }).waitFor();

  // Gallons checks
  await page.getByLabel('Gallons removed').fill('5000');
  await page.getByText(/more than this tank holds/).waitFor();
  ok(true, 'warns when gallons exceed the tank size');
  await page.getByLabel('Gallons removed').fill('950');
  await page.getByText('Tank condition').click();
  await page.getByLabel('Outlet baffle or tee').selectOption('Damaged');
  await page.getByLabel('Scum depth (inches)').fill('4');
  await page.getByLabel('Amount ($)').fill('350');
  await page.getByLabel('Paid by').selectOption('Check');
  await page.screenshot({ path: join(shots, '02-job-form.png'), fullPage: true });

  // Leaving the form must not lose the entry
  await page.getByRole('link', { name: 'Customers' }).click();
  await page.getByRole('heading', { name: 'Customers' }).waitFor();
  await page.goBack();
  await page.getByText('Picked up where you left off').waitFor();
  ok(await page.getByLabel('Gallons removed').inputValue() === '950', 'unsaved entry comes back after leaving the form');

  // Sign and save
  const pad = page.getByLabel('Customer signature area');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + 60 + Math.sin(i) * 25);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save pump-out' }).click();
  await page.locator('.stamp').waitFor();
  ok(await page.getByText('Still on the truck.').count() === 1, 'job saved and shown as still on the truck');
  const recordUrl = page.url();

  // Second customer, second job on the same truck
  await page.goto(base + '#/customer/new');
  await page.getByLabel('Customer or business name').fill('Pine Farm');
  await page.getByLabel('City or town').fill('Taylor');
  await page.getByRole('button', { name: 'Save and add a tank' }).click();
  await page.getByRole('heading', { name: /Add a tank/ }).waitFor();
  await page.getByLabel('Size (gallons)').fill('1500');
  await page.getByRole('button', { name: 'Save tank' }).click();
  await page.getByRole('link', { name: 'Record a pump-out' }).click();
  await page.getByLabel('Gallons removed').fill('1,400');
  await page.getByRole('button', { name: 'Save pump-out' }).click();
  await page.locator('.stamp').waitFor();

  // Truck board
  await page.goto(base + '#/truck');
  await page.getByText('2,350').waitFor();
  ok(await page.locator('.gauge-fill.high').count() === 1, 'truck shows 2,350 of 2,500 gallons, 94 percent');
  await page.screenshot({ path: join(shots, '03-truck.png'), fullPage: true });
  const [ls] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Load sheet (PDF)' }).click()]);
  ok((await readFile(await ls.path())).subarray(0, 5).toString() === '%PDF-', 'in-transit load sheet PDF downloads');

  // Disposal
  await page.getByRole('link', { name: 'Record the disposal' }).click();
  await page.getByLabel('Facility receipt or ticket number').fill('R-5521');
  await page.getByLabel('Gallons measured by the facility').fill('2300');
  await page.getByRole('button', { name: 'Save disposal' }).click();
  await page.locator('.stamp').waitFor();
  ok(await page.locator('.rows li').count() === 2, 'disposal recorded with both pickups');
  await page.goto(base + '#/truck');
  await page.getByText(/^Empty\./).waitFor();
  ok(true, 'truck is empty after the disposal');

  // Record now shows the disposal; PDF
  await page.goto(recordUrl);
  await page.getByText(/Disposed of at/).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download record (PDF)' }).click()]);
  const pdfPath = join(shots, 'sample-record.pdf');
  await dl.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000, `pumping record PDF downloaded (${dl.suggestedFilename()}, ${pdf.length} bytes)`);
  await page.screenshot({ path: join(shots, '04-record.png'), fullPage: true });

  // Copy deadline tracking
  await page.goto(base + '#/settings/defaults');
  await page.getByLabel('Copy to the health department or local authority within (days)').fill('14');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.goto(base + '#/records');
  await page.getByRole('button', { name: /Copies to send/ }).click();
  ok(await page.locator('.rows li').count() === 2, 'both records are listed as needing a copy sent');
  await page.goto(recordUrl);
  await page.getByText(/Copy for the local authority is due in 14 days/).waitFor();
  await page.locator('.copyrow').nth(1).getByRole('button', { name: 'Sent today' }).click();
  await page.locator('.copyrow').nth(1).getByText(/sent /).waitFor();
  await page.goto(base + '#/records');
  await page.getByRole('button', { name: /Copies to send/ }).click();
  ok(await page.locator('.rows li').count() === 1, 'marking a copy sent removes it from the to-send list');

  // Summary
  await page.goto(base + '#/summary');
  await page.getByText('2,350 gallons').first().waitFor();
  ok(await page.locator('.sumtable').count() === 3, 'hauling summary shows 2,350 gallons in three groupings');
  await page.screenshot({ path: join(shots, '05-summary.png'), fullPage: true });
  const [sm] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download summary (PDF)' }).click()]);
  await sm.saveAs(join(shots, 'sample-summary.pdf'));
  ok((await readFile(join(shots, 'sample-summary.pdf'))).subarray(0, 5).toString() === '%PDF-', 'summary PDF downloads');

  // Correcting a record keeps what it said
  await page.goto(recordUrl);
  await page.getByRole('link', { name: 'Correct this record' }).click();
  await page.getByRole('heading', { name: 'Correct this record' }).waitFor();
  ok(await page.getByText('its truck cannot change').count() === 1, 'a disposed job cannot be moved to another truck');
  await page.getByLabel('Gallons removed').fill('975');
  await page.getByRole('button', { name: 'Save corrected record' }).click();
  await page.getByText('975 gallons').waitFor();
  ok(true, 'record corrected to 975 gallons');

  // Due board: next due 31 months on; import; reminder
  await page.goto(base + '#/due');
  await page.getByRole('button', { name: /^All/ }).click();
  ok(await page.locator('.tag.ok').count() === 2, 'both tanks now show a future due date');
  const d = new Date(); d.setFullYear(d.getFullYear() - 3); d.setDate(d.getDate() + 10);
  const csv = 'Customer,Address,City,Email,Tank type,Tank size,Last pumped\nElm School,7 Elm Ave,Taylor,office@elm.example,Septic,2000,' + `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` + '\nBirch Cafe,4 Birch Rd,Hutto,,Grease trap,750,1/5/2026\n';
  const csvPath = join(shots, 'import.csv');
  await writeFile(csvPath, csv);
  await page.goto(base + '#/settings/data');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import a CSV file' }).click()]);
  await chooser.setFiles(csvPath);
  await page.getByRole('button', { name: 'Add them' }).click();
  await page.getByText(/Added 2 customers and 2 tanks/).waitFor();
  ok(true, 'spreadsheet import added 2 customers and 2 tanks');
  await page.goto(base + '#/due');
  await page.locator('.tag.overdue').first().waitFor();
  ok(await page.locator('.tag.overdue').count() === 1 && await page.locator('.tag.soon').count() === 1, 'due board: grease trap overdue (3-month default), septic due within 30 days');
  await page.screenshot({ path: join(shots, '06-due-board.png'), fullPage: true });
  await page.locator('.tag.soon').getByRole('button', { name: 'Remind' }).click();
  ok((await page.getByLabel('Message').inputValue()).includes('7 Elm Ave'), 'reminder message is filled in for the customer');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Backup round trip
  const [bk] = await Promise.all([page.waitForEvent('download'), (async () => { await page.goto(base + '#/settings/data'); await page.getByRole('button', { name: 'Save a backup file' }).click(); })()]);
  const bkPath = join(shots, 'backup.json');
  await bk.saveAs(bkPath);
  const backup = JSON.parse(await readFile(bkPath, 'utf8'));
  ok(backup.customers.length === 4 && backup.jobs.length === 2 && backup.loads.length === 1, 'backup holds 4 customers, 2 jobs and 1 disposal');

  // Offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await context.setOffline(true);
  await page.reload();
  await page.goto(base + '#/records');
  await page.getByRole('heading', { name: 'Records' }).waitFor();
  ok(await page.getByText('Oak Family').count() >= 1, 'works with the network off: app loads and records are there');
  const [dl2] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByText('Oak Family').first().click(); await page.getByRole('button', { name: 'Download record (PDF)' }).click(); })()]);
  ok((await dl2.path()) !== null, 'PDF is built with the network off');
  await context.setOffline(false);

  // Restore on a second device, undo a disposal, trial gate
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('ctx2 ' + String(e)));
  await p2.goto(base + '#/settings/data');
  const [ch2] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('button', { name: 'Restore from a backup' }).click()]);
  await ch2.setFiles(bkPath);
  await p2.getByRole('button', { name: 'Replace with backup' }).click();
  await p2.getByRole('heading', { name: 'Who is due' }).waitFor();
  await p2.getByRole('button', { name: /^All/ }).click();
  ok(await p2.locator('.tag').count() === 4, 'backup restores on a second device');
  await p2.screenshot({ path: join(shots, '07-desktop-due.png'), fullPage: true });
  await p2.goto(base + '#/truck');
  await p2.locator('.rows a').first().click();
  await p2.getByRole('button', { name: 'Undo this disposal' }).click();
  await p2.getByRole('button', { name: 'Undo disposal' }).click();
  await p2.getByText('2,375').waitFor();
  ok(true, 'undoing a disposal puts both pickups back on the truck (2,375 gallons)');

  await p2.evaluate(async () => {
    const { state, putMany } = await import('./src/store.js');
    const j = state.jobs[0];
    await putMany('jobs', Array.from({ length: 18 }, (_, i) => ({ ...structuredClone(j), id: 'filler-' + i, loadId: 'none' })));
  });
  await p2.reload();
  await p2.goto(base + '#/due');
  await p2.getByRole('button', { name: /^All/ }).click();
  await p2.getByRole('link', { name: 'Record a pump-out' }).first().click();
  await p2.getByRole('heading', { name: 'The free trial is used up' }).waitFor({ timeout: 5000 });
  ok(true, 'new jobs are blocked after 20 trial jobs');
  await p2.goto(base + '#/records');
  ok(await p2.locator('.rows li').count() === 20, 'saved records stay readable after the trial');
  if (process.env.TANKDUE_TEST_KEY) {
    await p2.goto(base + '#/settings/licence');
    await p2.getByLabel('Licence key').fill('TK1.bogus.key');
    await p2.getByRole('button', { name: 'Save licence key' }).click();
    ok(await p2.locator('.form-error').innerText() !== '', 'a bad licence key is refused');
    await p2.getByLabel('Licence key').fill(process.env.TANKDUE_TEST_KEY);
    await p2.getByRole('button', { name: 'Save licence key' }).click();
    await p2.getByText(/^Licensed/).waitFor();
    await p2.goto(base + '#/due');
    await p2.getByRole('button', { name: /^All/ }).click();
    await p2.getByRole('link', { name: 'Record a pump-out' }).first().click();
    await p2.getByRole('heading', { name: 'Record a pump-out' }).waitFor({ timeout: 5000 });
    ok(true, 'a real licence key unlocks new jobs');
  }
  await ctx2.close();

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
