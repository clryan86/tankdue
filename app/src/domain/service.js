// Pump-out scheduling, truck loads and period summaries for a septic pumper.
import { isISODate, daysBetween, todayISO } from './due.js';

export const WASTE_TYPES = [
  { code: 'DS', name: 'Domestic septage (septic tank)' },
  { code: 'HT', name: 'Holding tank waste' },
  { code: 'GS', name: 'Grease trap waste' },
  { code: 'GT', name: 'Grit trap waste' },
  { code: 'PP', name: 'Portable or chemical toilet waste' },
  { code: 'OT', name: 'Other' },
];

export const TANK_KINDS = [
  { name: 'Septic tank', waste: 'DS' },
  { name: 'Holding tank', waste: 'HT' },
  { name: 'Cesspool', waste: 'DS' },
  { name: 'Aerobic treatment unit', waste: 'DS' },
  { name: 'Pump chamber', waste: 'DS' },
  { name: 'Grease trap', waste: 'GS' },
  { name: 'Grit trap', waste: 'GT' },
  { name: 'Portable toilet', waste: 'PP' },
  { name: 'Other', waste: 'OT' },
];

export const wasteName = (code) => (WASTE_TYPES.find((w) => w.code === code) || { name: code || '' }).name;
export const wasteForKind = (kind) => (TANK_KINDS.find((k) => k.name === kind) || { waste: 'DS' }).waste;

export const DEFAULTS = Object.freeze({
  intervalMonths: 36, // household septic tanks: EPA says typically every three to five years
  capMonths: 36, // never suggest longer than this; several states expect a look every three years
  greaseMonths: 3,
  customerDays: 0, // days allowed to get the customer their copy; 0 = not tracked
  authorityDays: 0, // days allowed to send a copy to the local authority; 0 = not tracked
});

