import { h, setChildren, field, toast, confirmDialog, download } from '../dom.js';
import { state, byId, put, remove, saveSettings } from '../store.js';
import { WASTE_TYPES, wasteName, wasteForKind, gallons, formatGallons, money, intervalFor, addMonthsISO, copiesOwed, summarise, period, siteOf, MAX_GALLONS } from '../domain/service.js';
import { todayISO, formatDate, formatMonth, isISODate } from '../domain/due.js';
import { toCSV } from '../domain/csv.js';
import { navigate, rerender, currentEntitlement } from '../nav.js';
import { backLink, customerAddress, tankLine, fact, emptyState, searchBox, segmented, signaturePad, missing } from './shared.js';
import { buildJobPDF, buildSummaryPDF, jobFilename, observationPairs } from '../pdf.js';

const REASONS = ['Routine maintenance', 'Backup or emergency', 'Real estate inspection', 'Before a repair', 'Requested by the health department', 'Other'];
const PAID = [['', 'Not recorded'], 'Cash', 'Check', 'Card', 'Invoice sent', 'Not yet paid'];
const BAFFLE = [['', 'Not checked'], 'Good', 'Damaged', 'Missing', 'Could not see'];

const DRAFT_FIELDS = ['date', 'time', 'driverId', 'truckId', 'gallons', 'wasteType', 'reason', 'obs', 'condition', 'work', 'recommend', 'intervalMonths', 'price', 'paid', 'customerSignature', 'driverSignature'];

const draftKey = (existing, t) => (existing ? `tankdue-draft-edit-${existing.id}` : `tankdue-draft-new-${t.id}`);
function readDraft(key) {
  try { const d = JSON.parse(localStorage.getItem(key) || 'null'); return d && typeof d === 'object' && d.j && typeof d.j.obs === 'object' ? d : null; } catch { return null; }
}
function writeDraft(key, j) { try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), j })); } catch { /* the form still works */ } }
function dropDraft(key) { try { localStorage.removeItem(key); } catch { /* nothing to drop */ } }

