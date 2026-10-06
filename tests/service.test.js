import test from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, siteLine, MAX_GALLONS, suggestIntervalMonths, standing, intervalFor, compareStanding, dueLabel, gallons, formatGallons, money, truckLoad, period, summarise, copiesOwed, addMonthsISO, mergeDefaults, wasteForKind } from '../app/src/domain/service.js';

const today = '2026-10-06';

test('gallons parsing accepts what drivers type and rejects what is unclear', () => {
  assert.equal(gallons('1000'), 1000);
  assert.equal(gallons('1,000'), 1000);
  assert.equal(gallons('1,250.5'), 1250.5);
  assert.equal(gallons(' 900 gal '), 900);
  assert.equal(gallons('1000 gallons'), 1000);
  assert.equal(gallons(''), null);
  assert.equal(gallons('1,00'), null);
  assert.equal(gallons('-5'), null);
  assert.equal(gallons('1e3'), null);
  assert.equal(gallons('about 900'), null);
  assert.equal(gallons(0), 0);
  assert.equal(gallons('1.000'), null); // one, or one thousand? ask again
  assert.equal(gallons('1000.50'), 1000.5);
  assert.equal(gallons('1 000'), null);
  assert.equal(gallons(String(MAX_GALLONS + 1)), null);
  assert.equal(formatGallons(1250), '1,250');
  assert.equal(formatGallons(1234567.25), '1,234,567.3');
  assert.equal(formatGallons(''), '');
  assert.equal(formatGallons(null), '');
});

test('money parsing', () => {
  assert.equal(money('$350'), 350);
  assert.equal(money('1,250.50'), 1250.5);
  assert.equal(money(''), null);
  assert.equal(money('350.555'), null);
  assert.equal(money('free'), null);
});

test('suggested interval follows the published table, capped and floored', () => {
  // 1,000 gal, 4 people: 2.6 years
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: 4, capMonths: 60 }), 31);
  // 1,000 gal, 2 people: 5.9 years, capped
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: 2, capMonths: 36 }), 36);
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: 2, capMonths: 120 }), 71);
  // in-between sizes use the next smaller tank (cautious)
  assert.equal(suggestIntervalMonths({ capacity: 1200, people: 4, capMonths: 60 }), 31);
  assert.equal(suggestIntervalMonths({ capacity: 1250, people: 4, capMonths: 60 }), 41);
  // more than ten people uses the ten-person column; tiny results floor at 3 months
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: 14, capMonths: 60 }), 8);
  assert.equal(suggestIntervalMonths({ capacity: 500, people: 9, capMonths: 60 }), 3);
  assert.equal(suggestIntervalMonths({ capacity: 500, people: 10, capMonths: 60 }), 3);
  // larger than the table uses its largest verified row
  assert.equal(suggestIntervalMonths({ capacity: 5000, people: 5, capMonths: 120 }), 62);
  // not enough to go on
  assert.equal(suggestIntervalMonths({ capacity: '', people: 4 }), null);
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: '' }), null);
  assert.equal(suggestIntervalMonths({ capacity: 300, people: 2 }), null);
  assert.equal(suggestIntervalMonths({ capacity: 1000, people: 0 }), null);
});

test('interval: tank value wins, then defaults by kind', () => {
  assert.equal(intervalFor({ kind: 'Septic tank', intervalMonths: 24 }), 24);
  assert.equal(intervalFor({ kind: 'Septic tank' }), 36);
  assert.equal(intervalFor({ kind: 'Grease trap' }), 3);
  assert.equal(intervalFor({ kind: 'Septic tank', intervalMonths: 'abc' }, { intervalMonths: '48' }), 48);
  assert.equal(mergeDefaults({ intervalMonths: 0, greaseMonths: -2, customerDays: 'x' }).intervalMonths, 36);
  assert.equal(mergeDefaults({ greaseMonths: -2 }).greaseMonths, 3);
  assert.equal(wasteForKind('Grease trap'), 'GS');
  assert.equal(wasteForKind('nonsense'), 'DS');
});

