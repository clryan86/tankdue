import { h, field, toast, confirmDialog, download } from '../dom.js';
import { state, byId, saveSettings, commitDisposal, undoDisposal } from '../store.js';
import { truckLoad, gallons, formatGallons, wasteName, siteOf } from '../domain/service.js';
import { todayISO, formatDate, isISODate } from '../domain/due.js';
import { navigate, rerender } from '../nav.js';
import { backLink, emptyState, gauge, fact, missing } from './shared.js';
import { buildLoadPDF } from '../pdf.js';

const truckLabel = (t) => [t.name, t.plate].filter(Boolean).join(', ') || 'Truck';

async function loadSheet(btn, truck, jobs, load) {
  btn.disabled = true;
  try {
    const bytes = await buildLoadPDF({ company: state.settings.company, truck, jobs, load });
    download(`load-sheet-${load ? load.date : todayISO()}-${(truck.name || 'truck').replace(/[^A-Za-z0-9]+/g, '-')}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
  } catch (err) { console.error(err); toast('The load sheet could not be made', { error: true }); }
  btn.disabled = false;
}

export function truckView() {
  if (!state.trucks.length) {
    return h('section', null, h('h1', null, 'On the truck'),
      emptyState('Add your truck first', 'TankDue keeps a running total of what each truck is carrying until you record where it was dumped.', h('a', { class: 'btn primary', href: '#/settings/trucks' }, 'Add a truck')));
  }
  const cards = state.trucks.map((truck) => {
    const l = truckLoad(truck, state.jobs);
    const jobs = [...l.open].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
    return h('section', { class: 'truckcard' },
      h('h2', null, truckLabel(truck)),
      h('p', { class: 'truck-total' }, h('strong', null, formatGallons(l.total)), l.capacity ? ` of ${formatGallons(l.capacity)} gallons` : ' gallons on board'),
      l.capacity ? gauge(l.percent, `${l.percent} percent full`) : h('p', { class: 'hint' }, h('a', { href: '#/settings/trucks' }, 'Add this truck’s tank size'), ' to see how full it is.'),
      l.warnings.map((w) => h('div', { class: 'notice warn' }, w)),
      jobs.length
        ? [h('ul', { class: 'rows' }, jobs.map((j) => h('li', null, h('a', { href: `#/record/${j.id}` },
          h('span', { class: 'row-main' }, j.snapshot?.customer?.name || 'Unknown customer'),
          h('span', { class: 'row-sub' }, formatDate(j.date), ', ', wasteName(j.wasteType).split(' (')[0].toLowerCase()),
          h('span', { class: 'row-count' }, formatGallons(gallons(j.gallons)) + ' gal'))))),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: `#/dispose/${truck.id}` }, 'Record the disposal'),
          h('button', { class: 'btn', onClick: (e) => loadSheet(e.currentTarget, truck, jobs, null) }, 'Load sheet (PDF)'))]
        : h('p', { class: 'quiet' }, 'Empty. Pump-outs you record with this truck show up here until you record the disposal.'));
  });
  // Pickups whose truck was removed from Settings must never vanish from view.
  const orphans = state.jobs.filter((j) => !j.loadId && !state.trucks.some((t) => t.id === j.truckId));
  if (orphans.length) {
    cards.push(h('section', { class: 'truckcard' },
      h('h2', null, 'Truck no longer on file'),
      h('div', { class: 'notice warn' }, 'These pickups were recorded on a truck that has since been removed. Open each one, choose "Correct this record" and pick the truck it is on, then record the disposal.'),
      h('ul', { class: 'rows' }, orphans.map((j) => h('li', null, h('a', { href: `#/record/${j.id}` },
        h('span', { class: 'row-main' }, j.snapshot?.customer?.name || 'Unknown customer'),
        h('span', { class: 'row-sub' }, formatDate(j.date), ', ', j.snapshot?.truck?.name || 'unknown truck'),
        h('span', { class: 'row-count' }, formatGallons(gallons(j.gallons)) + ' gal')))))));
  }
  const loads = [...state.loads].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0))).slice(0, 30);
  return h('section', null,
    h('h1', null, 'On the truck'),
    cards,
    h('h2', null, 'Recent disposals'),
    loads.length
      ? h('ul', { class: 'rows' }, loads.map((l) => {
        const jobs = state.jobs.filter((j) => j.loadId === l.id);
        const total = jobs.reduce((n, j) => n + (gallons(j.gallons) || 0), 0);
        return h('li', null, h('a', { href: `#/load/${l.id}` },
          h('span', { class: 'row-main' }, l.snapshot?.facility?.name || 'Receiving facility'),
          h('span', { class: 'row-sub' }, formatDate(l.date), ', ', l.snapshot?.truck?.name || 'truck', `, ${jobs.length} ${jobs.length === 1 ? 'pickup' : 'pickups'}`),
          h('span', { class: 'row-count' }, formatGallons(total) + ' gal')));
      }))
      : h('p', { class: 'quiet' }, 'No disposals recorded yet.'));
}

