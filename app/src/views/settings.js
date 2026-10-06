import { h, setChildren, field, toast, confirmDialog, download } from '../dom.js';
import { state, put, remove, putAcross, saveSettings, exportAll, importAll, clearAll, newId } from '../store.js';
import { DEFAULTS, formatGallons, gallons } from '../domain/service.js';
import { DEFAULT_REMINDER, formatDate, todayISO, isISODate } from '../domain/due.js';
import { parseCSV, toCSV, importRows } from '../domain/csv.js';
import { verifyLicense, TRIAL_JOBS } from '../domain/license.js';
import { navigate, rerender, currentEntitlement, refreshLicense } from '../nav.js';
import { backLink } from './shared.js';
import { jobsCSV } from './jobs.js';
import { loadSampleData } from '../sample.js';
import { CONFIG } from '../config.js';

export function settingsView(section) {
  switch (section) {
    case 'company': return companyView();
    case 'drivers': return driversView();
    case 'trucks': return trucksView();
    case 'facilities': return facilitiesView();
    case 'defaults': return defaultsView();
    case 'reminder': return reminderView();
    case 'data': return dataView();
    case 'licence': return licenceView();
    case 'help': return helpView();
    default: return home();
  }
}

function home() {
  const e = currentEntitlement();
  const co = state.settings.company;
  const item = (href, title, sub) => h('li', null, h('a', { href }, h('span', { class: 'row-main' }, title), h('span', { class: 'row-sub' }, sub)));
  return h('section', null,
    h('h1', null, 'Settings'),
    h('ul', { class: 'rows' },
      item('#/settings/company', 'Company', co.name || 'Name, address and registration number printed on records'),
      item('#/settings/drivers', 'Drivers', state.drivers.length ? state.drivers.map((d) => d.name).join(', ') : 'Add a driver'),
      item('#/settings/trucks', 'Trucks', state.trucks.length ? state.trucks.map((t) => t.name).join(', ') : 'Add your truck and its tank size'),
      item('#/settings/facilities', 'Where you dispose', state.facilities.length ? state.facilities.map((f) => f.name).join(', ') : 'Add the plants or sites you dump at'),
      item('#/settings/defaults', 'Schedules and deadlines', 'Default pump-out intervals and copy deadlines'),
      item('#/settings/reminder', 'Reminder message', 'What customers get when a pump-out is coming due'),
      item('#/settings/data', 'Your data', state.settings.lastBackup ? `Last backup ${formatDate(state.settings.lastBackup)}` : 'Back up, restore, import and export'),
      item('#/settings/licence', 'Licence', e.mode === 'licensed' ? `Licensed until ${formatDate(e.until)}` : e.mode === 'trial' ? `Free trial, ${e.left} of ${TRIAL_JOBS} jobs left` : 'Enter a licence key'),
      item('#/settings/help', 'How TankDue works', 'A two-minute guide, and how to put it on your home screen')),
    h('p', { class: 'quiet' }, `TankDue ${CONFIG.version}. Your records are stored on this device only.`));
}

function saved(path = '/settings') { toast('Saved'); navigate(path); }

