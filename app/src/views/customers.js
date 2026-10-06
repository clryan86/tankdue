import { h, field, toast, confirmDialog, phoneDigits, mailAddress } from '../dom.js';
import { state, byId, put, remove } from '../store.js';
import { siteLine } from '../domain/service.js';
import { TANK_KINDS, compareStanding, suggestIntervalMonths, intervalFor, formatGallons, gallons } from '../domain/service.js';
import { formatDate, isISODate, todayISO } from '../domain/due.js';
import { navigate, rerender } from '../nav.js';
import { dueCard, tankStanding, backLink, emptyState, tankLine, fact, missing, searchBox } from './shared.js';

let query = '';

export function customersView() {
  const q = query.trim().toLowerCase();
  const list = [...state.customers]
    .filter((c) => !q || [c.name, c.contact, c.address, c.city, c.county, c.email, c.phone].some((v) => v && v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return h('section', null,
    h('div', { class: 'row between' }, h('h1', null, 'Customers'), h('a', { class: 'btn primary', href: '#/customer/new' }, 'Add a customer')),
    state.customers.length ? h('div', { class: 'searchbar' }, searchBox(query, 'Search customers', (v) => { query = v; rerender(); })) : null,
    !state.customers.length
      ? emptyState('No customers yet', 'Add one by hand, or import the list you already have.', h('a', { class: 'btn', href: '#/settings/data' }, 'Import a spreadsheet'))
      : list.length
        ? h('ul', { class: 'rows' }, list.map((c) => {
          const n = state.tanks.filter((t) => t.customerId === c.id && t.active !== false).length;
          return h('li', null, h('a', { href: `#/customer/${c.id}` },
            h('span', { class: 'row-main' }, c.name),
            h('span', { class: 'row-sub' }, [c.address, c.city].filter(Boolean).join(', ')),
            h('span', { class: 'row-count' }, n === 1 ? '1 tank' : `${n} tanks`)));
        }))
        : h('p', { class: 'quiet' }, 'No customers match that search.'));
}

export function customerView(id) {
  const c = byId('customers', id);
  if (!c) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const rows = state.tanks.filter((t) => t.customerId === id).map((t) => ({ t, s: tankStanding(t) }));
  rows.sort((x, y) => compareStanding(x.s, y.s));
  return h('section', null,
    backLink('#/customers', 'Customers'),
    h('div', { class: 'row between' }, h('h1', null, c.name), h('a', { class: 'btn small', href: `#/customer/${id}/edit` }, 'Edit')),
    h('dl', { class: 'facts' },
      fact('Contact', c.contact),
      fact('Phone', c.phone, phoneDigits(c.phone) ? `tel:${phoneDigits(c.phone)}` : null),
      fact('Email', c.email, c.email ? `mailto:${mailAddress(c.email)}` : null),
      fact('Address', [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')),
      fact('County', c.county),
      fact('Notes', c.notes)),
    h('div', { class: 'row between' }, h('h2', null, 'Tanks'), h('a', { class: 'btn primary small', href: `#/tank/new/${id}` }, 'Add a tank')),
    rows.length
      ? h('ul', { class: 'tags' }, rows.map(({ t, s }) => dueCard(t, s, {
        href: `#/tank/${t.id}`,
        actions: t.active === false ? [h('span', { class: 'quiet' }, 'No longer serviced')] : [h('a', { class: 'btn primary small', href: `#/job/new/${t.id}` }, 'Record a pump-out')],
      })))
      : h('p', { class: 'quiet' }, 'No tanks on file for this customer yet.'));
}

export function customerEditView(id) {
  const existing = id ? byId('customers', id) : null;
  if (id && !existing) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const c = existing ? { ...existing } : { name: '', contact: '', email: '', phone: '', address: '', city: '', state: '', zip: '', county: '', notes: '' };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const save = async (e) => {
    e.preventDefault();
    c.name = c.name.trim();
    if (!c.name) { error.textContent = 'Enter the customer or business name.'; return; }
    c.email = (c.email || '').trim();
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) { error.textContent = 'That email address does not look right.'; return; }
    let saved;
    try { saved = await put('customers', c); } catch (err) { console.error(err); error.textContent = 'That did not save. Storage on this device may be full or blocked.'; return; }
    toast('Customer saved');
    navigate(existing ? `/customer/${saved.id}` : `/tank/new/${saved.id}`);
  };
  return h('section', null,
    backLink(existing ? `#/customer/${id}` : '#/customers', existing ? existing.name : 'Customers'),
    h('h1', null, existing ? 'Edit customer' : 'Add a customer'),
    h('form', { onSubmit: save, novalidate: true },
      field('Customer or business name', c, 'name', { required: true, autocomplete: 'organization' }),
      field('Contact person', c, 'contact', { optional: true }),
      h('div', { class: 'grid2' },
        field('Phone', c, 'phone', { type: 'tel', optional: true }),
        field('Email', c, 'email', { type: 'email', optional: true, hint: 'Used for pump-out reminders.' })),
      field('Street address', c, 'address', { optional: true }),
      h('div', { class: 'grid3' },
        field('City or town', c, 'city', { optional: true }),
        field('State', c, 'state', { optional: true, maxlength: 2 }),
        field('ZIP', c, 'zip', { optional: true, inputmode: 'numeric' })),
      field('County or township', c, 'county', { optional: true, hint: 'Some yearly reports total gallons by town or county.' }),
      field('Notes', c, 'notes', { multiline: true, optional: true, placeholder: 'Gate code, dog in yard, who to call first' }),
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save customer' : 'Save and add a tank'),
        existing ? h('button', {
          class: 'btn danger ghost', type: 'button',
          onClick: async () => {
            const tanks = state.tanks.filter((t) => t.customerId === id);
            const jobs = state.jobs.filter((j) => tanks.some((t) => t.id === j.tankId));
            if (jobs.length) {
              await confirmDialog({ title: 'This customer has pump-out records', body: `${jobs.length} saved ${jobs.length === 1 ? 'record belongs' : 'records belong'} to this customer. Hauling records generally have to be kept for five years, so the customer cannot be deleted. Mark their tanks as no longer serviced instead.`, confirm: 'OK' });
              return;
            }
            if (!(await confirmDialog({ title: `Delete ${existing.name}?`, body: tanks.length ? `Their ${tanks.length === 1 ? 'tank' : tanks.length + ' tanks'} will be deleted too.` : '', confirm: 'Delete customer', danger: true }))) return;
            for (const t of tanks) await remove('tanks', t.id);
            await remove('customers', id);
            toast('Customer deleted');
            navigate('/customers');
          },
        }, 'Delete customer') : null)));
}

export function tankView(id) {
  const t = byId('tanks', id);
  if (!t) return missing('That tank is no longer here.', '#/customers', 'Customers');
  const c = byId('customers', t.customerId);
  const s = tankStanding(t);
  const jobs = state.jobs.filter((j) => j.tankId === id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  return h('section', null,
    backLink(`#/customer/${t.customerId}`, c ? c.name : 'Customer'),
    h('div', { class: 'row between' }, h('h1', null, tankLine(t)), h('a', { class: 'btn small', href: `#/tank/${id}/edit` }, 'Edit')),
    h('ul', { class: 'tags' }, dueCard(t, s, {
      actions: t.active === false ? [h('span', { class: 'quiet' }, 'No longer serviced')] : [h('a', { class: 'btn primary', href: `#/job/new/${id}` }, 'Record a pump-out')],
    })),
    h('dl', { class: 'facts' },
      fact('Where it is', t.location),
      fact('Service address', t.serviceAddress ? siteLine(c, t, { zip: true }) : ''),
      fact('County or township', t.county),
      fact('Material', t.material),
      fact('Compartments', t.compartments),
      fact('People in the home', t.people),
      fact('Garbage disposal', t.garbageDisposal ? 'Yes' : ''),
      fact('Pump every', t.onCall ? 'On call only' : intervalFor(t, state.settings.defaults) === null ? 'Not set. Edit the tank to set how often it is pumped.' : `${intervalFor(t, state.settings.defaults)} months${t.intervalMonths ? '' : ' (your default)'}`),
      fact('Last pumped before TankDue', formatDate(t.lastPumpedImported))),
    h('h2', null, 'Pump-out history'),
    jobs.length
      ? h('ul', { class: 'rows' }, jobs.map((j) => h('li', null, h('a', { href: `#/record/${j.id}` },
        h('span', { class: 'row-main' }, formatDate(j.date)),
        h('span', { class: 'row-sub' }, [j.reason, j.snapshot?.driver?.name].filter(Boolean).join(', ')),
        h('span', { class: 'row-count' }, formatGallons(gallons(j.gallons)) + ' gal')))))
      : h('p', { class: 'quiet' }, 'No pump-outs recorded in TankDue yet.'));
}

function intervalPlaceholder(kind) {
  const m = intervalFor({ kind }, state.settings.defaults);
  return m === null ? 'Set for this tank' : String(m);
}

export function tankEditView(id, customerId) {
  const existing = id ? byId('tanks', id) : null;
  if (id && !existing) return missing('That tank is no longer here.', '#/customers', 'Customers');
  const custId = existing ? existing.customerId : customerId;
  const c = byId('customers', custId);
  if (!c) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const t = existing ? { ...existing } : {
    customerId: custId, kind: 'Septic tank', capacity: '', people: '', material: '', compartments: '',
    location: '', serviceAddress: '', serviceCity: '', serviceState: '', serviceZip: '', county: c.county || '', intervalMonths: '', lastPumpedImported: '',
    garbageDisposal: false, onCall: false, active: true,
  };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const suggestion = h('p', { class: 'hint', role: 'status' });
  const showSuggestion = () => {
    suggestion.replaceChildren();
    if (!['Septic tank', 'Cesspool'].includes(t.kind)) return;
    const cap = gallons(t.capacity);
    const m = suggestIntervalMonths({ capacity: cap, people: t.people, capMonths: state.settings.defaults.capMonths });
    if (m === null) { suggestion.textContent = 'Enter the tank size and the number of people for a suggested interval.'; return; }
    const use = h('button', { type: 'button', class: 'btn small', onClick: () => { t.intervalMonths = String(m); rerenderInterval(); } }, `Use ${m} months`);
    suggestion.append(`For a ${formatGallons(cap)} gallon tank and ${t.people} ${String(t.people) === '1' ? 'person' : 'people'}, a published extension table suggests about ${m} months${t.garbageDisposal ? ', and sooner with a garbage disposal' : ''}. `, use);
  };
  let intervalField = field('Pump every (months)', t, 'intervalMonths', { optional: true, inputmode: 'numeric', placeholder: intervalPlaceholder(t.kind) });
  const rerenderInterval = () => {
    const fresh = field('Pump every (months)', t, 'intervalMonths', { optional: true, inputmode: 'numeric', placeholder: intervalPlaceholder(t.kind) });
    intervalField.replaceWith(fresh);
    intervalField = fresh;
  };
  const save = async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (t.capacity !== '' && (gallons(t.capacity) === null || gallons(t.capacity) <= 0)) { error.textContent = 'Enter the tank size in gallons, such as 1000.'; return; }
    if (t.capacity !== '') t.capacity = String(gallons(t.capacity));
    if (t.people !== '' && !(Number.isInteger(Number(t.people)) && Number(t.people) >= 1 && Number(t.people) <= 99)) { error.textContent = 'The number of people must be a whole number.'; return; }
    if (t.intervalMonths !== '' && t.intervalMonths != null && !(Number.isInteger(Number(t.intervalMonths)) && Number(t.intervalMonths) >= 1 && Number(t.intervalMonths) <= 240)) {
      error.textContent = 'The interval must be a whole number of months from 1 to 240, or blank to use your default.'; return;
    }
    if (!t.serviceAddress || !t.serviceAddress.trim()) { t.serviceAddress = ''; t.serviceCity = ''; t.serviceState = ''; t.serviceZip = ''; }
    else if (!String(t.serviceCity || '').trim()) { error.textContent = 'Enter the town for the tank\u2019s address.'; return; }
    if (t.lastPumpedImported && (!isISODate(t.lastPumpedImported) || t.lastPumpedImported > todayISO())) { error.textContent = 'The last pumped date is not a real past date.'; return; }
    let saved;
    try { saved = await put('tanks', t); } catch (err) { console.error(err); error.textContent = 'That did not save. Storage on this device may be full or blocked.'; return; }
    toast('Tank saved');
    navigate(`/tank/${saved.id}`);
  };
  showSuggestion();
  return h('section', null,
    backLink(existing ? `#/tank/${id}` : `#/customer/${custId}`, existing ? 'Tank' : c.name),
    h('h1', null, existing ? 'Edit tank' : `Add a tank for ${c.name}`),
    h('form', { onSubmit: save, novalidate: true },
      field('What it is', t, 'kind', { options: TANK_KINDS.map((k) => k.name), onChange: () => { rerenderInterval(); showSuggestion(); } }),
      h('div', { class: 'grid2' },
        field('Size (gallons)', t, 'capacity', { inputmode: 'numeric', optional: true, placeholder: '1000', onChange: showSuggestion }),
        field('People in the home', t, 'people', { inputmode: 'numeric', optional: true, onChange: showSuggestion }),
        field('Material', t, 'material', { optional: true, options: [['', 'Not recorded'], 'Concrete', 'Plastic', 'Fiberglass', 'Steel', 'Brick or block'] }),
        field('Compartments', t, 'compartments', { optional: true, options: [['', 'Not recorded'], '1', '2', '3'] })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!t.garbageDisposal, onChange: (e) => { t.garbageDisposal = e.currentTarget.checked; showSuggestion(); } }), 'The home has a garbage disposal'),
      field('Where the tank and lid are', t, 'location', { multiline: true, rows: 2, optional: true, placeholder: '12 ft off the back porch, lid 8 in down, riser on outlet side' }),
      field('County or township', t, 'county', { optional: true }),
      h('details', { open: !!t.serviceAddress },
        h('summary', null, 'The tank is at a different address from the customer'),
        h('p', { class: 'hint' }, 'Fill this in when the bill goes to one place and the tank is at another. Records and yearly totals then use this town, not the billing address.'),
        field('Street address of the tank', t, 'serviceAddress', { optional: true }),
        h('div', { class: 'grid3' },
          field('City or town', t, 'serviceCity', { optional: true }),
          field('State', t, 'serviceState', { optional: true, maxlength: 2 }),
          field('ZIP', t, 'serviceZip', { optional: true, inputmode: 'numeric' }))),
      h('fieldset', null,
        h('legend', null, 'Schedule'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!t.onCall, onChange: (e) => { t.onCall = e.currentTarget.checked; } }), 'On call only. Do not list this tank as due.'),
        h('div', { class: 'grid2' },
          intervalField,
          field('Last pumped before TankDue', t, 'lastPumpedImported', { type: 'date', optional: true, hint: 'Sets the first due date.' })),
        suggestion),
      existing ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: t.active === false, onChange: (e) => { t.active = !e.currentTarget.checked; } }),
        'No longer serviced. Keep the history, stop listing it as due.') : null,
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save tank'),
        existing && !state.jobs.some((j) => j.tankId === id) ? h('button', {
          class: 'btn danger ghost', type: 'button',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Delete this tank?', body: 'It has no pump-out records, so nothing else is lost.', confirm: 'Delete tank', danger: true }))) return;
            await remove('tanks', id);
            toast('Tank deleted');
            navigate(`/customer/${custId}`);
          },
        }, 'Delete tank') : null)));
}