export function disposeView(truckId) {
  const truck = byId('trucks', truckId);
  if (!truck) return missing('That truck is no longer here.', '#/truck', 'On the truck');
  const l = truckLoad(truck, state.jobs);
  if (!l.open.length) return h('section', null, backLink('#/truck', 'On the truck'), h('h1', null, 'Nothing to dispose of'), h('p', null, `${truckLabel(truck)} has no pump-outs on board.`));
  if (!state.facilities.length) {
    return h('section', null, backLink('#/truck', 'On the truck'), h('h1', null, 'Add where you dispose first'),
      h('p', null, 'Each disposal names the receiving facility and its permit number. Add the plants or sites you use once.'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/settings/facilities' }, 'Add a receiving facility')));
  }
  const now = new Date();
  const d = {
    facilityId: byId('facilities', state.settings.lastFacilityId) ? state.settings.lastFacilityId : state.facilities[0].id,
    date: todayISO(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    gallons: '', receiptNo: '', rep: '', notes: '',
  };
  const included = new Set(l.open.map((j) => j.id));
  const error = h('p', { class: 'form-error', role: 'alert' });
  const totalEl = h('strong', null);
  const refresh = () => { totalEl.textContent = formatGallons(l.open.filter((j) => included.has(j.id)).reduce((n, j) => n + (gallons(j.gallons) || 0), 0)) + ' gallons'; };
  refresh();
  let saving = false;
  const save = async (e) => {
    e.preventDefault();
    if (saving) return; // a second tap must not make a second disposal
    error.textContent = '';
    const chosen = l.open.filter((j) => included.has(j.id));
    if (!chosen.length) { error.textContent = 'Tick at least one pickup that was dumped.'; return; }
    if (!isISODate(d.date) || d.date > todayISO()) { error.textContent = 'Enter the date of the disposal. It cannot be in the future.'; return; }
    // Check against the records as they are now, not as they were when this form opened.
    const live = chosen.map((j) => byId('jobs', j.id)).filter(Boolean);
    if (live.length !== chosen.length || live.some((j) => j.loadId)) { error.textContent = 'This load changed while the form was open. Go back to the truck and start again.'; return; }
    const latest = live.map((j) => j.date).sort().pop();
    if (d.date < latest) { error.textContent = `The disposal date is before a pickup on this load (${formatDate(latest)}). Check the dates.`; return; }
    if (d.gallons !== '' && gallons(d.gallons) === null) { error.textContent = 'Enter the gallons the facility measured as a number, or leave it blank.'; return; }
    const facility = byId('facilities', d.facilityId);
    if (!facility) { error.textContent = 'Choose the receiving facility.'; return; }
    const load = {
      truckId: truck.id, facilityId: facility.id, date: d.date, time: d.time,
      gallons: d.gallons === '' ? '' : String(gallons(d.gallons)), receiptNo: d.receiptNo.trim(), rep: d.rep.trim(), notes: d.notes.trim(),
      snapshot: { facility: { ...facility }, truck: { ...truck } }, createdAt: Date.now(),
    };
    saving = true;
    let saved;
    try {
      saved = await commitDisposal(load, live.map((j) => j.id));
    } catch (err) {
      console.error(err);
      saving = false;
      error.textContent = /already been recorded|no longer exists/.test(String(err && err.message)) ? err.message : 'The disposal did not save, and nothing was changed. Storage on this device may be full or blocked.';
      return;
    }
    try { state.settings.lastFacilityId = facility.id; await saveSettings('lastFacilityId'); } catch (err) { console.warn(err); }
    toast('Disposal recorded');
    navigate(`/load/${saved.id}`);
  };
  return h('section', null, backLink('#/truck', 'On the truck'), h('h1', null, 'Record the disposal'),
    h('p', { class: 'subject' }, h('strong', null, truckLabel(truck)), h('br'), 'Dumping ', totalEl),
    h('form', { onSubmit: save, novalidate: true },
      field('Receiving facility', d, 'facilityId', { options: state.facilities.map((f) => [f.id, [f.name, f.permitNo ? 'permit ' + f.permitNo : ''].filter(Boolean).join(', ')]) }),
      h('div', { class: 'grid2' }, field('Date', d, 'date', { type: 'date' }), field('Time', d, 'time', { type: 'time', optional: true })),
      h('div', { class: 'grid2' },
        field('Facility receipt or ticket number', d, 'receiptNo', { optional: true }),
        field('Gallons measured by the facility', d, 'gallons', { optional: true, inputmode: 'numeric', hint: 'If the plant meters the load.' })),
      field('Received by (facility representative)', d, 'rep', { optional: true }),
      h('fieldset', null, h('legend', null, 'Pickups dumped'),
        h('p', { class: 'hint' }, 'Untick any pickup that stayed on the truck.'),
        l.open.map((j) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: true, onChange: (e) => { if (e.currentTarget.checked) included.add(j.id); else included.delete(j.id); refresh(); } }),
          h('span', null, h('strong', null, j.snapshot?.customer?.name || 'Unknown customer'), `, ${formatDate(j.date)}, ${formatGallons(gallons(j.gallons))} gallons`)))),
      field('Notes', d, 'notes', { multiline: true, rows: 2, optional: true }),
      error,
      h('div', { class: 'row' }, h('button', { class: 'btn primary big', type: 'submit' }, 'Save disposal'))));
}