function companyView() {
  const co = { ...state.settings.company };
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Company'),
    h('p', { class: 'quiet' }, 'Printed at the top of every record, ticket and summary.'),
    h('form', { onSubmit: async (e) => { e.preventDefault(); state.settings.company = co; await saveSettings('company'); saved(); } },
      field('Company name', co, 'name', { autocomplete: 'organization' }),
      field('Street address', co, 'address', { optional: true }),
      field('City, state and ZIP', co, 'cityStateZip', { optional: true }),
      h('div', { class: 'grid2' },
        field('Phone', co, 'phone', { type: 'tel', optional: true }),
        field('Email', co, 'email', { type: 'email', optional: true })),
      field('Hauler registration, permit or licence number', co, 'registration', { optional: true, hint: 'The number your state or county issued for hauling septage.' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save company')));
}

function listEditor({ title, intro, collection, describe, blank, form, validate, addLabel, blockRemove, back = '#/settings' }) {
  let editing = null; // record being edited, or a blank for a new one
  const section = h('section');
  const draw = () => {
    setChildren(section, 
      backLink(back, 'Settings'), h('h1', null, title), h('p', { class: 'quiet' }, intro),
      state[collection].length ? h('ul', { class: 'rows' }, state[collection].map((r) => h('li', null, h('button', { class: 'rowbtn', onClick: () => { editing = { ...r }; draw(); } },
        h('span', { class: 'row-main' }, describe(r).main), h('span', { class: 'row-sub' }, describe(r).sub))))) : null,
      editing ? editor() : h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => { editing = blank(); draw(); } }, addLabel || 'Add ' + title.toLowerCase().replace(/s$/, ''))));
  };
  const editor = () => {
    const error = h('p', { class: 'form-error', role: 'alert' });
    const isNew = !editing.id;
    return h('form', {
      class: 'panel',
      onSubmit: async (e) => {
        e.preventDefault();
        const problem = validate(editing);
        if (problem) { error.textContent = problem; return; }
        await put(collection, editing);
        editing = null; toast('Saved'); draw();
      },
    },
    h('h2', null, isNew ? 'New' : 'Edit'),
    form(editing), error,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn ghost', type: 'button', onClick: () => { editing = null; draw(); } }, 'Cancel'),
      !isNew ? h('button', {
        class: 'btn danger ghost', type: 'button',
        onClick: async () => {
          const reason = blockRemove ? blockRemove(editing) : '';
          if (reason) { await confirmDialog({ title: 'This cannot be removed yet', body: reason, confirm: 'OK' }); return; }
          if (!(await confirmDialog({ title: 'Remove this?', body: 'Reports already saved keep their own copy of these details.', confirm: 'Remove', danger: true }))) return;
          await remove(collection, editing.id); editing = null; draw();
        },
      }, 'Remove') : null));
  };
  draw();
  return section;
}


function driversView() {
  return listEditor({
    title: 'Drivers', collection: 'drivers', addLabel: 'Add a driver',
    intro: 'Each record names the person who pumped, hauled and deposited the waste.',
    describe: (d) => ({ main: d.name, sub: d.licenceNo ? 'Licence ' + d.licenceNo : '' }),
    blank: () => ({ name: '', licenceNo: '' }),
    validate: (d) => (!d.name.trim() ? 'Enter the driver’s name.' : ''),
    form: (d) => [
      field('Name', d, 'name', { autocomplete: 'name' }),
      field('Operator licence or certification number', d, 'licenceNo', { optional: true }),
      d.signature ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onChange: (e) => { if (e.currentTarget.checked) d.signature = ''; } }), 'Forget the saved signature') : null,
    ],
  });
}

function trucksView() {
  return listEditor({
    title: 'Trucks', collection: 'trucks', addLabel: 'Add a truck',
    blockRemove: (t) => { const n = state.jobs.filter((j) => j.truckId === t.id && !j.loadId).length; return n ? `${n} ${n === 1 ? 'pickup is' : 'pickups are'} still on this truck. Record the disposal first, then remove the truck.` : ''; },
    intro: 'The tank size lets TankDue show how full each truck is and warn when the gallons do not add up.',
    describe: (t) => ({ main: t.name || 'Truck', sub: [t.plate ? 'plate ' + t.plate : '', gallons(t.capacity) ? formatGallons(gallons(t.capacity)) + ' gallons' : 'no tank size'].filter(Boolean).join(', ') }),
    blank: () => ({ name: '', plate: '', capacity: '' }),
    validate: (t) => {
      if (!t.name.trim()) return 'Give the truck a name or unit number.';
      if (t.capacity !== '' && (gallons(t.capacity) === null || gallons(t.capacity) <= 0)) return 'Enter the tank size in gallons, such as 2500.';
      if (t.capacity !== '') t.capacity = String(gallons(t.capacity));
      return '';
    },
    form: (t) => [
      h('div', { class: 'grid2' }, field('Name or unit number', t, 'name', { placeholder: 'Truck 1' }), field('Licence plate', t, 'plate', { optional: true })),
      field('Tank size (gallons)', t, 'capacity', { inputmode: 'numeric', optional: true, placeholder: '2500' }),
    ],
  });
}