export function mergeDefaults(saved) {
  const out = { ...DEFAULTS, ...(saved || {}) };
  for (const k of Object.keys(DEFAULTS)) {
    const n = Math.round(Number(out[k]));
    out[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULTS[k];
  }
  if (out.intervalMonths < 1) out.intervalMonths = DEFAULTS.intervalMonths;
  if (out.capMonths < 1) out.capMonths = DEFAULTS.capMonths;
  if (out.greaseMonths < 1) out.greaseMonths = DEFAULTS.greaseMonths;
  return out;
}

// Estimated pumping frequency in years for year-round homes, by tank size and
// number of people. Source: K. Mancl's table as published in Oregon State
// University Extension EC 1343, "Septic tank maintenance", Table 1. The
// 2,500-gallon row is left out because two of its cells could not be confirmed.
const MANCL = {
  500: [5.8, 2.6, 1.5, 1.0, 0.7, 0.4, 0.3, 0.2, 0.1, null],
  750: [9.1, 4.2, 2.6, 1.8, 1.3, 1.0, 0.7, 0.6, 0.4, 0.3],
  1000: [12.4, 5.9, 3.7, 2.6, 2.0, 1.5, 1.2, 1.0, 0.8, 0.7],
  1250: [15.6, 7.5, 4.8, 3.4, 2.6, 2.0, 1.7, 1.4, 1.2, 1.0],
  1500: [18.9, 9.1, 5.9, 4.2, 3.3, 2.6, 2.1, 1.8, 1.5, 1.3],
  1750: [22.1, 10.7, 6.9, 5.0, 3.9, 3.1, 2.6, 2.2, 1.9, 1.6],
  2000: [25.4, 12.4, 8.0, 5.9, 4.5, 3.7, 3.1, 2.6, 2.2, 2.0],
  2250: [28.6, 14.0, 9.1, 6.7, 5.2, 4.2, 3.5, 3.0, 2.6, 2.3],
};
const MANCL_SIZES = Object.keys(MANCL).map(Number).sort((a, b) => a - b);

/**
 * A suggested interval in months for a household septic tank, or null when
 * there is not enough to go on. Uses the next smaller tank size in the table
 * (the cautious direction), never suggests longer than capMonths, and never
 * shorter than 3 months. It is a starting point; the pumper sets the interval.
 */
export function suggestIntervalMonths({ capacity, people, capMonths = DEFAULTS.capMonths }) {
  const gal = Number(capacity);
  const n = Math.round(Number(people));
  if (!Number.isFinite(gal) || !Number.isFinite(n) || gal < MANCL_SIZES[0] || n < 1) return null;
  let size = MANCL_SIZES[0];
  for (const s of MANCL_SIZES) if (s <= gal) size = s;
  const years = MANCL[size][Math.min(n, 10) - 1];
  if (years === null || years === undefined) return 3;
  const months = Math.round(years * 12);
  return Math.max(3, Math.min(months, Math.max(1, Math.round(Number(capMonths)) || DEFAULTS.capMonths)));
}

/** Add calendar months to an ISO date (YYYY-MM-DD), clamping to the month's last day. */
export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// Tanks with no sensible default: how often they fill depends entirely on use.
const NO_DEFAULT = ['Holding tank', 'Portable toilet'];

/**
 * The interval that applies to a tank, in months: its own, else the default
 * for its kind. Returns null for kinds that have no default until one is set.
 */
export function intervalFor(tank, defaultsIn) {
  const d = mergeDefaults(defaultsIn);
  const own = Math.round(Number(tank.intervalMonths));
  if (Number.isFinite(own) && own > 0) return own;
  if (NO_DEFAULT.includes(tank.kind)) return null;
  return tank.kind === 'Grease trap' || tank.kind === 'Grit trap' ? d.greaseMonths : d.intervalMonths;
}

/**
 * Where a tank is: its own service address when it has one, otherwise the
 * customer's. The two are never mixed, so a tank in one town is never printed
 * with the billing address's town.
 */
export function siteOf(customer, tank) {
  const c = customer || {};
  const t = tank || {};
  if (t.serviceAddress) {
    return { street: t.serviceAddress, city: t.serviceCity || '', state: t.serviceState || '', zip: t.serviceZip || '', county: t.county || '' };
  }
  return { street: c.address || '', city: c.city || '', state: c.state || '', zip: c.zip || '', county: t.county || c.county || '' };
}

export function siteLine(customer, tank, { zip = false } = {}) {
  const s = siteOf(customer, tank);
  return [s.street, s.city, s.state, zip ? s.zip : ''].filter(Boolean).join(', ');
}

/**
 * When a tank is next due and how urgent that is.
 * status: 'overdue' | 'soon' (<=30 days) | 'upcoming' (<=60) | 'ok' | 'unknown' | 'oncall'
 */
export function standing(tank, jobs, defaultsIn, today = todayISO()) {
  if (tank.onCall) return { status: 'oncall', due: null, lastDate: lastDate(tank, jobs), days: null };
  const last = lastDate(tank, jobs);
  if (!last) return { status: 'unknown', due: null, lastDate: null, days: null };
  const interval = intervalFor(tank, defaultsIn);
  if (interval === null) return { status: 'unknown', due: null, lastDate: last, days: null, needsInterval: true };
  const due = addMonthsISO(last, interval);
  const days = daysBetween(today, due);
  const status = days < 0 ? 'overdue' : days <= 30 ? 'soon' : days <= 60 ? 'upcoming' : 'ok';
  return { status, due, lastDate: last, days };
}

function lastDate(tank, jobs) {
  let last = isISODate(tank.lastPumpedImported) ? tank.lastPumpedImported : null;
  for (const j of jobs || []) if (isISODate(j.date) && (!last || j.date > last)) last = j.date;
  return last;
}

const ORDER = { overdue: 0, soon: 1, upcoming: 2, unknown: 3, ok: 4, oncall: 5 };
export function compareStanding(a, b) {
  const o = ORDER[a.status] - ORDER[b.status];
  if (o !== 0) return o;
  if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  return 0;
}

export function dueLabel(s) {
  switch (s.status) {
    case 'unknown': return s.needsInterval ? 'No schedule set for this tank' : 'No pump-out on record';
    case 'oncall': return 'On call, no schedule';
    case 'overdue': return s.days === -1 ? '1 day overdue' : `${-s.days} days overdue`;
    default:
      if (s.days === 0) return 'Due today';
      if (s.days === 1) return 'Due tomorrow';
      return `Due in ${s.days} days`;
  }
}

/** Parse gallons typed by a driver: "1,000", "1000", "1000.5". Returns a number or null. */
export function gallons(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v ?? '').trim().replace(/\s*gal(lons)?\.?$/i, '');
  if (s === '') return null;
  if (/^\d{1,3}\.\d{3}$/.test(s)) return null; // "1.000" could mean one or one thousand: ask again
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s;
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) && n <= MAX_GALLONS ? n : null;
}

// No road tanker carries this much; anything larger is a typing slip.
export const MAX_GALLONS = 50000;

export function formatGallons(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  const v = Math.round(Number(n) * 10) / 10;
  const [whole, frac] = String(v).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
}

