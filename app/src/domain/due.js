// Date helpers and the reminder template.

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(fromISO, toISO) {
  const a = Date.UTC(...isoParts(fromISO));
  const b = Date.UTC(...isoParts(toISO));
  return Math.round((b - a) / 86400000);
}

function isoParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso) {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : ym || '';
}

/** Fill a reminder template. Unknown placeholders are left untouched. */
export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values && values[k] != null ? String(values[k]) : m));
}

export const DEFAULT_REMINDER = {
  subject: 'Time to pump the {tank} at {address}',
  body: `Hello {customer},

Our records show the {tank} at {address} was last pumped on {last}. It is due again around {due}.

Pumping on schedule keeps solids out of the drainfield, which is the expensive part of the system. Reply to this message or call {phone} and we will set a day that suits you.

Thank you,
{company}`,
};