function facilitiesView() {
  return listEditor({
    title: 'Receiving facilities', collection: 'facilities', addLabel: 'Add a receiving facility',
    intro: 'The treatment plants, septage facilities or approved sites where you deposit waste. Their permit numbers print on tickets and summaries.',
    describe: (f) => ({ main: f.name, sub: [f.method, f.permitNo ? 'permit ' + f.permitNo : ''].filter(Boolean).join(', ') }),
    blank: () => ({ name: '', address: '', permitNo: '', method: 'Wastewater treatment plant' }),
    validate: (f) => (!f.name.trim() ? 'Enter the facility’s name.' : ''),
    form: (f) => [
      field('Facility name', f, 'name'),
      field('Address or location', f, 'address', { optional: true }),
      h('div', { class: 'grid2' },
        field('Permit or registration number', f, 'permitNo', { optional: true }),
        field('Method', f, 'method', { options: ['Wastewater treatment plant', 'Septage receiving facility', 'Land application site', 'Landfill', 'Other'] })),
    ],
  });
}

function defaultsView() {
  const d = { ...state.settings.defaults };
  for (const k of Object.keys(d)) d[k] = String(d[k]);
  const error = h('p', { class: 'form-error', role: 'alert' });
  const whole = (v, min, max) => Number.isInteger(Number(v)) && String(v).trim() !== '' && Number(v) >= min && Number(v) <= max;
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Schedules and deadlines'),
    h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!whole(d.intervalMonths, 1, 240) || !whole(d.capMonths, 1, 240) || !whole(d.greaseMonths, 1, 240)) { error.textContent = 'Intervals must be whole numbers of months from 1 to 240.'; return; }
        if (!whole(d.customerDays, 0, 365) || !whole(d.authorityDays, 0, 365)) { error.textContent = 'Deadlines must be whole numbers of days from 0 to 365. Use 0 to turn one off.'; return; }
        state.settings.defaults = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, Number(d[k])]));
        await saveSettings('defaults'); saved();
      },
    },
    h('fieldset', null, h('legend', null, 'Pump-out intervals'),
      h('p', { class: 'hint' }, 'Used for any tank that has no interval of its own. The US EPA says household tanks are typically pumped every three to five years; several states expect a look at least every three.'),
      h('div', { class: 'grid2' },
        field('Septic and holding tanks: every (months)', d, 'intervalMonths', { inputmode: 'numeric' }),
        field('Grease and grit traps: every (months)', d, 'greaseMonths', { inputmode: 'numeric' })),
      field('Never suggest longer than (months)', d, 'capMonths', { inputmode: 'numeric', hint: 'Caps the interval TankDue suggests from tank size and household size.' })),
    h('fieldset', null, h('legend', null, 'Copy deadlines'),
      h('p', { class: 'hint' }, 'If your state or county sets a deadline for sending the pumping record, enter it and TankDue lists the records still to send. Examples: Massachusetts, 14 days to the board of health; Minnesota, 30 days to the homeowner; Texas, a completed ticket back to the customer within 15 days. Check your own rules. Use 0 to turn a deadline off.'),
      h('div', { class: 'grid2' },
        field('Copy to the customer within (days)', d, 'customerDays', { inputmode: 'numeric' }),
        field('Copy to the health department or local authority within (days)', d, 'authorityDays', { inputmode: 'numeric' }))),
    error,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn ghost', type: 'button', onClick: async () => { state.settings.defaults = { ...DEFAULTS }; await saveSettings('defaults'); toast('Reset to the defaults'); rerender(); } }, 'Reset to the defaults'))));
}