test('standing', () => {
  const tank = { kind: 'Septic tank', intervalMonths: 36 };
  assert.equal(standing(tank, [], null, today).status, 'unknown');
  const s = standing(tank, [{ date: '2023-10-20' }, { date: '2020-01-01' }], null, today);
  assert.equal(s.due, '2026-10-20');
  assert.equal(s.status, 'soon');
  assert.equal(standing(tank, [{ date: '2023-10-05' }], null, today).status, 'overdue');
  assert.equal(standing(tank, [{ date: '2023-11-20' }], null, today).status, 'upcoming');
  assert.equal(standing(tank, [{ date: '2025-01-01' }], null, today).status, 'ok');
  assert.equal(standing({ ...tank, lastPumpedImported: '2023-10-05' }, [], null, today).status, 'overdue');
  assert.equal(standing({ ...tank, lastPumpedImported: '2020-01-01' }, [{ date: '2025-01-01' }], null, today).due, '2028-01-01');
  assert.equal(standing({ ...tank, onCall: true }, [{ date: '2020-01-01' }], null, today).status, 'oncall');
  assert.equal(standing({ kind: 'Grease trap' }, [{ date: '2026-07-01' }], null, today).due, '2026-10-01');
  assert.equal(addMonthsISO('2024-02-29', 36), '2027-02-28');
  const list = [{ status: 'ok', due: '2028-01-01' }, { status: 'unknown' }, { status: 'overdue', due: '2026-01-01' }, { status: 'soon', due: '2026-10-10' }];
  assert.deepEqual(list.sort(compareStanding).map((x) => x.status), ['overdue', 'soon', 'unknown', 'ok']);
  assert.equal(dueLabel({ status: 'overdue', days: -3 }), '3 days overdue');
});

test('truck load: totals, capacity and mixed-waste warnings', () => {
  const truck = { id: 't1', capacity: '2,300' };
  const jobs = [
    { truckId: 't1', gallons: '1000', wasteType: 'DS' },
    { truckId: 't1', gallons: '1,000', wasteType: 'DS' },
    { truckId: 't1', gallons: '500', wasteType: 'DS', loadId: 'L1' }, // already discharged
    { truckId: 't2', gallons: '900', wasteType: 'GS' },
  ];
  const l = truckLoad(truck, jobs);
  assert.equal(l.open.length, 2);
  assert.equal(l.total, 2000);
  assert.equal(l.percent, 87);
  assert.deepEqual(l.warnings, []);
  const over = truckLoad(truck, [...jobs, { truckId: 't1', gallons: '750', wasteType: 'GS' }]);
  assert.equal(over.percent, 100);
  assert.equal(over.warnings.length, 2);
  assert.equal(truckLoad({ id: 't9', capacity: '' }, jobs).percent, null);
});

test('reporting periods', () => {
  assert.deepEqual(period('june', 2026), { from: '2025-06-01', to: '2026-05-31', label: '1 June 2025 to 31 May 2026' });
  assert.equal(period('calendar', '2026').to, '2026-12-31');
});

test('summary groups gallons and never counts undischarged waste as disposed', () => {
  const loads = new Map([
    ['L1', { snapshot: { facility: { name: 'City WWTP', permitNo: 'WQ001' } } }],
    ['L2', { snapshot: { facility: { name: 'Acme Septage', permitNo: '' } } }],
  ]);
  const snap = (city, county) => ({ customer: { city }, tank: { county } });
  const jobs = [
    { date: '2026-01-10', gallons: '1000', wasteType: 'DS', loadId: 'L1', snapshot: snap('Round Rock', 'Williamson') },
    { date: '2026-01-22', gallons: '1,250', wasteType: 'DS', loadId: 'L1', snapshot: snap('Hutto', 'Williamson') },
    { date: '2026-02-03', gallons: '800', wasteType: 'GS', loadId: 'L2', snapshot: snap('Round Rock', 'Williamson') },
    { date: '2026-03-01', gallons: '900', wasteType: 'DS', snapshot: snap('Round Rock', 'Williamson') }, // still on the truck
    { date: '2025-12-31', gallons: '5000', wasteType: 'DS', loadId: 'L1', snapshot: snap('X', 'Y') }, // outside range
    { date: '2026-04-01', gallons: 'unknown', wasteType: 'DS', loadId: 'L1', snapshot: snap('Hutto', 'Williamson') },
  ];
  const s = summarise(jobs, loads, '2026-01-01', '2026-12-31');
  assert.equal(s.jobs, 5);
  assert.equal(s.total, 3950);
  assert.equal(s.undisposed, 900);
  assert.equal(s.undisposedJobs, 1);
  const fw = Object.fromEntries(s.byFacilityWaste.map((r) => [`${r.facility}|${r.wasteType}`, r.gallons]));
  assert.deepEqual(fw, { 'Acme Septage|GS': 800, 'City WWTP|DS': 2250, 'Not yet disposed of|DS': 900 });
  const ft = Object.fromEntries(s.byFacilityTown.map((r) => [`${r.facility}|${r.town}`, r.gallons]));
  assert.equal(ft['City WWTP|Round Rock'], 1000);
  assert.equal(ft['City WWTP|Hutto'], 1250);
  const fm = Object.fromEntries(s.byFacilityMonth.map((r) => [`${r.facility}|${r.month}`, r.gallons]));
  assert.equal(fm['City WWTP|2026-01'], 2250);
  assert.equal(s.byFacilityWaste.reduce((n, r) => n + r.gallons, 0), s.total);
  // Texas-style year
  assert.equal(summarise(jobs, loads, '2025-06-01', '2026-05-31').total, 8950);
});