export function jobEditView(id, tankId) {
  const existing = id ? byId('jobs', id) : null;
  if (id && !existing) return missing('That record is no longer here.', '#/records', 'Records');
  const t = byId('tanks', existing ? existing.tankId : tankId);
  if (!t) return missing('That tank is no longer here.', '#/due', 'Who is due');
  const c = byId('customers', t.customerId);

  if (!existing) {
    const e = currentEntitlement();
    if (!e.canCreate) {
      return h('section', null, backLink(`#/tank/${t.id}`, 'Tank'),
        h('h1', null, e.mode === 'expired' ? 'Your licence has ended' : 'The free trial is used up'),
        h('p', null, 'Everything you have recorded stays here. You can open, share and export every record. To record new jobs, enter a licence key.'),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/settings/licence' }, 'Enter a licence key')));
    }
    if (!state.drivers.length || !state.trucks.length) {
      return h('section', null, backLink(`#/tank/${t.id}`, 'Tank'),
        h('h1', null, 'Two things before the first job'),
        h('p', null, 'Every record carries the driver and the vehicle. Add them once and TankDue fills them in from then on.'),
        h('div', { class: 'row' },
          !state.drivers.length ? h('a', { class: 'btn primary', href: '#/settings/drivers' }, 'Add a driver') : null,
          !state.trucks.length ? h('a', { class: 'btn primary', href: '#/settings/trucks' }, 'Add a truck') : null));
    }
  }

  const now = new Date();
  const fresh = () => (existing ? structuredClone(existing) : {
    tankId: t.id,
    date: todayISO(now),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    driverId: byId('drivers', state.settings.lastDriverId) ? state.settings.lastDriverId : state.drivers[0].id,
    truckId: byId('trucks', state.settings.lastTruckId) ? state.settings.lastTruckId : state.trucks[0].id,
    gallons: '', wasteType: wasteForKind(t.kind), reason: 'Routine maintenance',
    obs: {}, condition: '', work: '', recommend: '',
    intervalMonths: t.onCall || intervalFor(t, state.settings.defaults) === null ? '' : String(intervalFor(t, state.settings.defaults)),
    price: '', paid: '', customerSignature: '', driverSignature: '', loadId: null,
  });
  const key = draftKey(existing, t);
  const draft = readDraft(key);
  // A draft is only the fields a person types. It never carries the record's
  // identity, its load, its snapshot or its copy-sent dates, and a draft older
  // than the saved record is thrown away.
  const usable = !!(draft && draft.j.tankId === t.id && (!existing || (draft.j.id === existing.id && draft.savedAt >= (existing.updatedAt || 0))));
  if (draft && !usable) dropDraft(key);
  const j = fresh();
  if (usable) for (const f of DRAFT_FIELDS) if (f in draft.j) j[f] = draft.j[f];
  const restored = usable;
  const prefilledInterval = String(fresh().intervalMonths ?? '');
  j.obs = j.obs && typeof j.obs === 'object' ? j.obs : {};
  // Records from an older version or an import may lack a field; treat it as blank.
  for (const f of ['time', 'gallons', 'reason', 'condition', 'work', 'recommend', 'intervalMonths', 'price', 'paid', 'customerSignature', 'driverSignature']) if (j[f] === undefined || j[f] === null) j[f] = '';
  let rememberSignature = false;
  let ready = false;

  // Driver and truck as recorded on a job being corrected, unless changed.
  const recorded = existing ? existing.snapshot || {} : {};
  const driverFor = (did) => (existing && did === existing.driverId && recorded.driver ? recorded.driver : byId('drivers', did));
  const truckFor = (tid) => (existing && tid === existing.truckId && recorded.truck ? recorded.truck : byId('trucks', tid));
  const driverOptions = state.drivers.map((d) => [d.id, d.name]);
  if (existing && !byId('drivers', existing.driverId) && recorded.driver) driverOptions.unshift([existing.driverId, `${recorded.driver.name || 'Driver'} (as recorded)`]);
  const truckLabel = (x) => [x.name, x.plate].filter(Boolean).join(', ') || 'Truck';
  const truckOptions = state.trucks.map((x) => [x.id, truckLabel(x)]);
  if (existing && !byId('trucks', existing.truckId) && recorded.truck) truckOptions.unshift([existing.truckId, `${truckLabel(recorded.truck)} (as recorded)`]);
  const locked = !!(existing && byId('jobs', existing.id)?.loadId);

  const error = h('p', { class: 'form-error', role: 'alert' });
  const gallonsNote = h('p', { class: 'reading-msg', role: 'status' });
  const dueNote = h('p', { class: 'hint', role: 'status' });

  function update() {
    const g = gallons(j.gallons);
    const cap = gallons(t.capacity);
    const truckCap = gallons(truckFor(j.truckId)?.capacity);
    gallonsNote.className = 'reading-msg';
    if (j.gallons !== '' && g === null) { gallonsNote.textContent = `Enter gallons as a plain number up to ${formatGallons(MAX_GALLONS)}, such as 1000.`; gallonsNote.classList.add('bad'); }
    else if (g !== null && cap && g > 0 && g < cap * 0.05) { gallonsNote.textContent = `That is very little for a ${formatGallons(cap)} gallon tank. Check the number.`; gallonsNote.classList.add('warn'); }
    else if (g !== null && cap && g > cap * 1.25) { gallonsNote.textContent = `That is more than this tank holds (${formatGallons(cap)} gallons). Check the number.`; gallonsNote.classList.add('warn'); }
    else if (g !== null && truckCap && g > truckCap) { gallonsNote.textContent = `That is more than the truck holds (${formatGallons(truckCap)} gallons). If it took two trips, record a job for each.`; gallonsNote.classList.add('warn'); }
    else gallonsNote.textContent = cap ? `Tank size on file: ${formatGallons(cap)} gallons.` : '';

    const m = Number(j.intervalMonths);
    if (j.intervalMonths === '' || !isISODate(j.date)) dueNote.textContent = t.onCall ? 'This tank is on call only, so no next date is set.' : '';
    else if (!(Number.isInteger(m) && m >= 1 && m <= 240)) dueNote.textContent = 'Enter a whole number of months from 1 to 240.';
    else dueNote.textContent = `Next pump-out due ${formatDate(addMonthsISO(j.date, m))}. This prints on the customer's record.`;
    if (ready) writeDraft(key, j);
  }

  const o = j.obs;
  const obsField = (label, k, options) => field(label, o, k, { options, optional: true, onChange: update });
  const yesNo = (label, k) => h('div', { class: 'field' }, h('span', { class: 'label' }, label), segmented([[true, 'Yes'], [false, 'No']], o[k] ?? null, (v) => { if (v === null) delete o[k]; else o[k] = v; update(); }, label));

  const custPad = signaturePad(j.customerSignature, (d) => { j.customerSignature = d; update(); }, 'Customer signature area');
  const drvPad = signaturePad(j.driverSignature, (d) => { j.driverSignature = d; update(); }, 'Driver signature area');
  const driverHasSaved = () => !!byId('drivers', j.driverId)?.signature;
  const useSaved = h('button', { type: 'button', class: 'btn small', hidden: !driverHasSaved(), onClick: () => { const s = byId('drivers', j.driverId).signature; j.driverSignature = s; drvPad.load(s); update(); } }, 'Use my saved signature');

  async function save(e) {
    e.preventDefault();
    error.textContent = '';
    if (!isISODate(j.date)) { error.textContent = 'Enter the date of the pump-out.'; return; }
    if (j.date > todayISO()) { error.textContent = 'The date is in the future. Check the date.'; return; }
    // Take the load and copy dates from the record as it is now, never from an open form.
    const live = existing ? byId('jobs', existing.id) : null;
    if (existing && !live) { error.textContent = 'This record was deleted while the form was open.'; return; }
    if (live) { j.loadId = live.loadId || null; j.customerCopyOn = live.customerCopyOn || ''; j.authorityCopyOn = live.authorityCopyOn || ''; if (live.loadId) j.truckId = live.truckId; }
    const onLoad = j.loadId ? byId('loads', j.loadId) : null;
    if (onLoad && j.date > onLoad.date) { error.textContent = `This pump-out was disposed of on ${formatDate(onLoad.date)}, so its date cannot be later than that. To change it, undo the disposal first.`; return; }
    const g = gallons(j.gallons);
    if (g === null || g <= 0) { error.textContent = 'Enter how many gallons were removed.'; return; }
    j.gallons = String(g);
    for (const k of ['scum', 'sludge']) {
      if (o[k] !== undefined && o[k] !== '' && !/^\d{1,3}(\.\d)?$/.test(String(o[k]).trim())) { error.textContent = 'Enter scum and sludge depth in inches, such as 6.'; return; }
      if (o[k] !== undefined) o[k] = String(o[k]).trim();
    }
    if (j.intervalMonths !== '' && !(Number.isInteger(Number(j.intervalMonths)) && Number(j.intervalMonths) >= 1 && Number(j.intervalMonths) <= 240)) { error.textContent = 'The next pump-out interval must be a whole number of months from 1 to 240, or blank.'; return; }
    if (j.price !== '') {
      const p = money(j.price);
      if (p === null) { error.textContent = 'Enter the charge as an amount, such as 350.'; return; }
      j.price = p.toFixed(2);
    }
    const driver = driverFor(j.driverId);
    const truck = truckFor(j.truckId);
    if (!driver || !truck) { error.textContent = 'Choose a driver and a truck.'; return; }
    const { signature: _omit, ...driverInfo } = driver;
    if (existing && existing.snapshot) {
      // Correcting a record must not rewrite its history.
      j.snapshot = { ...structuredClone(existing.snapshot), driver: driverInfo, truck: { ...truck } };
      j.correctedAt = Date.now();
    } else {
      j.snapshot = { company: { ...state.settings.company }, customer: c ? { ...c } : {}, tank: { ...t }, driver: driverInfo, truck: { ...truck } };
    }
    j.nextDue = j.intervalMonths !== '' ? addMonthsISO(j.date, Number(j.intervalMonths)) : '';
    if (!j.createdAt) j.createdAt = Date.now();
    let saved;
    try { saved = await put('jobs', j); } catch (err) {
      console.error(err);
      error.textContent = 'The record did not save. Storage on this device may be full or blocked. What you entered is still here; free some space and press save again.';
      return;
    }
    dropDraft(key);
    try {
      // A new, latest job can set the tank's schedule, but only when the driver
      // changed the number offered. Corrections never touch the tank.
      const liveTank = byId('tanks', t.id);
      if (liveTank && !existing) {
        const latest = !state.jobs.some((x) => x.tankId === t.id && x.id !== saved.id && x.date > j.date);
        let changed = false;
        if (latest && j.intervalMonths !== '' && String(j.intervalMonths) !== prefilledInterval) { liveTank.intervalMonths = String(j.intervalMonths); changed = true; }
        if (liveTank.remindedOn) { liveTank.remindedOn = ''; changed = true; }
        if (changed) await put('tanks', liveTank);
      }
      state.settings.lastDriverId = j.driverId; state.settings.lastTruckId = j.truckId;
      await saveSettings('lastDriverId', 'lastTruckId');
      const liveDriver = byId('drivers', j.driverId);
      if (rememberSignature && j.driverSignature && liveDriver) { liveDriver.signature = j.driverSignature; await put('drivers', liveDriver); }
    } catch (err) { console.warn(err); }
    toast(existing ? 'Record corrected' : 'Pump-out recorded. It is on the truck.');
    navigate(`/record/${saved.id}`);
  }

  const gallonsInput = h('input', { type: 'text', inputmode: 'numeric', class: 'psid', 'aria-label': 'Gallons removed', autocomplete: 'off', placeholder: '0', maxlength: 8 });
  gallonsInput.value = j.gallons ?? '';
  gallonsInput.addEventListener('input', () => { j.gallons = gallonsInput.value; update(); });

  const form = h('form', { onSubmit: save, novalidate: true, class: 'jobform' },
    h('div', { class: 'grid2' },
      field('Date', j, 'date', { type: 'date', onChange: update }),
      field('Time', j, 'time', { type: 'time', optional: true, onChange: update }),
      field('Driver', j, 'driverId', { options: driverOptions, onChange: () => { useSaved.hidden = !driverHasSaved(); update(); } }),
      locked
        ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Truck'), h('p', null, truckLabel(truckFor(j.truckId) || {})), h('p', { class: 'hint' }, 'This job has already been disposed of, so its truck cannot change.'))
        : field('Truck', j, 'truckId', { options: truckOptions, onChange: update })),
    h('fieldset', null,
      h('legend', null, 'What was pumped'),
      h('div', { class: 'reading' },
        h('p', { class: 'reading-label' }, 'Gallons removed'),
        h('div', { class: 'psid-wrap' }, gallonsInput, h('span', { 'aria-hidden': 'true' }, 'gallons')),
        gallonsNote),
      h('div', { class: 'grid2' },
        field('Waste type', j, 'wasteType', { options: WASTE_TYPES.map((w) => [w.code, w.name]), onChange: update }),
        field('Reason', j, 'reason', { options: REASONS, onChange: update }))),
    h('details', { open: Object.keys(o).length > 0 || !!j.condition },
      h('summary', null, 'Tank condition'),
      h('p', { class: 'hint' }, 'Record what you saw. Several states and many counties expect the pumping record to say what condition the tank was in.'),
      h('div', { class: 'grid2' },
        obsField('Liquid level at arrival', 'level', [['', 'Not checked'], 'Normal', 'High, above the outlet', 'Low, below the outlet']),
        obsField('Risers and lids', 'lids', [['', 'Not checked'], 'Good', 'Damaged', 'Buried, no riser', 'Unsafe lid']),
        field('Scum depth (inches)', o, 'scum', { optional: true, inputmode: 'decimal', maxlength: 5, onChange: update }),
        field('Sludge depth (inches)', o, 'sludge', { optional: true, inputmode: 'decimal', maxlength: 5, onChange: update }),
        obsField('Inlet baffle or tee', 'inlet', BAFFLE),
        obsField('Outlet baffle or tee', 'outlet', BAFFLE),
        yesNo('Effluent filter present', 'filterPresent'),
        yesNo('Effluent filter cleaned', 'filterCleaned'),
        yesNo('Signs of the tank leaking', 'leak'),
        yesNo('Water ran back from the drainfield', 'backflow'),
        obsField('Access used', 'access', [['', 'Not recorded'], 'Manhole', 'Riser', 'Inspection port', 'Other'])),
      field('Condition notes', j, 'condition', { multiline: true, rows: 2, optional: true, onChange: update }),
      field('Work done besides pumping', j, 'work', { multiline: true, rows: 2, optional: true, onChange: update }),
      field('What you recommend', j, 'recommend', { multiline: true, rows: 2, optional: true, onChange: update })),
    h('fieldset', null,
      h('legend', null, 'Next pump-out'),
      field('Pump again in (months)', j, 'intervalMonths', { optional: true, inputmode: 'numeric', maxlength: 3, onChange: update }),
      dueNote),
    h('fieldset', null,
      h('legend', null, 'Charge'),
      h('div', { class: 'grid2' },
        field('Amount ($)', j, 'price', { optional: true, inputmode: 'decimal', maxlength: 9, onChange: update }),
        field('Paid by', j, 'paid', { options: PAID, optional: true, onChange: update }))),
    h('fieldset', null,
      h('legend', null, 'Signatures'),
      h('p', { class: 'label' }, 'Customer'),
      custPad.el,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onClick: () => custPad.clear() }, 'Clear customer signature')),
      h('p', { class: 'label' }, 'Driver'),
      drvPad.el,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onClick: () => drvPad.clear() }, 'Clear driver signature'),
        useSaved,
        h('label', { class: 'check inline' }, h('input', { type: 'checkbox', onChange: (e) => { rememberSignature = e.currentTarget.checked; } }), 'Save mine for next time')),
      h('p', { class: 'hint' }, 'Sign with a finger. Leave blank to sign the printed record by hand, or if nobody was home.')),
    error,
    h('div', { class: 'row sticky-actions' }, h('button', { class: 'btn primary big', type: 'submit' }, existing ? 'Save corrected record' : 'Save pump-out')));

  update();
  ready = true;

  return h('section', null,
    backLink(existing ? `#/record/${id}` : `#/tank/${t.id}`, existing ? 'Record' : 'Tank'),
    h('h1', null, existing ? 'Correct this record' : 'Record a pump-out'),
    h('p', { class: 'subject' }, h('strong', null, c ? c.name : ''), h('br'), customerAddress(c, t), h('br'), tankLine(t), t.location ? h('span', null, h('br'), t.location) : null),
    restored ? h('div', { class: 'notice' }, `Picked up where you left off${draft.savedAt ? ' on ' + formatDate(todayISO(new Date(draft.savedAt))) : ''}. This was not saved yet. `,
      h('button', { class: 'btn small', type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Clear this form?', body: 'What you entered will be discarded.', confirm: 'Clear the form', danger: true })) { dropDraft(key); rerender(); } } }, 'Start over')) : null,
    form);
}

export function recordView(id) {
  const j = byId('jobs', id);
  if (!j) return missing('That record is no longer here.', '#/records', 'Records');
  const snap = j.snapshot || {};
  const c = snap.customer || {};
  const t = snap.tank || {};
  const load = j.loadId ? byId('loads', j.loadId) : null;
  const error = h('p', { class: 'form-error', role: 'alert' });

  const makePdf = async () => new File([await buildJobPDF(j, load)], jobFilename(j), { type: 'application/pdf' });
  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing…';
    try { await fn(); } catch (err) { if (err && err.name !== 'AbortError') { console.error(err); toast('The PDF could not be made: ' + (err.message || err)); } }
    btn.disabled = false; btn.textContent = label;
  };
  const canShareFiles = typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } })();

  const markCopy = (fieldName, label) => {
    const done = j[fieldName];
    return h('div', { class: 'copyrow' },
      h('span', null, label, ': ', done ? h('strong', null, 'sent ' + formatDate(done)) : h('span', { class: 'quiet' }, 'not sent yet')),
      h('button', {
        class: 'btn small', type: 'button',
        onClick: async () => {
          const live = byId('jobs', j.id);
          if (!live) return;
          live[fieldName] = done ? '' : todayISO();
          try { await put('jobs', live); } catch (err) { console.error(err); error.textContent = 'That did not save. Storage on this device may be full or blocked.'; return; }
          rerender();
        },
      }, done ? 'Undo' : 'Sent today'));
  };
  const owed = copiesOwed(j, state.settings.defaults);
  const obs = observationPairs(j);

  return h('section', null,
    backLink(`#/tank/${j.tankId}`, 'Tank'),
    h('div', { class: 'stamp' }, h('strong', null, formatGallons(gallons(j.gallons)) + ' gallons'), h('span', null, `${formatDate(j.date)}${j.time ? ' at ' + j.time : ''}`)),
    h('p', { class: 'subject' }, h('strong', null, c.name || ''), h('br'), customerAddress(c, t), h('br'), tankLine(t)),
    load
      ? h('div', { class: 'notice' }, 'Disposed of at ', h('a', { href: `#/load/${load.id}` }, load.snapshot?.facility?.name || 'a receiving facility'), ` on ${formatDate(load.date)}.`)
      : h('div', { class: 'notice warn' }, 'Still on the truck. ', h('a', { href: '#/truck' }, 'Record the disposal'), ' when it is dumped.'),
    owed.map((x) => h('div', { class: 'notice' + (x.days < 0 ? ' warn' : '') }, x.who === 'customer' ? 'Customer copy' : 'Copy for the local authority', x.days < 0 ? ` is ${-x.days} ${x.days === -1 ? 'day' : 'days'} late.` : x.days === 0 ? ' is due today.' : ` is due in ${x.days} ${x.days === 1 ? 'day' : 'days'}.`)),
    h('div', { class: 'row' },
      canShareFiles ? h('button', { class: 'btn primary', onClick: (e) => busy(e.currentTarget, async () => { const file = await makePdf(); await navigator.share({ files: [file], title: 'Pumping record' }); }) }, 'Share record') : null,
      h('button', { class: 'btn' + (canShareFiles ? '' : ' primary'), onClick: (e) => busy(e.currentTarget, async () => { const file = await makePdf(); download(file.name, file); }) }, 'Download record (PDF)')),
    h('div', { class: 'panel' }, h('h3', null, 'Copies'), markCopy('customerCopyOn', 'Customer'), markCopy('authorityCopyOn', 'Health department or local authority'), error),
    h('dl', { class: 'facts' },
      fact('Waste type', wasteName(j.wasteType)),
      fact('Reason', j.reason),
      fact('Driver', snap.driver?.name),
      fact('Truck', [snap.truck?.name, snap.truck?.plate].filter(Boolean).join(', ')),
      obs.map(([label, value]) => fact(label, value)),
      fact('Condition', j.condition),
      fact('Work done', j.work),
      fact('Recommended', j.recommend),
      fact('Next pump-out', formatDate(j.nextDue)),
      fact('Charge', j.price ? '$' + Number(j.price).toFixed(2) + (j.paid ? ', ' + j.paid.toLowerCase() : '') : '')),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: `#/job/${j.id}/edit` }, 'Correct this record'),
      h('button', {
        class: 'btn small danger ghost',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete this record?', body: (load ? 'It is part of a recorded disposal, and that load’s total will change. ' : '') + 'Hauling records generally have to be kept for five years. Delete only a record made by mistake.', confirm: 'Delete record', danger: true }))) return;
          await remove('jobs', j.id);
          toast('Record deleted');
          navigate(`/tank/${j.tankId}`);
        },
      }, 'Delete record')));
}