function reminderView() {
  const m = { ...state.settings.reminder };
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Reminder message'),
    h('p', null, 'Sent from your own email or phone when you tap Remind. These words are replaced for each customer: {customer}, {address}, {tank}, {last}, {due}, {company}, {phone}.'),
    h('form', { onSubmit: async (e) => { e.preventDefault(); state.settings.reminder = m; await saveSettings('reminder'); saved(); } },
      field('Subject', m, 'subject'),
      field('Message', m, 'body', { multiline: true, rows: 12 }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save message'),
        h('button', { class: 'btn ghost', type: 'button', onClick: async () => { state.settings.reminder = { ...DEFAULT_REMINDER }; await saveSettings('reminder'); toast('Message reset'); rerender(); } }, 'Reset to the original'))));
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}


function tanksCSV() {
  const header = ['Customer', 'Contact', 'Email', 'Phone', 'Address', 'City', 'State', 'ZIP', 'County', 'Notes', 'Tank type', 'Tank size', 'Occupants', 'Location', 'Interval months', 'Last pumped', 'In service', 'Tank address', 'Tank city', 'Material', 'Compartments', 'On call'];
  const rows = [];
  for (const c of state.customers) {
    const list = state.tanks.filter((t) => t.customerId === c.id);
    const base = [c.name, c.contact, c.email, c.phone, c.address, c.city, c.state, c.zip, c.county, c.notes];
    if (!list.length) { rows.push([...base, ...Array(12).fill('')]); continue; }
    for (const t of list) {
      const dates = state.jobs.filter((j) => j.tankId === t.id).map((j) => j.date);
      const last = [...dates, t.lastPumpedImported].filter(Boolean).sort().pop() || '';
      rows.push([...base, t.kind, t.capacity, t.people, t.location, t.intervalMonths, last, t.active === false ? 'No' : 'Yes', t.serviceAddress, t.serviceCity, t.material, t.compartments, t.onCall ? 'Yes' : 'No']);
    }
  }
  return toCSV([header, ...rows]);
}

