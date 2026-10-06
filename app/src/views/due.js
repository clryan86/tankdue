import { h, sheet, toast, phoneDigits, mailAddress } from '../dom.js';
import { state, byId, put } from '../store.js';
import { compareStanding } from '../domain/service.js';
import { formatDate, fillTemplate, todayISO } from '../domain/due.js';
import { rerender, currentEntitlement } from '../nav.js';
import { dueCard, tankStanding, customerAddress, tankLine, emptyState, searchBox, trialNote } from './shared.js';
import { loadSampleData } from '../sample.js';

let filter = 'attention';
let query = '';

export function dueView() {
  const rows = state.tanks.filter((t) => t.active !== false).map((t) => ({ t, s: tankStanding(t) }));
  rows.sort((x, y) => compareStanding(x.s, y.s));

  if (!state.customers.length) {
    return h('section', null,
      h('h1', null, 'Nobody is due yet'),
      emptyState('Start with your customers',
        'Add a customer and their tank, or bring in the list you already keep. TankDue then shows who is due for a pump-out and when.',
        h('a', { class: 'btn primary', href: '#/customer/new' }, 'Add a customer'),
        h('a', { class: 'btn', href: '#/settings/data' }, 'Import a spreadsheet'),
        h('button', { class: 'btn ghost', onClick: async () => { await loadSampleData(); toast('Sample records loaded'); rerender(); } }, 'Look around with sample records')));
  }

  const count = (st) => rows.filter((r) => r.s.status === st).length;
  const chips = [
    ['attention', 'Call now', count('overdue') + count('soon')],
    ['overdue', 'Overdue', count('overdue')],
    ['soon', 'Next 30 days', count('soon')],
    ['upcoming', '31 to 60 days', count('upcoming')],
    ['unknown', 'No date yet', count('unknown')],
    ['all', 'All', rows.length],
  ];
  const inFilter = (r) => (filter === 'all' ? true : filter === 'attention' ? ['overdue', 'soon'].includes(r.s.status) : r.s.status === filter);
  const q = query.trim().toLowerCase();
  const matches = (r) => {
    if (!q) return true;
    const c = byId('customers', r.t.customerId);
    return [c?.name, c?.address, c?.city, c?.phone, r.t.serviceAddress, r.t.serviceCity, r.t.county, c?.county].some((v) => v && v.toLowerCase().includes(q));
  };
  const shown = rows.filter((r) => inFilter(r) && matches(r));

  return h('section', null,
    setupNudge(),
    trialNote(currentEntitlement()),
    h('h1', null, 'Who is due'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, chips.map(([id, label, n]) =>
      h('button', { class: 'chip' + (filter === id ? ' on' : '') + (id === 'overdue' && n ? ' alert' : ''), 'aria-pressed': String(filter === id), onClick: () => { filter = id; rerender(); } }, label, ' ', h('b', null, n)))),
    h('div', { class: 'searchbar' }, searchBox(query, 'Search name, address, town or phone', (v) => { query = v; rerender(); })),
    shown.length
      ? h('ul', { class: 'tags' }, shown.map(({ t, s }) => dueCard(t, s, {
        href: `#/tank/${t.id}`,
        actions: [
          h('a', { class: 'btn primary small', href: `#/job/new/${t.id}` }, 'Record a pump-out'),
          s.due ? h('button', { class: 'btn small', onClick: () => remind(t, s) }, t.remindedOn ? 'Remind again' : 'Remind') : null,
          t.remindedOn ? h('span', { class: 'quiet small' }, `Reminded ${formatDate(t.remindedOn)}`) : null,
        ],
      })))
      : h('p', { class: 'quiet' }, q ? 'No tanks match that search.' : filter === 'attention' ? 'Nobody is overdue or due in the next 30 days.' : 'Nothing in this group.'));
}

function setupNudge() {
  const need = [];
  if (!state.settings.company.name) need.push(['your company details', '#/settings/company']);
  if (!state.drivers.length) need.push(['a driver', '#/settings/drivers']);
  if (!state.trucks.length) need.push(['your truck', '#/settings/trucks']);
  if (!state.facilities.length) need.push(['where you dispose', '#/settings/facilities']);
  if (!need.length) return null;
  return h('div', { class: 'notice' }, h('strong', null, 'Finish setting up. '), 'Records need ',
    need.map(([label, href], i) => [i ? (i === need.length - 1 ? ' and ' : ', ') : '', h('a', { href }, label)]), '.');
}

function remind(t, s) {
  const c = byId('customers', t.customerId) || {};
  const co = state.settings.company;
  const values = {
    customer: c.contact || c.name || '', address: customerAddress(c, t), tank: (t.kind || 'tank').toLowerCase(),
    last: formatDate(s.lastDate), due: formatDate(s.due), company: co.name || '', phone: co.phone || '',
  };
  const subject = h('input', { type: 'text', value: fillTemplate(state.settings.reminder.subject, values), 'aria-label': 'Subject' });
  const body = h('textarea', { rows: 10, 'aria-label': 'Message' });
  body.value = fillTemplate(state.settings.reminder.body, values);
  const mark = async () => { t.remindedOn = todayISO(); await put('tanks', t); };
  const mailto = () => `mailto:${mailAddress(c.email)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
  const phone = phoneDigits(c.phone);
  const sms = () => `sms:${phone}?&body=${encodeURIComponent(body.value)}`;
  const dlg = sheet('Remind ' + (c.name || 'customer'),
    h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Subject'), subject),
      h('div', { class: 'field' }, h('label', null, 'Message'), body),
      !c.email && !phone ? h('p', { class: 'hint' }, 'This customer has no email or phone on file. Copy the message, or add their details first.') : null,
      h('div', { class: 'row' },
        c.email ? h('a', { class: 'btn primary', href: mailto(), onClick: async (e) => { e.currentTarget.href = mailto(); await mark(); dlg.close(); rerender(); } }, 'Open in email') : null,
        phone ? h('a', { class: 'btn' + (c.email ? '' : ' primary'), href: sms(), onClick: async (e) => { e.currentTarget.href = sms(); await mark(); dlg.close(); rerender(); } }, 'Send as text') : null,
        phone ? h('a', { class: 'btn', href: `tel:${phone}`, onClick: async () => { await mark(); dlg.close(); rerender(); } }, 'Call ' + c.phone) : null,
        h('button', {
          class: 'btn',
          onClick: async () => {
            try { await navigator.clipboard.writeText(subject.value + '\n\n' + body.value); toast('Message copied'); } catch { toast('Copying is blocked in this browser'); return; }
            await mark(); dlg.close(); rerender();
          },
        }, 'Copy message')),
      t.remindedOn ? h('p', { class: 'hint' }, `Last reminded ${formatDate(t.remindedOn)}.`) : null,
      h('p', { class: 'hint' }, 'Tank description: ', tankLine(t), '.')));
}
