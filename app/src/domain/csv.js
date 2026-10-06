// CSV reading and writing (RFC 4180), plus the customer/tank import mapping.

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true; // a quote only opens a field at its start, so 2" stays a size
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export function toCSV(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection in exported data.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const ALIASES = {
  customer: ['customer', 'customer name', 'name', 'account name', 'owner', 'owner name', 'business', 'business name'],
  contact: ['contact', 'contact name', 'contact person', 'attention'],
  email: ['email', 'e-mail', 'customer email', 'contact email'],
  phone: ['phone', 'telephone', 'customer phone', 'contact phone', 'phone number', 'cell'],
  address: ['address', 'service address', 'street', 'street address', 'site address', 'property address', 'system location'],
  city: ['city', 'town', 'city/town', 'municipality'],
  state: ['state', 'st'],
  zip: ['zip', 'zip code', 'postal code', 'zipcode'],
  county: ['county', 'township'],
  kind: ['type', 'tank type', 'system type', 'component', 'system'],
  capacity: ['size', 'tank size', 'capacity', 'gallons', 'tank capacity', 'tank gallons', 'volume'],
  people: ['people', 'occupants', 'household size', 'residents', 'household'],
  location: ['location', 'tank location', 'lid location', 'access', 'access notes', 'directions'],
  interval: ['interval', 'interval months', 'pump every', 'frequency', 'frequency months', 'schedule months'],
  lastPumped: ['last pumped', 'last pump', 'last pump date', 'last service', 'last service date', 'last pumped date', 'date pumped', 'pump date'],
  notes: ['notes', 'comments', 'remarks'],
  inService: ['in service', 'active', 'status'],
  tankAddress: ['tank address', 'tank street'],
  tankCity: ['tank city', 'tank town'],
  material: ['material', 'tank material'],
  compartments: ['compartments'],
  onCall: ['on call', 'on call only'],
};

const KIND_MAP = [
  [/grease/i, 'Grease trap'],
  [/grit|sand trap|interceptor/i, 'Grit trap'],
  [/holding|tight tank|vault/i, 'Holding tank'],
  [/cess/i, 'Cesspool'],
  [/aerob|atu|aerat/i, 'Aerobic treatment unit'],
  [/pump (chamber|tank)|dos(e|ing)|lift/i, 'Pump chamber'],
  [/porta|chemical toilet/i, 'Portable toilet'],
  [/septic|^tank$/i, 'Septic tank'],
];

export function normaliseKind(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  for (const [re, kind] of KIND_MAP) if (re.test(s)) return kind;
  return '';
}

/** Accepts YYYY-MM-DD, M/D/YYYY, M/D/YY and M-D-YYYY, each optionally followed by a time. Returns ISO or ''. */
export function normaliseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:\s+\d.*)?$/);
    if (!m) return '';
    mo = +m[1]; d = +m[2]; y = +m[3];
    // Two-digit years are read as 20xx. One that lands in the future is then caught as a mistake
    // by the caller, instead of quietly becoming a date a century ago.
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const key = String(h).trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.includes(key)) map[field] = idx;
    }
  });
  return map;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Turn a spreadsheet (one row per tank) into customers and tanks.
 * Rows sharing a customer name and address become one customer. Customers
 * already on file (same name and address) are reused, and a tank is left out
 * when that customer already has one of the same type and size.
 * @returns {{customers, tanks, skipped: Array<{row:number, reason:string}>, unmapped: string[], rowsRead: number}}
 *   `skipped` holds every row that was left out or needs checking.
 */