/** Money typed by a user: "350", "$350.00", "1,250.50". Returns a number of dollars or null. */
export function money(v) {
  const s = String(v ?? '').trim().replace(/^\$/, '');
  if (s === '') return null;
  const plain = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s) ? s.replace(/,/g, '') : s;
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  return Number(plain);
}

/**
 * What is on a truck now: jobs picked up and not yet discharged.
 * Warns when the total passes the tank's capacity or when waste types are mixed.
 */
export function truckLoad(truck, jobs) {
  const open = (jobs || []).filter((j) => j.truckId === truck.id && !j.loadId);
  const total = open.reduce((sum, j) => sum + (gallons(j.gallons) || 0), 0);
  const capacity = gallons(truck.capacity);
  const types = [...new Set(open.map((j) => j.wasteType).filter(Boolean))];
  const warnings = [];
  if (capacity && total > capacity) warnings.push(`${formatGallons(total)} gallons is more than this truck holds (${formatGallons(capacity)}). Check the gallons on each job.`);
  if (types.length > 1) warnings.push(`This load mixes waste types (${types.map(wasteName).join('; ')}). Some states and receiving facilities do not allow that, or treat the whole load as the stricter type.`);
  return { open, total, capacity, percent: capacity ? Math.min(100, Math.round((total / capacity) * 100)) : null, types, warnings };
}

/** Reporting periods. 'june' is the 1 June to 31 May year Texas uses, named by the year it ends in. */
export function period(kind, year) {
  const y = Number(year);
  if (kind === 'june') return { from: `${y - 1}-06-01`, to: `${y}-05-31`, label: `1 June ${y - 1} to 31 May ${y}` };
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Calendar year ${y}` };
}

/**
 * Totals of gallons for jobs in a date range, grouped three ways. A job counts
 * by its pump-out date. Jobs not yet discharged are counted separately so a
 * report never shows waste as disposed of when it was not.
 * @param loads map-like lookup: loadId -> load record
 */
export function summarise(jobs, loadsById, from, to) {
  const inRange = (jobs || []).filter((j) => isISODate(j.date) && j.date >= from && j.date <= to);
  const rows = new Map();
  let total = 0;
  let undisposed = 0;
  let undisposedJobs = 0;
  for (const j of inRange) {
    const g = gallons(j.gallons) || 0;
    total += g;
    const load = j.loadId ? loadsById.get(j.loadId) : null;
    if (!load) { undisposed += g; undisposedJobs++; }
    const facility = load ? (load.snapshot?.facility?.name || 'Unnamed facility') : 'Not yet disposed of';
    const permit = load ? (load.snapshot?.facility?.permitNo || '') : '';
    const site = siteOf(j.snapshot?.customer, j.snapshot?.tank);
    const town = site.city;
    const county = site.county;
    const key = [facility, permit, j.wasteType || '', town, county, j.date.slice(0, 7)].join('\u0001');
    const r = rows.get(key) || { facility, permit, wasteType: j.wasteType || '', town, county, month: j.date.slice(0, 7), gallons: 0, jobs: 0 };
    r.gallons += g; r.jobs += 1;
    rows.set(key, r);
  }
  const group = (fields) => {
    const m = new Map();
    for (const r of rows.values()) {
      const k = fields.map((f) => r[f]).join('\u0001');
      const g = m.get(k) || Object.fromEntries([...fields.map((f) => [f, r[f]]), ['gallons', 0], ['jobs', 0]]);
      g.gallons += r.gallons; g.jobs += r.jobs;
      m.set(k, g);
    }
    for (const g of m.values()) g.gallons = round1(g.gallons);
    return [...m.values()].sort((a, b) => fields.map((f) => String(a[f]).localeCompare(String(b[f]))).find((x) => x !== 0) || 0);
  };
  return {
    jobs: inRange.length, total: round1(total), undisposed: round1(undisposed), undisposedJobs,
    byFacilityWaste: group(['facility', 'permit', 'wasteType']),
    byFacilityTown: group(['facility', 'town', 'county']),
    byFacilityMonth: group(['facility', 'month']),
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Copies still owed for a job, with days left. Negative days means late. */
export function copiesOwed(job, defaultsIn, today = todayISO()) {
  const d = mergeDefaults(defaultsIn);
  const out = [];
  if (!isISODate(job.date)) return out;
  if (d.customerDays > 0 && !job.customerCopyOn) out.push({ who: 'customer', days: d.customerDays - daysBetween(job.date, today) });
  if (d.authorityDays > 0 && !job.authorityCopyOn) out.push({ who: 'authority', days: d.authorityDays - daysBetween(job.date, today) });
  return out;
}