test('copies owed count down from the pump-out date and stop once sent', () => {
  const job = { date: '2026-09-26' };
  assert.deepEqual(copiesOwed(job, {}, today), []);
  const owed = copiesOwed(job, { customerDays: 30, authorityDays: 14 }, today);
  assert.deepEqual(owed, [{ who: 'customer', days: 20 }, { who: 'authority', days: 4 }]);
  assert.equal(copiesOwed({ date: '2026-09-01' }, { authorityDays: 14 }, today)[0].days, -21);
  assert.deepEqual(copiesOwed({ ...job, customerCopyOn: '2026-09-27', authorityCopyOn: '2026-09-27' }, { customerDays: 30, authorityDays: 14 }, today), []);
});

test('holding tanks and portable toilets have no default interval', () => {
  assert.equal(intervalFor({ kind: 'Holding tank' }), null);
  assert.equal(intervalFor({ kind: 'Holding tank', intervalMonths: '2' }), 2);
  const s = standing({ kind: 'Holding tank' }, [{ date: '2026-09-01' }], null, today);
  assert.equal(s.status, 'unknown');
  assert.equal(s.needsInterval, true);
  assert.equal(dueLabel(s), 'No schedule set for this tank');
  assert.equal(standing({ kind: 'Holding tank', intervalMonths: 1 }, [{ date: '2026-09-01' }], null, today).status, 'overdue');
});

test('a tank with its own service address never borrows the customer town', () => {
  const landlord = { address: '1 Congress Ave', city: 'Austin', state: 'TX', zip: '78701', county: 'Travis' };
  const rental = { serviceAddress: '450 Ranch Rd', serviceCity: 'Dripping Springs', serviceState: 'TX', serviceZip: '78620', county: 'Hays' };
  assert.deepEqual(siteOf(landlord, rental), { street: '450 Ranch Rd', city: 'Dripping Springs', state: 'TX', zip: '78620', county: 'Hays' });
  assert.equal(siteLine(landlord, { serviceAddress: '450 Ranch Rd' }), '450 Ranch Rd');
  assert.equal(siteLine(landlord, {}, { zip: true }), '1 Congress Ave, Austin, TX, 78701');
  assert.equal(siteOf(landlord, { county: 'Hays' }).county, 'Hays');
  const jobs = [{ date: '2026-02-01', gallons: '1000', wasteType: 'DS', loadId: 'L', snapshot: { customer: landlord, tank: rental } }];
  const s = summarise(jobs, new Map([['L', { snapshot: { facility: { name: 'Plant' } } }]]), '2026-01-01', '2026-12-31');
  assert.equal(s.byFacilityTown[0].town, 'Dripping Springs');
  assert.equal(s.byFacilityTown[0].county, 'Hays');
});

test('summary totals are rounded, not raw floating point', () => {
  const jobs = [0.1, 0.2].map((g, i) => ({ date: '2026-02-01', gallons: String(g), wasteType: 'DS', snapshot: {}, id: 'j' + i }));
  const s = summarise(jobs, new Map(), '2026-01-01', '2026-12-31');
  assert.equal(s.total, 0.3);
  assert.equal(s.byFacilityWaste[0].gallons, 0.3);
});