function dataView() {
  const result = h('div', { class: 'stack', role: 'status' });
  const counts = `${state.customers.length} customers, ${state.tanks.length} tanks, ${state.jobs.length} pump-out records`;

  const backup = async () => {
    download(`tankdue-backup-${todayISO()}.json`, JSON.stringify(exportAll()), 'application/json');
    state.settings.lastBackup = todayISO();
    await saveSettings('lastBackup');
    toast('Backup file saved');
  };
  const restore = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { setChildren(result, h('div', { class: 'notice warn' }, 'That file could not be read. Choose a TankDue backup file ending in .json.')); return; }
    if (!(await confirmDialog({ title: 'Replace everything on this device?', body: `The backup from ${String(data.exportedAt || '').slice(0, 10) || 'an unknown date'} will replace the ${counts} here now.`, confirm: 'Replace with backup', danger: true }))) return;
    // Keep whichever licence key is valid for longest: the one on this device or the one in the backup.
    let keep = state.settings.licenseKey || '';
    try {
      const mine = keep ? await verifyLicense(keep, todayISO()) : { valid: false };
      const theirKey = data && data.settings && typeof data.settings.licenseKey === 'string' ? data.settings.licenseKey : '';
      const theirs = theirKey ? await verifyLicense(theirKey, todayISO()) : { valid: false };
      if (theirs.valid && (!mine.valid || theirs.payload.exp > mine.payload.exp)) keep = theirKey;
      else if (!keep) keep = theirKey;
    } catch (err) { console.warn(err); }
    try { await importAll(data, keep); await refreshLicense(); toast('Backup restored'); navigate('/due'); } catch (err) { setChildren(result, h('div', { class: 'notice warn' }, err.message)); }
  };
  const importCsv = async () => {
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    const rows = parseCSV(await file.text());
    const out = importRows(rows, newId, { customers: state.customers, tanks: state.tanks });
    const notes = out.skipped.length ? h('ul', null, out.skipped.slice(0, 40).map((x) => h('li', null, `Row ${x.row}: ${x.reason}`)), out.skipped.length > 40 ? h('li', null, `and ${out.skipped.length - 40} more`) : null) : null;
    if (!out.customers.length && !out.tanks.length) {
      setChildren(result, h('div', { class: 'notice warn' },
        out.rowsRead ? `${out.rowsRead} rows were read, but nothing new was found to add. ` : 'That file has no rows. ',
        'The first row must hold column names such as Customer, Address, Tank type, Tank size and Last pumped.', notes));
      return;
    }
    const check = out.skipped.length ? ` ${out.skipped.length} ${out.skipped.length === 1 ? 'row needs' : 'rows need'} checking; the list is shown afterwards.` : '';
    if (!(await confirmDialog({ title: 'Add these records?', body: `${out.rowsRead} rows read. ${out.customers.length} new customers and ${out.tanks.length} new tanks will be added to what is already here.${check}`, confirm: 'Add them' }))) return;
    try { await putAcross({ customers: out.customers, tanks: out.tanks }); } catch (err) { console.error(err); setChildren(result, h('div', { class: 'notice warn' }, 'The import did not save, and nothing was added. Storage on this device may be full or blocked.')); return; }
    setChildren(result, h('div', { class: 'notice' + (out.skipped.length ? ' warn' : '') },
      h('strong', null, `Added ${out.customers.length} customers and ${out.tanks.length} tanks. `),
      out.unmapped.length ? `Columns not used: ${out.unmapped.join(', ')}. ` : '',
      notes));
  };
  const erase = async () => {
    if (!(await confirmDialog({ title: 'Erase everything on this device?', body: `This removes ${counts}, your settings and your licence key from this device. Make a backup first if you may need them.`, confirm: 'Erase everything', danger: true }))) return;
    await clearAll(); await refreshLicense(); toast('Everything erased'); navigate('/due');
  };

  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Your data'),
    h('p', null, `On this device: ${counts}. TankDue keeps your records on this device and does not upload them. That is why it works with no signal, and it is also why a backup matters: if the phone or tablet is lost, so are records that were never backed up. Hauling records generally have to be kept for five years.`),
    state.settings.lastBackup ? h('p', { class: 'quiet' }, `Last backup: ${formatDate(state.settings.lastBackup)}.`) : h('div', { class: 'notice warn' }, 'No backup has been made from this device yet.'),
    h('h2', null, 'Back up and restore'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: backup }, 'Save a backup file'), h('button', { class: 'btn', onClick: restore }, 'Restore from a backup')),
    h('p', { class: 'hint' }, 'Keep the backup file somewhere off this device, such as email or cloud storage. Restoring a backup on a second device copies everything across.'),
    h('h2', null, 'Bring in a spreadsheet'),
    h('p', null, 'Save your customer list as CSV with one tank per row. TankDue reads columns named Customer, Contact, Email, Phone, Address, City, State, ZIP, County, Tank type, Tank size, Occupants, Location, Interval months and Last pumped. Records already on file are not added twice.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: importCsv }, 'Import a CSV file')),
    h('h2', null, 'Take your records out'),
    h('p', null, 'Your records are yours. Export them at any time, with or without a licence.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onClick: () => download(`tankdue-customers-tanks-${todayISO()}.csv`, tanksCSV(), 'text/csv') }, 'Export customers and tanks'),
      h('button', { class: 'btn', onClick: () => download(`tankdue-records-${todayISO()}.csv`, jobsCSV(state.jobs), 'text/csv') }, 'Export all pump-out records')),
    result,
    h('h2', null, 'Start over'),
    h('div', { class: 'row' },
      !state.customers.length ? h('button', { class: 'btn', onClick: async () => { await loadSampleData(); toast('Sample records loaded'); navigate('/due'); } }, 'Load sample records') : null,
      h('button', { class: 'btn danger ghost', onClick: erase }, 'Erase everything on this device')));
}

