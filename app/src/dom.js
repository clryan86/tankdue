// Tiny DOM helper. Text is always set as text, never parsed as HTML.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'required' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace an element's children, ignoring null and false. */
export function setChildren(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A labelled input bound to obj[key]. */
export function field(label, obj, key, opts = {}) {
  const id = 'f_' + key + '_' + Math.random().toString(36).slice(2, 7);
  const common = {
    id,
    name: key,
    placeholder: opts.placeholder,
    required: opts.required,
    autocomplete: opts.autocomplete || 'off',
    inputmode: opts.inputmode,
    maxlength: opts.maxlength,
  };
  let input;
  if (opts.options) {
    input = h('select', common, opts.options.map((o) => {
      const [value, text] = Array.isArray(o) ? o : [o, o];
      return h('option', { value, selected: String(obj[key] ?? '') === String(value) }, text);
    }));
    // If the stored value is not among the options, the browser shows the first
    // option; make the data agree with what is on screen.
    if (String(obj[key] ?? '') !== input.value) obj[key] = input.value;
    input.addEventListener('change', () => { obj[key] = input.value; opts.onChange && opts.onChange(input.value); });
  } else if (opts.multiline) {
    input = h('textarea', { ...common, rows: opts.rows || 3 });
    input.value = obj[key] ?? '';
    input.addEventListener('input', () => { obj[key] = input.value; opts.onChange && opts.onChange(input.value); });
  } else {
    input = h('input', { ...common, type: opts.type || 'text' });
    input.value = obj[key] ?? '';
    input.addEventListener('input', () => { obj[key] = input.value; opts.onChange && opts.onChange(input.value); });
  }
  return h('div', { class: 'field' + (opts.half ? ' half' : '') },
    h('label', { for: id }, label, opts.optional ? h('span', { class: 'opt' }, ' optional') : null),
    input,
    opts.hint ? h('p', { class: 'hint' }, opts.hint) : null);
}

let toastTimer;
/** A brief confirmation. Pass { error: true } for a failure: it stays until tapped. */
export function toast(message, { error = false } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    t.addEventListener('click', () => t.classList.remove('show'));
    document.body.appendChild(t);
  }
  t.textContent = error ? message + ' Tap to close.' : message;
  t.classList.toggle('error', error);
  t.setAttribute('role', error ? 'alert' : 'status');
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (!error) toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** The first phone number in a free-text field, as digits for a tel: or sms: link. '' if none. */
export function phoneDigits(text) {
  const m = /\+?\d[\d\s().-]{5,}\d/.exec(String(text || ''));
  if (!m) return '';
  const digits = m[0].replace(/[^\d+]/g, '');
  return digits.replace(/(?!^)\+/g, '');
}

/** A mailto: address part. Encodes anything that could add headers, but leaves the @ readable for mail apps. */
export function mailAddress(email) {
  return encodeURIComponent(String(email || '').trim()).replace(/%40/g, '@');
}

/** In-page confirmation. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'sheet' },
      h('h2', null, title),
      body ? h('p', null, body) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onClick: () => { dlg.close(); dlg.remove(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { dlg.close(); dlg.remove(); resolve(true); } }, confirm)));
    dlg.addEventListener('cancel', () => { dlg.remove(); resolve(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** A bottom sheet with arbitrary content. Returns the dialog; call .close() to dismiss. */
export function sheet(title, content) {
  const dlg = h('dialog', { class: 'sheet' },
    h('div', { class: 'row between' },
      h('h2', null, title),
      h('button', { class: 'btn ghost small', 'aria-label': 'Close', onClick: () => dlg.close() }, 'Close')),
    content);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

export function download(filename, bytesOrText, mime) {
  const blob = bytesOrText instanceof Blob ? bytesOrText : new Blob([bytesOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