export function importRows(rows, makeId, existing = { customers: [], tanks: [] }, today = localToday()) {
  if (!rows.length) return { customers: [], tanks: [], skipped: [], unmapped: [], rowsRead: 0 };
  const map = mapHeaders(rows[0]);
  const mappedIdx = new Set(Object.values(map));
  const unmapped = rows[0].filter((_, i) => !mappedIdx.has(i)).map((h) => String(h).trim()).filter(Boolean);
  // Spreadsheets (and our own export) put an apostrophe before values that look like formulas.
  const get = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim().replace(/^'(?=[=+\-@])/, ''));
  const customers = [];
  const tanks = [];
  const skipped = [];
  const rowsRead = rows.length - 1;
  if (map.customer === undefined) {
    return { customers, tanks, skipped: [{ row: 1, reason: 'No "Customer" or "Name" column found' }], unmapped, rowsRead };
  }
  const keyOf = (name, address) => (name + '|' + address).toLowerCase().replace(/\s+/g, ' ');
  const byKey = new Map();
  for (const c of existing.customers || []) byKey.set(keyOf(c.name || '', c.address || ''), c);
  const tankKey = (customerId, kind, capacity) => [customerId, kind, String(capacity || '').replace(/[^0-9.]/g, '')].join('|');
  const known = new Set((existing.tanks || []).map((t) => tankKey(t.customerId, t.kind, t.capacity)));

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = get(r, 'customer');
    if (!name) { skipped.push({ row: i + 1, reason: 'No customer name, row left out' }); continue; }
    const address = get(r, 'address');
    const key = keyOf(name, address);
    let c = byKey.get(key);
    if (!c) {
      let email = get(r, 'email');
      if (email && !/^[^\s@?&,;]+@[^\s@?&,;]+\.[^\s@?&,;]+$/.test(email)) {
        skipped.push({ row: i + 1, reason: `Email "${email}" does not look right and was left blank.` });
        email = '';
      }
      c = {
        id: makeId(), name, contact: get(r, 'contact'), email, phone: get(r, 'phone'),
        address, city: get(r, 'city'), state: get(r, 'state'), zip: get(r, 'zip'), county: get(r, 'county'), notes: get(r, 'notes'),
      };
      byKey.set(key, c);
      customers.push(c);
    }
    const rawKind = get(r, 'kind');
    const kind = normaliseKind(rawKind);
    if (rawKind && !kind) skipped.push({ row: i + 1, reason: `Tank type "${rawKind}" was not recognised and was saved as a septic tank. Check it.` });

    let capacity = '';
    const rawCap = get(r, 'capacity');
    if (rawCap) {
      const digits = rawCap.replace(/,/g, '').replace(/\s*gal(lons)?\.?$/i, '');
      if (/^\d+(\.\d+)?$/.test(digits) && Number(digits) > 0 && Number(digits) <= 100000) capacity = String(Number(digits));
      else skipped.push({ row: i + 1, reason: `Tank size "${rawCap}" was not understood and was left blank.` });
    }
    let people = '';
    const rawPeople = get(r, 'people');
    if (rawPeople) {
      if (/^\d{1,2}$/.test(rawPeople) && Number(rawPeople) > 0) people = String(Number(rawPeople));
      else skipped.push({ row: i + 1, reason: `Household size "${rawPeople}" was not understood and was left blank.` });
    }
    let intervalMonths = '';
    const rawInt = get(r, 'interval');
    if (rawInt) {
      const m = /^(\d{1,3})(\s*(months?|mo))?$/i.exec(rawInt);
      const y = /^(\d{1,2})\s*(years?|yrs?|y)$/i.exec(rawInt);
      if (m && Number(m[1]) > 0 && Number(m[1]) <= 240) intervalMonths = String(Number(m[1]));
      else if (y && Number(y[1]) > 0 && Number(y[1]) <= 20) intervalMonths = String(Number(y[1]) * 12);
      else skipped.push({ row: i + 1, reason: `Interval "${rawInt}" was not understood and was left blank. Use months, such as 36.` });
    }
    let lastPumped = '';
    const rawLast = get(r, 'lastPumped');
    if (rawLast) {
      const iso = normaliseDate(rawLast);
      if (!iso) skipped.push({ row: i + 1, reason: `Last pumped date "${rawLast}" was not understood and was left blank. Use a form like 10/20/2023.` });
      else if (iso > today) skipped.push({ row: i + 1, reason: `Last pumped date "${rawLast}" is in the future and was left blank.` });
      else lastPumped = iso;
    }
    const finalKind = kind || 'Septic tank';
    if (known.has(tankKey(c.id, finalKind, capacity))) {
      skipped.push({ row: i + 1, reason: `${name} already has a ${finalKind.toLowerCase()}${capacity ? ' of ' + capacity + ' gallons' : ''} on file, row left out` });
      continue;
    }
    known.add(tankKey(c.id, finalKind, capacity));
    const inService = get(r, 'inService').toLowerCase();
    tanks.push({
      id: makeId(), customerId: c.id, kind: finalKind, capacity, people, material: get(r, 'material'), compartments: get(r, 'compartments'),
      location: get(r, 'location'), serviceAddress: get(r, 'tankAddress'), serviceCity: get(r, 'tankCity'), serviceState: '', serviceZip: '', county: get(r, 'county'),
      intervalMonths, lastPumpedImported: lastPumped, garbageDisposal: false, onCall: ['yes', 'y', 'true'].includes(get(r, 'onCall').toLowerCase()),
      active: !['no', 'n', 'false', 'removed', 'inactive'].includes(inService),
    });
  }
  return { customers, tanks, skipped, unmapped, rowsRead };
}