function licenceView() {
  const e = currentEntitlement();
  const draft = { key: state.settings.licenseKey || '' };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const status = e.mode === 'licensed'
    ? h('div', { class: 'notice' }, h('strong', null, 'Licensed'), state.license.payload.name ? ` to ${state.license.payload.name}` : '', ` until ${formatDate(e.until)}.`)
    : e.mode === 'trial'
      ? h('div', { class: 'notice' }, `Free trial: ${e.left} of ${TRIAL_JOBS} jobs left. Every feature works during the trial.`)
      : h('div', { class: 'notice warn' }, e.mode === 'expired' ? `Your licence ended on ${formatDate(state.license.payload.exp)}. ` : 'The free trial is used up. ', 'Saved records stay available and exportable.');
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Licence'),
    status,
    h('p', null, `${CONFIG.priceLine} One key covers every truck and driver. There is no charge per truck, per user or per job, and no contract.`),
    CONFIG.purchaseUrl ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: CONFIG.purchaseUrl, target: '_blank', rel: 'noopener' }, 'Buy a licence')) : null,
    CONFIG.supportEmail ? h('p', { class: 'quiet' }, 'Questions: ', h('a', { href: `mailto:${CONFIG.supportEmail}` }, CONFIG.supportEmail)) : null,
    h('form', {
      onSubmit: async (ev) => {
        ev.preventDefault();
        error.textContent = '';
        const key = draft.key.trim();
        if (!key) {
          if (!state.settings.licenseKey) return;
          if (!(await confirmDialog({ title: 'Remove the licence key from this device?', body: 'Keep a copy of the key first. Without it, new jobs stop once the free trial is used up.', confirm: 'Remove key', danger: true }))) return;
          state.settings.licenseKey = ''; await saveSettings('licenseKey'); await refreshLicense(); rerender(); return;
        }
        if (!(globalThis.crypto && crypto.subtle)) { error.textContent = 'This browser cannot check licence keys here. Open TankDue from its https address and try again.'; return; }
        const res = await verifyLicense(key, todayISO());
        if (!res.valid) { error.textContent = res.reason; return; }
        state.settings.licenseKey = key; await saveSettings('licenseKey'); await refreshLicense();
        toast('Licence key accepted'); rerender();
      },
    },
    field('Licence key', draft, 'key', { multiline: true, rows: 4, placeholder: 'TK1…' }),
    error,
    h('button', { class: 'btn primary', type: 'submit' }, 'Save licence key')));
}


function helpView() {
  const step = (title, text) => h('li', null, h('strong', null, title), h('br'), text);
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'How TankDue works'),
    h('ol', { class: 'steps' },
      step('Set up once.', 'Add your company, drivers, truck and the places you dispose under Settings. They print on every record.'),
      step('Add your customers and their tanks.', 'Type them in, or import the list you already keep under Settings, Your data. Give each tank its last pump-out date and TankDue works out when it is due again.'),
      step('On site, open the tank and record the pump-out.', 'Gallons, what you saw, and the customer’s signature. The job goes onto the truck.'),
      step('At the plant, record the disposal.', 'Open Truck, tap "Record the disposal", pick the facility and enter its receipt number. Every pickup on that load is stamped with where and when it went.'),
      step('Send the record.', 'Share or download the pumping record for the customer and, where required, the health department. Mark each copy as sent.'),
      step('At year end, open Records, Hauling summary.', 'Gallons by facility, waste type, town and month for the reporting year you choose.'),
      step('The Due screen tells you who to call.', 'Tap Remind to send the customer a message from your own email or phone.')),
    h('h2', null, 'Put it on your home screen'),
    h('p', null, 'On an iPhone or iPad, open TankDue in Safari, tap Share, then "Add to Home Screen". On Android, open it in Chrome, tap the menu, then "Install app" or "Add to Home screen". It then opens like any other app and works with no signal.'),
    h('h2', null, 'Keep a backup'),
    h('p', null, 'Your records live on this device only. Once a week, go to Settings, Your data, and save a backup file somewhere off the device. To move to a new phone, restore that file on it.'),
    h('h2', null, 'What TankDue is not'),
    h('p', null, 'It prints one clear pumping record and one summary layout. It does not reproduce each state’s or county’s own form, and it does not file anything for you. Rules on tickets, copies and yearly reports differ by state and county; check what yours require.'));
}