export function jobsCSV(jobs) {
  const header = ['Date', 'Time', 'Customer', 'Service address', 'Town', 'County', 'State', 'Tank', 'Tank size (gal)', 'Waste type', 'Gallons removed', 'Reason', 'Driver', 'Truck', 'Plate', 'Disposal facility', 'Facility permit', 'Disposal date', 'Disposal time', 'Facility receipt', 'Condition', 'Work done', 'Next pump-out', 'Charge', 'Paid', 'Customer copy sent', 'Authority copy sent'];
  const rows = jobs.map((j) => {
    const s = j.snapshot || {};
    const load = j.loadId ? byId('loads', j.loadId) : null;
    const f = load?.snapshot?.facility || {};
    const site = siteOf(s.customer, s.tank);
    return [j.date, j.time, s.customer?.name, site.street, site.city, site.county, site.state, s.tank?.kind, s.tank?.capacity,
      wasteName(j.wasteType), j.gallons, j.reason, s.driver?.name, s.truck?.name, s.truck?.plate, f.name, f.permitNo, load?.date, load?.time, load?.receiptNo,
      [observationPairs(j).map(([l, v]) => `${l}: ${v}`).join('; '), j.condition].filter(Boolean).join('. '), j.work, j.nextDue, j.price, j.paid, j.customerCopyOn, j.authorityCopyOn];
  });
  return toCSV([header, ...rows]);
}

