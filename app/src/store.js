// Local storage of the shop's records in IndexedDB. Everything stays on the
// device; nothing is sent anywhere. The whole data set is held in memory
// (it is small) and each change is written through.
import { DEFAULTS, mergeDefaults } from './domain/service.js';
import { DEFAULT_REMINDER } from './domain/due.js';

const DB_NAME = 'tankdue';
const DB_VERSION = 1;
export const COLLECTIONS = ['customers', 'tanks', 'jobs', 'loads', 'trucks', 'drivers', 'facilities'];

export const state = {
  customers: [], tanks: [], jobs: [], loads: [], trucks: [], drivers: [], facilities: [],
  settings: defaultSettings(),
  license: null, // result of verifyLicense, set at boot
};

export function defaultSettings() {
  return {
    company: { name: '', address: '', cityStateZip: '', phone: '', email: '', registration: '' },
    defaults: { ...DEFAULTS },
    reminder: { ...DEFAULT_REMINDER },
    licenseKey: '',
    lastDriverId: '',
    lastTruckId: '',
    lastFacilityId: '',
    summaryYear: 'calendar',
    lastBackup: '',
  };
}

let db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    result = fn(t);
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function load() {
  db = await open();
  for (const c of COLLECTIONS) state[c] = await getAll(c);
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction('meta').objectStore('meta').get('settings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  state.settings = mergeSettings(saved);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function mergeSettings(saved) {
  const d = defaultSettings();
  if (!saved) return d;
  return {
    ...d, ...saved,
    company: { ...d.company, ...(saved.company || {}) },
    defaults: mergeDefaults(saved.defaults),
    reminder: { ...d.reminder, ...(saved.reminder || {}) },
  };
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function put(collection, record) {
  if (!record.id) record.id = newId();
  record.updatedAt = Date.now();
  await tx([collection], 'readwrite', (t) => { t.objectStore(collection).put(record); });
  const list = state[collection];
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  return record;
}

export async function putMany(collection, records) {
  await tx([collection], 'readwrite', (t) => {
    const s = t.objectStore(collection);
    for (const r of records) { if (!r.id) r.id = newId(); r.updatedAt = Date.now(); s.put(r); }
  });
  for (const r of records) {
    const i = state[collection].findIndex((x) => x.id === r.id);
    if (i >= 0) state[collection][i] = r; else state[collection].push(r);
  }
}

export async function remove(collection, id) {
  await tx([collection], 'readwrite', (t) => { t.objectStore(collection).delete(id); });
  state[collection] = state[collection].filter((r) => r.id !== id);
}

/**
 * Save settings. Pass the top-level keys that changed, e.g. saveSettings('company').
 * Only those keys are written over what is stored, so a second open tab or
 * window cannot wipe out the licence key or anything else it did not change.
 * With no keys, the whole settings object is written.
 */
export function saveSettings(...keys) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['meta'], 'readwrite');
    const store = t.objectStore('meta');
    let merged = state.settings;
    if (keys.length) {
      const req = store.get('settings');
      req.onsuccess = () => {
        merged = mergeSettings(req.result);
        for (const k of keys) merged[k] = state.settings[k];
        store.put(merged, 'settings');
      };
    } else {
      store.put(state.settings, 'settings');
    }
    t.oncomplete = () => { state.settings = merged; resolve(); };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

/** Re-read everything from storage in one transaction, to pick up changes made in another tab or window. */
export function reload() {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = db.transaction([...COLLECTIONS, 'meta']);
    const fresh = {};
    let savedSettings;
    for (const c of COLLECTIONS) {
      const req = t.objectStore(c).getAll();
      req.onsuccess = () => { fresh[c] = req.result; };
    }
    const sreq = t.objectStore('meta').get('settings');
    sreq.onsuccess = () => { savedSettings = sreq.result; };
    t.oncomplete = () => {
      for (const c of COLLECTIONS) state[c] = fresh[c] || [];
      state.settings = mergeSettings(savedSettings);
      resolve();
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

/** Write records to several collections in one transaction: all of it is saved, or none of it. */
export async function putAcross(batches) {
  const names = Object.keys(batches).filter((c) => batches[c].length);
  if (!names.length) return;
  await tx(names, 'readwrite', (t) => {
    for (const c of names) {
      const s = t.objectStore(c);
      for (const r of batches[c]) { if (!r.id) r.id = newId(); r.updatedAt = Date.now(); s.put(r); }
    }
  });
  for (const c of names) for (const r of batches[c]) {
    const i = state[c].findIndex((x) => x.id === r.id);
    if (i >= 0) state[c][i] = r; else state[c].push(r);
  }
}

/**
 * Record a disposal: save the load and stamp each job with it, in one
 * transaction. Each job is re-read from storage inside the transaction, so a
 * job already on another load (a second tap, or another tab) stops the whole
 * thing and nothing is written.
 */
export function commitDisposal(load, jobIds) {
  if (!load.id) load.id = newId();
  load.updatedAt = Date.now();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['loads', 'jobs'], 'readwrite');
    const jobs = t.objectStore('jobs');
    const written = [];
    let problem = null;
    t.objectStore('loads').put(load);
    for (const id of jobIds) {
      const req = jobs.get(id);
      req.onsuccess = () => {
        const job = req.result;
        if (!job) { problem = new Error('A pickup on this load no longer exists. Go back to the truck and try again.'); t.abort(); return; }
        if (job.loadId) { problem = new Error('A pickup on this load has already been recorded as disposed of. Go back to the truck to see what is still on board.'); t.abort(); return; }
        job.loadId = load.id; job.updatedAt = Date.now();
        jobs.put(job);
        written.push(job);
      };
    }
    t.oncomplete = () => {
      state.loads = state.loads.filter((l) => l.id !== load.id).concat([load]);
      for (const job of written) { const i = state.jobs.findIndex((x) => x.id === job.id); if (i >= 0) state.jobs[i] = job; else state.jobs.push(job); }
      resolve(load);
    };
    t.onerror = () => reject(problem || t.error);
    t.onabort = () => reject(problem || t.error || new Error('Storage transaction aborted'));
  });
}

