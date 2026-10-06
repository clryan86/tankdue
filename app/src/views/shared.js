import { h } from '../dom.js';
import { state, byId } from '../store.js';
import { standing, dueLabel, formatGallons, gallons, siteLine } from '../domain/service.js';
import { formatDate } from '../domain/due.js';

export function customerAddress(c, tank) {
  return siteLine(c, tank);
}

export function tankLine(t) {
  const cap = gallons(t.capacity);
  return [cap ? formatGallons(cap) + ' gal' : '', (t.kind || 'Tank').toLowerCase()].filter(Boolean).join(' ');
}

export function tankStanding(t) {
  return standing(t, state.jobs.filter((j) => j.tankId === t.id), state.settings.defaults);
}

/** The card used wherever a tank's due date is shown. */
export function dueCard(t, s, { actions = [], href } = {}) {
  const c = byId('customers', t.customerId);
  const big = s.due ? shortDate(s.due) : s.status === 'oncall' ? 'On call' : 'New';
  const year = s.due ? s.due.slice(0, 4) : '';
  const body = h(href ? 'a' : 'div', { class: 'tag-body', href },
    h('div', { class: 'tag-date' }, h('strong', null, big), year ? h('span', null, year) : null),
    h('div', { class: 'tag-info' },
      h('p', { class: 'tag-status' }, dueLabel(s)),
      h('p', { class: 'tag-name' }, c ? c.name : 'Unknown customer'),
      h('p', { class: 'tag-meta' }, customerAddress(c, t)),
      h('p', { class: 'tag-meta' }, tankLine(t), s.lastDate ? `, last pumped ${formatDate(s.lastDate)}` : '')));
  return h('li', { class: `tag ${s.status}` }, body, actions.length ? h('div', { class: 'tag-actions' }, actions) : null);
}

function shortDate(iso) {
  const full = formatDate(iso);
  return full ? full.split(',')[0] : '';
}

export function backLink(href, label) {
  return h('a', { class: 'back', href }, '‹ ' + label);
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h2', null, title), h('p', null, text), h('div', { class: 'row' }, actions));
}

export function fact(label, value, href) {
  if (value === '' || value === null || value === undefined) return null;
  return [h('dt', null, label), h('dd', null, href ? h('a', { href }, value) : value)];
}

export function missing(text, href, label) {
  return h('section', null, backLink(href, label), h('p', null, text));
}

/** A search box that keeps focus across re-renders. */
export function searchBox(value, placeholder, onInput) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder, value });
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    onInput(input.value);
    const again = document.querySelector('.searchbar input');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  return input;
}

/** A horizontal fill gauge, used for what is on a truck. */
export function gauge(percent, label) {
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const bar = h('div', { class: 'gauge-fill' + (p >= 100 ? ' full' : p >= 85 ? ' high' : '') });
  bar.style.width = p + '%';
  return h('div', { class: 'gauge', role: 'img', 'aria-label': label }, bar);
}

/** Two- or three-way choice shown as joined buttons; behaves as a radio group. */
export function segmented(options, current, onChange, groupLabel) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': groupLabel });
  const buttons = options.map(([value, label]) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      const next = b.classList.contains('on') ? null : value;
      buttons.forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      if (next !== null) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
      onChange(next);
    });
    return b;
  });
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length];
    next.focus();
    if (!next.classList.contains('on')) next.click();
  });
  wrap.append(...buttons);
  return wrap;
}

export function signaturePad(initial, onChange, label) {
  const canvas = h('canvas', { class: 'sigpad', width: 900, height: 270, 'aria-label': label, role: 'img' });
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13212C';
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  const end = () => { if (!drawing) return; drawing = false; onChange(canvas.toDataURL('image/png')); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const load = (dataUrl) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = dataUrl;
  };
  if (initial) load(initial);
  return { el: canvas, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); onChange(''); }, load };
}

export function trialNote(e) {
  if (e.mode === 'licensed') return null;
  if (e.mode === 'trial') {
    if (e.left > 5) return null;
    return h('div', { class: 'notice' }, `Free trial: ${e.left} ${e.left === 1 ? 'job' : 'jobs'} left. `, h('a', { href: '#/settings/licence' }, 'Enter a licence key'));
  }
  return h('div', { class: 'notice warn' },
    e.mode === 'expired' ? 'Your licence has ended. ' : 'The free trial is used up. ',
    'Your records stay available and you can still export them. ',
    h('a', { href: '#/settings/licence' }, 'Enter a licence key'), ' to record new jobs.');
}