let query = '';
let year = '';
let owedOnly = false;

export function recordsView() {
  const all = [...state.jobs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  if (!all.length) {
    return h('section', null, h('h1', null, 'Records'),
      emptyState('No pump-outs recorded yet', 'Records you save appear here, newest first. Start one from a tank on the Due screen.', h('a', { class: 'btn primary', href: '#/due' }, 'See who is due')));
  }
  const years = [...new Set(all.map((j) => j.date.slice(0, 4)))];
  if (year && !years.includes(year)) year = '';
  const tracking = state.settings.defaults.customerDays > 0 || state.settings.defaults.authorityDays > 0;
  const owes = (j) => copiesOwed(j, state.settings.defaults).length > 0;
  const owedCount = tracking ? all.filter(owes).length : 0;
  const q = query.trim().toLowerCase();
  const shown = all.filter((j) => (!owedOnly || owes(j)) && (!year || j.date.startsWith(year)) && (!q || [j.snapshot?.customer?.name, siteOf(j.snapshot?.customer, j.snapshot?.tank).street, siteOf(j.snapshot?.customer, j.snapshot?.tank).city, j.snapshot?.driver?.name].some((v) => v && v.toLowerCase().includes(q))));
  const total = shown.reduce((n, j) => n + (gallons(j.gallons) || 0), 0);
  const yearSel = h('select', { 'aria-label': 'Year', onChange: (e) => { year = e.currentTarget.value; rerender(); } },
    h('option', { value: '' }, 'All years'), years.map((y) => h('option', { value: y, selected: y === year }, y)));
  return h('section', null,
    h('div', { class: 'row between' }, h('h1', null, 'Records'), h('a', { class: 'btn small', href: '#/summary' }, 'Hauling summary')),
    h('div', { class: 'searchbar' }, searchBox(query, 'Search customer, town or driver', (v) => { query = v; rerender(); }), yearSel),
    tracking ? h('div', { class: 'chips' },
      h('button', { class: 'chip' + (!owedOnly ? ' on' : ''), 'aria-pressed': String(!owedOnly), onClick: () => { owedOnly = false; rerender(); } }, 'All ', h('b', null, all.length)),
      h('button', { class: 'chip' + (owedOnly ? ' on' : '') + (owedCount ? ' alert' : ''), 'aria-pressed': String(owedOnly), onClick: () => { owedOnly = true; rerender(); } }, 'Copies to send ', h('b', null, owedCount))) : null,
    h('div', { class: 'row between' },
      h('p', { class: 'quiet' }, `${shown.length} ${shown.length === 1 ? 'pump-out' : 'pump-outs'}, ${formatGallons(total)} gallons.`),
      h('button', { class: 'btn small', onClick: () => { download(`tankdue-records-${todayISO()}.csv`, jobsCSV(shown), 'text/csv'); toast(`${shown.length} ${shown.length === 1 ? 'record' : 'records'} exported`); } }, 'Export these as a spreadsheet')),
    h('ul', { class: 'rows' }, shown.map((j) => h('li', null, h('a', { href: `#/record/${j.id}` },
      h('span', { class: 'row-main' }, j.snapshot?.customer?.name || 'Unknown customer'),
      h('span', { class: 'row-sub' }, formatDate(j.date), siteOf(j.snapshot?.customer, j.snapshot?.tank).city ? ', ' + siteOf(j.snapshot?.customer, j.snapshot?.tank).city : '', j.loadId ? '' : ', on the truck'),
      h('span', { class: 'row-count' }, formatGallons(gallons(j.gallons)) + ' gal'))))));
}

export function summaryView() {
  const thisYear = Number(todayISO().slice(0, 4));
  const kind = state.settings.summaryYear === 'june' ? 'june' : 'calendar';
  // A June-to-May year is named by the year it ends in, so a job in August 2020 belongs to 2021.
  const yearOf = (iso) => (kind === 'june' && Number(iso.slice(5, 7)) >= 6 ? Number(iso.slice(0, 4)) + 1 : Number(iso.slice(0, 4)));
  const years = new Set([summaryYearDefault(kind, thisYear), summaryYearDefault(kind, thisYear) - 1]);
  for (const j of state.jobs) years.add(yearOf(j.date));
  const pick = { kind, year: String(summaryYearDefault(kind, thisYear)) };
  const out = h('div', null);

  const draw = () => {
    const p = period(pick.kind, pick.year);
    const s = summarise(state.jobs, new Map(state.loads.map((l) => [l.id, l])), p.from, p.to);
    const table = (caption, heads, rows) => h('table', { class: 'sumtable' }, h('caption', null, caption),
      h('thead', null, h('tr', null, heads.map((x, i) => h('th', { scope: 'col', class: i >= heads.length - 2 ? 'num' : '' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((x, i) => h('td', { class: i >= r.length - 2 ? 'num' : '' }, x))))));
    setChildren(out,
      h('div', { class: 'stamp' }, h('strong', null, formatGallons(s.total) + ' gallons'), h('span', null, `${s.jobs} pump-outs, ${p.label}`)),
      s.undisposedJobs ? h('div', { class: 'notice warn' }, `${formatGallons(s.undisposed)} gallons from ${s.undisposedJobs} pump-out${s.undisposedJobs === 1 ? '' : 's'} in this period have no disposal recorded. `, h('a', { href: '#/truck' }, 'Record the disposal'), ' so the totals by facility are complete.') : null,
      !s.jobs ? h('p', { class: 'quiet' }, 'No pump-outs in this period.') : [
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { download(`hauling-summary-${p.from}-to-${p.to}.pdf`, new Blob([await buildSummaryPDF({ company: state.settings.company, label: p.label, summary: s })], { type: 'application/pdf' })); } catch (err) { console.error(err); toast('The PDF could not be made', { error: true }); } b.disabled = false; } }, 'Download summary (PDF)'),
          h('button', { class: 'btn', onClick: () => download(`hauling-summary-${p.from}-to-${p.to}.csv`, toCSV([['Facility', 'Permit no.', 'Waste type', 'Pump-outs', 'Gallons'], ...s.byFacilityWaste.map((r) => [r.facility, r.permit, wasteName(r.wasteType), r.jobs, r.gallons]), [], ['Facility', 'Town', 'County', 'Pump-outs', 'Gallons'], ...s.byFacilityTown.map((r) => [r.facility, r.town, r.county, r.jobs, r.gallons]), [], ['Facility', 'Month', 'Pump-outs', 'Gallons'], ...s.byFacilityMonth.map((r) => [r.facility, r.month, r.jobs, r.gallons])]), 'text/csv') }, 'Download as a spreadsheet')),
        table('By receiving facility and waste type', ['Facility', 'Permit no.', 'Waste type', 'Pump-outs', 'Gallons'], s.byFacilityWaste.map((r) => [r.facility, r.permit, wasteName(r.wasteType), r.jobs, formatGallons(r.gallons)])),
        table('By receiving facility and town of origin', ['Facility', 'Town', 'County', 'Pump-outs', 'Gallons'], s.byFacilityTown.map((r) => [r.facility, r.town || '(not recorded)', r.county, r.jobs, formatGallons(r.gallons)])),
        table('By receiving facility and month', ['Facility', 'Month', 'Pump-outs', 'Gallons'], s.byFacilityMonth.map((r) => [r.facility, formatMonth(r.month), r.jobs, formatGallons(r.gallons)])),
      ],
      h('p', { class: 'quiet' }, 'Totals count each pump-out by its date. Check them against your tickets and the form your agency requires before filing.'));
  };
  const form = h('div', { class: 'grid2' },
    field('Reporting year', pick, 'kind', {
      options: [['calendar', 'Calendar year, January to December'], ['june', 'June to May (Texas annual summary)']],
      onChange: async (v) => { state.settings.summaryYear = v; pick.year = String(summaryYearDefault(v, thisYear)); try { await saveSettings('summaryYear'); } catch (err) { console.warn(err); } rerender(); },
    }),
    field(pick.kind === 'june' ? 'Year ending 31 May' : 'Year', pick, 'year', { options: [...years].sort((a, b) => b - a).map(String), onChange: draw }));
  draw();
  return h('section', null, backLink('#/records', 'Records'), h('h1', null, 'Hauling summary'),
    h('p', null, 'Gallons for a reporting year, grouped the ways state and local reports ask for them.'),
    form, out);
}

function summaryYearDefault(kind, thisYear) {
  if (kind !== 'june') return thisYear;
  return Number(todayISO().slice(5, 7)) >= 6 ? thisYear + 1 : thisYear;
}