/** Undo a disposal: put its jobs back on the truck and delete the load, in one transaction. */
export function undoDisposal(loadId) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['loads', 'jobs'], 'readwrite');
    const jobs = t.objectStore('jobs');
    const freed = [];
    const all = jobs.getAll();
    all.onsuccess = () => {
      for (const job of all.result) {
        if (job.loadId !== loadId) continue;
        job.loadId = null; job.updatedAt = Date.now();
        jobs.put(job);
        freed.push(job);
      }
      t.objectStore('loads').delete(loadId);
    };
    t.oncomplete = () => {
      state.loads = state.loads.filter((l) => l.id !== loadId);
      for (const job of freed) { const i = state.jobs.findIndex((x) => x.id === job.id); if (i >= 0) state.jobs[i] = job; }
      resolve(freed.length);
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

/** Unsaved form drafts live in localStorage. Remove them all. */
export function clearDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tankdue-draft-')) localStorage.removeItem(k);
    }
  } catch { /* storage blocked: nothing to clear */ }
}

export const byId = (collection, id) => state[collection].find((r) => r.id === id) || null;

export function exportAll() {
  const out = { app: 'TankDue', format: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const c of COLLECTIONS) out[c] = state[c];
  return out;
}

/** Replace everything on this device with the contents of a backup. Validates first. */
export async function importAll(data, licenseKey) {
  if (!data || data.app !== 'TankDue' || data.format !== 1) throw new Error('This file is not a TankDue backup');
  for (const c of COLLECTIONS) {
    if (!Array.isArray(data[c])) throw new Error(`The backup is missing its ${c} list`);
    if (data[c].some((r) => !r || typeof r.id !== 'string')) throw new Error(`The backup has a damaged record in ${c}`);
  }
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (data.jobs.some((j) => !isDate(j.date) || typeof j.tankId !== 'string')) {
    throw new Error('The backup has a damaged job record. Nothing was changed.');
  }
  if (data.tanks.some((t) => typeof t.customerId !== 'string')) {
    throw new Error('The backup has a damaged tank record. Nothing was changed.');
  }
  if (data.loads.some((l) => !isDate(l.date))) {
    throw new Error('The backup has a damaged disposal record. Nothing was changed.');
  }
  // Keep the licence already on this device: restoring an older backup must not lock a paying shop out.
  const restored = mergeSettings(data.settings);
  restored.licenseKey = licenseKey !== undefined ? licenseKey : (state.settings.licenseKey || restored.licenseKey);
  await tx([...COLLECTIONS, 'meta'], 'readwrite', (t) => {
    for (const c of COLLECTIONS) {
      const s = t.objectStore(c);
      s.clear();
      for (const r of data[c]) s.put(r);
    }
    t.objectStore('meta').put(restored, 'settings');
  });
  for (const c of COLLECTIONS) state[c] = data[c];
  state.settings = restored;
  clearDrafts();
}

export async function clearAll() {
  await tx([...COLLECTIONS, 'meta'], 'readwrite', (t) => {
    for (const c of COLLECTIONS) t.objectStore(c).clear();
    t.objectStore('meta').clear();
  });
  for (const c of COLLECTIONS) state[c] = [];
  state.settings = defaultSettings();
  clearDrafts();
}
