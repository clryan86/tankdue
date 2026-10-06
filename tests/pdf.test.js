import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobPDF, buildLoadPDF, buildSummaryPDF, safeText, jobFilename, observationPairs } from '../app/src/pdf.js';
import { summarise } from '../app/src/domain/service.js';

const company = { name: 'Ace Septic', address: '1 Main St', cityStateZip: 'Hutto, TX 78634', phone: '555-0100', email: 'a@ace.example', registration: '24680' };
const job = {
  id: '3f2b8c1e-aaaa', tankId: 't1', date: '2026-10-06', time: '09:15', gallons: '1000', wasteType: 'DS', reason: 'Routine maintenance',
  obs: { level: 'Normal', scum: '4', sludge: '10', inlet: 'Good', outlet: 'Damaged', filterPresent: true, filterCleaned: true, leak: false, lids: 'Good' },
  condition: 'Outlet tee cracked', work: 'Cleaned filter', recommend: 'Replace outlet tee', nextDue: '2029-10-06', price: '350.00', paid: 'Check',
  snapshot: {
    company,
    customer: { name: 'Oak Family', contact: 'Pat', phone: '555-0111', address: '12 Oak St', city: 'Hutto', state: 'TX', zip: '78634', county: 'Williamson' },
    tank: { kind: 'Septic tank', capacity: '1000', material: 'Concrete', compartments: '2', county: 'Williamson' },
    driver: { name: 'Sam Lee' }, truck: { name: 'Truck 1', plate: 'ABC123', capacity: '2500' },
  },
};
const load = { id: 'L1-xyz', date: '2026-10-06', time: '15:30', receiptNo: 'R-5521', rep: 'J. Doe', gallons: '2050', snapshot: { facility: { name: 'City WWTP', permitNo: 'WQ001', method: 'Wastewater treatment plant', address: '1 Plant Rd' }, truck: job.snapshot.truck } };

async function pageCount(bytes) {
  const { PDFDocument } = await import('../app/vendor/pdf-lib.esm.min.js');
  return (await PDFDocument.load(bytes)).getPageCount();
}

test('pumping record: one page with and without a disposal', async () => {
  for (const l of [load, null]) {
    const bytes = await buildJobPDF(job, l);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
    assert.equal(await pageCount(bytes), 1);
  }
});

test('pumping record tolerates missing data, odd text and a bad signature', async () => {
  const bare = await buildJobPDF({ id: 'x', date: '2026-10-06', gallons: '', obs: {}, customerSignature: 'data:image/png;base64,AAAA' }, null);
  assert.equal(await pageCount(bare), 1);
  const long = structuredClone(job);
  long.condition = 'Replaced “everything” — café ≥ spec \u{1F6B0} 中文\n' + 'word '.repeat(600) + 'x'.repeat(700);
  long.snapshot.customer.name = 'A'.repeat(300);
  assert.ok((await pageCount(await buildJobPDF(long, load))) >= 2);
});

test('load sheet lists every pickup and paginates', async () => {
  const jobs = Array.from({ length: 70 }, (_, i) => ({ ...job, id: 'j' + i, gallons: String(500 + i) }));
  const bytes = await buildLoadPDF({ company, truck: job.snapshot.truck, jobs, load });
  assert.ok((await pageCount(bytes)) >= 2);
  assert.equal(await pageCount(await buildLoadPDF({ company, truck: job.snapshot.truck, jobs: [job], load: null })), 1);
  assert.equal(await pageCount(await buildLoadPDF({ company: {}, truck: {}, jobs: [], load: null })), 1);
});

test('summary PDF builds from a real summary, including an empty one', async () => {
  const jobs = [{ ...job, loadId: 'L1' }, { ...job, id: 'j2', gallons: '800', wasteType: 'GS' }];
  const s = summarise(jobs, new Map([['L1', load]]), '2026-01-01', '2026-12-31');
  assert.equal(await pageCount(await buildSummaryPDF({ company, label: 'Calendar year 2026', summary: s })), 1);
  const empty = summarise([], new Map(), '2026-01-01', '2026-12-31');
  assert.equal(await pageCount(await buildSummaryPDF({ company, label: 'Calendar year 2026', summary: empty })), 1);
});

test('helpers', () => {
  assert.equal(safeText('café “ok” — ≥ 5'), 'café "ok" - >= 5');
  assert.equal(safeText('中'), '?');
  assert.equal(jobFilename(job), 'pumping-record-2026-10-06-Oak-Family.pdf');
  assert.equal(jobFilename({ date: '2026-10-06', snapshot: { customer: { name: '../../etc' } } }), 'pumping-record-2026-10-06-etc.pdf');
  const pairs = Object.fromEntries(observationPairs(job));
  assert.equal(pairs['Scum depth'], '4 in');
  assert.equal(pairs['Signs of leaking'], 'No');
  assert.equal(pairs['Effluent filter cleaned'], 'Yes');
  assert.equal('Backflow from drainfield' in pairs, false);
  assert.deepEqual(observationPairs({ obs: { filterCleaned: true } }), []);
});