export function loadView(id) {
  const load = byId('loads', id);
  if (!load) return missing('That disposal is no longer here.', '#/truck', 'On the truck');
  const jobs = state.jobs.filter((j) => j.loadId === id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = jobs.reduce((n, j) => n + (gallons(j.gallons) || 0), 0);
  const f = load.snapshot?.facility || {};
  const truck = load.snapshot?.truck || {};
  const measured = gallons(load.gallons);
  return h('section', null, backLink('#/truck', 'On the truck'),
    h('div', { class: 'stamp' }, h('strong', null, formatGallons(total) + ' gallons'), h('span', null, `Disposed ${formatDate(load.date)}${load.time ? ' at ' + load.time : ''}`)),
    measured !== null && Math.abs(measured - total) > Math.max(50, total * 0.1)
      ? h('div', { class: 'notice warn' }, `The facility measured ${formatGallons(measured)} gallons; the pickups add up to ${formatGallons(total)}. Check the gallons on each job.`) : null,
    h('dl', { class: 'facts' },
      fact('Receiving facility', f.name), fact('Permit or registration no.', f.permitNo), fact('Method', f.method), fact('Address', f.address),
      fact('Truck', truckLabel(truck)), fact('Facility receipt', load.receiptNo), fact('Gallons measured', measured !== null ? formatGallons(measured) : ''),
      fact('Received by', load.rep), fact('Notes', load.notes)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: (e) => loadSheet(e.currentTarget, truck, jobs, load) }, 'Load sheet (PDF)')),
    h('h2', null, 'Pickups on this load'),
    jobs.length ? h('ul', { class: 'rows' }, jobs.map((j) => h('li', null, h('a', { href: `#/record/${j.id}` },
      h('span', { class: 'row-main' }, j.snapshot?.customer?.name || 'Unknown customer'),
      h('span', { class: 'row-sub' }, formatDate(j.date), siteOf(j.snapshot?.customer, j.snapshot?.tank).city ? ', ' + siteOf(j.snapshot?.customer, j.snapshot?.tank).city : ''),
      h('span', { class: 'row-count' }, formatGallons(gallons(j.gallons)) + ' gal'))))) : h('p', { class: 'quiet' }, 'No pickups are attached to this disposal.'),
    h('div', { class: 'row' }, h('button', {
      class: 'btn small danger ghost',
      onClick: async () => {
        if (!(await confirmDialog({ title: 'Undo this disposal?', body: 'The pickups go back on the truck so you can record the disposal again correctly.', confirm: 'Undo disposal', danger: true }))) return;
        try { await undoDisposal(id); } catch (err) { console.error(err); toast('That did not save, and nothing was changed. Storage on this device may be full or blocked.', { error: true }); return; }
        toast('Disposal undone');
        navigate('/truck');
      },
    }, 'Undo this disposal')));
}
