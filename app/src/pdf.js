// Builds the pumping record, the load sheet and the period summary as PDFs on the device.
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';
import { formatDate, formatMonth } from './domain/due.js';
import { wasteName, formatGallons, gallons, siteOf, siteLine } from './domain/service.js';

const INK = rgb(0.075, 0.13, 0.15);
const MUTED = rgb(0.35, 0.42, 0.45);
const LINE = rgb(0.78, 0.82, 0.84);
const BAND = rgb(0.935, 0.955, 0.95);

// The built-in PDF fonts cover Windows-1252 only. Swap common typographic
// characters and replace anything else so a stray character can never break a document.
export function safeText(v) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[\t\r]/g, ' ');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) out += ch;
    else out += '?';
  }
  return out;
}

function slug(v, max = 40) {
  return String(v || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);
}

export function jobFilename(job) {
  return `pumping-record-${job.date}-${slug(job.snapshot?.customer?.name) || 'job'}.pdf`;
}

async function kit(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(safeText(title));
  doc.setCreator('TankDue');
  doc.setProducer('TankDue');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 42;
  const k = { doc, font, bold, W, H, M, page: doc.addPage([W, H]), y: H - M };

  k.text = (str, x, yy, size = 9.5, f = font, color = INK) => k.page.drawText(safeText(str), { x, y: yy, size, font: f, color });
  k.fit = (str, f, size, maxW) => {
    let s = safeText(str).replace(/\n/g, ' ');
    if (f.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + '...', size) > maxW) s = s.slice(0, -1);
    return s + '...';
  };
  k.wrap = (str, f, size, maxW) => {
    const lines = [];
    for (const para of safeText(str).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        while (f.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const trial = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(trial, size) > maxW && line) { lines.push(line); line = w; } else line = trial;
      }
      lines.push(line);
    }
    return lines;
  };
  k.need = (h) => { if (k.y - h < M + 14) { k.page = doc.addPage([W, H]); k.y = H - M; } };
  k.section = (label) => {
    k.need(40);
    k.y -= 2;
    k.page.drawRectangle({ x: M, y: k.y - 14, width: W - 2 * M, height: 16, color: BAND });
    k.text(label, M + 6, k.y - 10, 9.5, bold);
    k.y -= 21;
  };
  // Label/value pairs in columns. Long values wrap and the row grows; nothing is cut off.
  k.grid = (pairs, cols = 3) => {
    const colW = (W - 2 * M) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const cells = pairs.slice(i, i + cols).map(([label, value]) => ({ label, lines: k.wrap(value || '-', font, 9.5, colW - 12).slice(0, 6) }));
      const height = 11 + Math.max(...cells.map((c) => c.lines.length)) * 11;
      k.need(height);
      cells.forEach((c, ci) => {
        const x = M + ci * colW + 6;
        k.text(c.label, x, k.y, 7.5, font, MUTED);
        c.lines.forEach((line, li) => k.text(line, x, k.y - 11 - li * 11, 9.5));
      });
      k.y -= height;
    }
  };
  k.para = (str, size = 10, color = INK) => {
    for (const l of k.wrap(str, font, size, W - 2 * M - 12)) { k.need(size + 3); k.text(l, M + 6, k.y, size, font, color); k.y -= size + 3; }
  };
  k.header = (company, docTitle, rightLines = []) => {
    k.text(k.fit(company.name || 'Septic service', bold, 15, 340), M, k.y - 6, 15, bold);
    const lines = [company.address, company.cityStateZip, [company.phone, company.email].filter(Boolean).join('   '), company.registration ? 'Registration / licence no. ' + company.registration : ''].filter(Boolean);
    let cy = k.y - 20;
    for (const l of lines) { k.text(k.fit(l, font, 8.5, 340), M, cy, 8.5, font, MUTED); cy -= 11; }
    let ry = k.y - 6;
    for (const [l, big] of rightLines) {
      const f = big ? bold : font, size = big ? 13 : 9;
      const s = safeText(l);
      k.text(s, W - M - f.widthOfTextAtSize(s, size), ry, size, f, big ? INK : MUTED);
      ry -= big ? 16 : 12;
    }
    k.y = Math.min(cy, ry) - 8;
    k.text(docTitle, M, k.y, 12, bold);
    k.y -= 6;
    k.page.drawLine({ start: { x: M, y: k.y }, end: { x: W - M, y: k.y }, thickness: 1, color: INK });
    k.y -= 12;
  };
  // A table with a header row. cols: [{label, width, align}], rows: arrays of strings.
  k.table = (cols, rows, { boldLast = false } = {}) => {
    const drawHead = () => {
      let x = M + 6;
      for (const c of cols) {
        const s = safeText(c.label);
        k.text(s, c.align === 'right' ? x + c.width - 8 - font.widthOfTextAtSize(s, 7.5) : x, k.y, 7.5, font, MUTED);
        x += c.width;
      }
      k.y -= 5;
      k.page.drawLine({ start: { x: M, y: k.y }, end: { x: W - M, y: k.y }, thickness: 0.5, color: LINE });
      k.y -= 13;
    };
    k.need(34);
    drawHead();
    rows.forEach((row, ri) => {
      const f = boldLast && ri === rows.length - 1 ? bold : font;
      const cells = cols.map((c, ci) => (c.align === 'right' ? [k.fit(row[ci] ?? '', f, 9.5, c.width - 10)] : k.wrap(String(row[ci] ?? ''), f, 9.5, c.width - 10).slice(0, 4)));
      const height = 3 + Math.max(...cells.map((l) => l.length)) * 11;
      if (k.y - height < M + 14) { k.page = doc.addPage([W, H]); k.y = H - M; drawHead(); }
      let x = M + 6;
      cols.forEach((c, ci) => {
        cells[ci].forEach((line, li) => {
          k.text(line, c.align === 'right' ? x + c.width - 8 - f.widthOfTextAtSize(line, 9.5) : x, k.y - li * 11, 9.5, f);
        });
        x += c.width;
      });
      k.y -= height;
    });
    k.y -= 4;
  };
  k.signature = async (dataUrl, x, top, maxW = 180, maxH = 34) => {
    if (!dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return;
    try {
      const png = await doc.embedPng(dataUrl);
      const scale = Math.min(maxW / png.width, maxH / png.height);
      k.page.drawImage(png, { x, y: top - maxH, width: png.width * scale, height: png.height * scale });
    } catch { /* an unreadable signature leaves the line blank for a wet signature */ }
  };
  k.finish = (companyName, tag) => {
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(safeText(`${companyName || ''}   ${tag}   Page ${i + 1} of ${pages.length}`), { x: M, y: 24, size: 7.5, font, color: MUTED });
      p.drawText('Prepared with TankDue', { x: W - M - font.widthOfTextAtSize('Prepared with TankDue', 7.5), y: 24, size: 7.5, font, color: MUTED });
    });
    return doc.save();
  };
  return k;
}

const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : '');

/** The observation lines of a job, as [label, value] pairs with blanks left out. */
export function observationPairs(job) {
  const o = job.obs || {};
  return [
    ['Liquid level at arrival', o.level],
    ['Scum depth', o.scum ? `${o.scum} in` : ''],
    ['Sludge depth', o.sludge ? `${o.sludge} in` : ''],
    ['Inlet baffle or tee', o.inlet],
    ['Outlet baffle or tee', o.outlet],
    ['Effluent filter present', yn(o.filterPresent)],
    ['Effluent filter cleaned', o.filterPresent ? yn(o.filterCleaned) : ''],
    ['Risers and lids', o.lids],
    ['Signs of leaking', yn(o.leak)],
    ['Backflow from drainfield', yn(o.backflow)],
    ['Access used', o.access],
  ].filter(([, v]) => v !== '' && v !== undefined && v !== null);
}

/**
 * The record of one pump-out: a trip ticket for the hauler and the receiving
 * facility, and the customer's pumping record and receipt.
 * @param load the disposal record this job went out on, or null if still on the truck
 */
export async function buildJobPDF(job, load) {
  const snap = job.snapshot || {};
  const company = snap.company || {};
  const customer = snap.customer || {};
  const tank = snap.tank || {};
  const k = await kit(`Pumping record ${job.date} ${customer.name || ''}`);
  const { M, W, font, bold } = k;

  k.header(company, 'Pumping record and waste hauling ticket', [[`${formatGallons(gallons(job.gallons))} gallons`, true], [formatDate(job.date) + (job.time ? ' ' + job.time : ''), false], ['Ticket ' + String(job.id || '').slice(0, 8), false]]);

  k.section('Customer and location (waste generator)');
  k.grid([['Customer', customer.name], ['Contact', customer.contact], ['Phone', customer.phone]]);
  k.grid([
    ['Service address', siteLine(customer, tank, { zip: true })],
    ['County or township', siteOf(customer, tank).county],
  ], 2);

  k.section('Tank and waste');
  k.grid([
    ['Tank or component', tank.kind],
    ['Tank capacity', tank.capacity ? formatGallons(gallons(tank.capacity)) + ' gallons' : ''],
    ['Material / compartments', [tank.material, tank.compartments ? tank.compartments + ' compartment' + (String(tank.compartments) === '1' ? '' : 's') : ''].filter(Boolean).join(', ')],
    ['Waste type', wasteName(job.wasteType)],
    ['Amount removed', formatGallons(gallons(job.gallons)) + ' gallons'],
    ['Reason for pumping', job.reason],
  ]);

  const obs = observationPairs(job);
  if (obs.length || job.condition || job.work || job.recommend) {
    k.section('Condition observed');
    if (obs.length) k.grid(obs, 4);
    if (job.condition) k.para('Condition: ' + job.condition);
    if (job.work) k.para('Work done: ' + job.work);
    if (job.recommend) k.para('Recommended: ' + job.recommend);
    k.y -= 2;
  }
  if (job.nextDue) { k.need(20); k.y -= 4; k.text(`Next pump-out recommended by ${formatDate(job.nextDue)}`, M + 6, k.y, 10, bold); k.y -= 16; }

  k.section('Hauler');
  k.grid([
    ['Driver', snap.driver?.name],
    ['Vehicle', [snap.truck?.name, snap.truck?.plate ? 'plate ' + snap.truck.plate : ''].filter(Boolean).join(', ')],
    ['Hauler registration / licence no.', company.registration],
  ]);

  k.section('Disposal');
  if (load) {
    const f = load.snapshot?.facility || {};
    k.grid([
      ['Receiving facility', f.name],
      ['Facility permit / registration no.', f.permitNo],
      ['Method', f.method],
      ['Facility address', f.address],
      ['Date and time deposited', formatDate(load.date) + (load.time ? ' ' + load.time : '')],
      ['Facility receipt or ticket no.', load.receiptNo],
    ]);
    if (load.rep) k.grid([['Received by (facility representative)', load.rep]], 1);
  } else {
    k.para('Not yet deposited at a receiving facility when this record was printed.', 10, MUTED);
  }

  if (job.price) {
    k.section('Charge');
    k.grid([['Amount', '$' + Number(job.price).toFixed(2)], ['Paid', job.paid || 'Not recorded']], 3);
  }

  k.need(70);
  k.y -= 4;
  const top = k.y;
  await k.signature(job.customerSignature, M + 6, top);
  await k.signature(job.driverSignature, M + 280, top);
  k.y = top - 38;
  k.page.drawLine({ start: { x: M + 6, y: k.y }, end: { x: M + 240, y: k.y }, thickness: 0.7, color: INK });
  k.page.drawLine({ start: { x: M + 280, y: k.y }, end: { x: W - M - 6, y: k.y }, thickness: 0.7, color: INK });
  k.text('Customer or generator signature', M + 6, k.y - 10, 7.5, font, MUTED);
  k.text('Driver signature', M + 280, k.y - 10, 7.5, font, MUTED);
  k.y -= 24;
  if (load) {
    k.need(30);
    k.page.drawLine({ start: { x: M + 6, y: k.y - 8 }, end: { x: M + 240, y: k.y - 8 }, thickness: 0.7, color: INK });
    k.text('Receiving facility representative signature, or attach the facility receipt', M + 6, k.y - 18, 7.5, font, MUTED);
  }
  return k.finish(company.name, 'Ticket ' + String(job.id || '').slice(0, 8));
}

/**
 * The list of every pickup on a truck: carried in the vehicle on the way to
 * the receiving facility, and kept as the record of the load afterwards.
 */
export async function buildLoadPDF({ company, truck, jobs, load }) {
  const k = await kit(`Load sheet ${load ? load.date : ''} ${truck?.name || ''}`);
  const total = jobs.reduce((n, j) => n + (gallons(j.gallons) || 0), 0);
  k.header(company || {}, 'Load sheet', [[`${formatGallons(total)} gallons`, true], [load ? 'Deposited ' + formatDate(load.date) + (load.time ? ' ' + load.time : '') : 'In transit, not yet deposited', false]]);
  k.section('Vehicle and destination');
  const f = load?.snapshot?.facility || {};
  k.grid([
    ['Vehicle', [truck?.name, truck?.plate ? 'plate ' + truck.plate : ''].filter(Boolean).join(', ')],
    ['Tank capacity', truck?.capacity ? formatGallons(gallons(truck.capacity)) + ' gallons' : ''],
    ['Hauler registration / licence no.', company?.registration],
    ['Receiving facility', f.name || 'To be recorded at disposal'],
    ['Facility permit / registration no.', f.permitNo],
    ['Facility receipt or ticket no.', load?.receiptNo],
  ]);
  if (load && load.gallons) k.grid([['Gallons measured by the facility', formatGallons(gallons(load.gallons))], ['Received by', load.rep]], 2);
  k.section('Pickups on this load');
  const rows = jobs.map((j) => {
    const c = j.snapshot?.customer || {};
    const t = j.snapshot?.tank || {};
    const site = siteOf(c, t);
    return [formatDate(j.date), c.name || '', [site.street, site.city].filter(Boolean).join(', '), c.phone || '', wasteName(j.wasteType).split(' (')[0], formatGallons(gallons(j.gallons))];
  });
  rows.push(['', 'Total', '', '', '', formatGallons(total)]);
  k.table([
    { label: 'Date', width: 68 }, { label: 'Customer', width: 120 }, { label: 'Address and town', width: 150 },
    { label: 'Phone', width: 82 }, { label: 'Waste', width: 62 }, { label: 'Gallons', width: 46, align: 'right' },
  ], rows, { boldLast: true });
  return k.finish(company?.name, 'Load ' + String(load?.id || 'open').slice(0, 8));
}

/** Period totals: gallons by facility and waste type, by facility and town, and by facility and month. */
export async function buildSummaryPDF({ company, label, summary }) {
  const k = await kit(`Hauling summary ${label}`);
  k.header(company || {}, 'Hauling summary', [[`${formatGallons(summary.total)} gallons`, true], [label, false], [`${summary.jobs} pump-outs`, false]]);
  if (summary.undisposedJobs) {
    k.para(`${formatGallons(summary.undisposed)} gallons from ${summary.undisposedJobs} pump-out${summary.undisposedJobs === 1 ? '' : 's'} had no disposal recorded when this was printed. They are shown as "Not yet disposed of".`, 9.5, MUTED);
    k.y -= 4;
  }
  const g = (n) => formatGallons(n);
  k.section('By receiving facility and waste type');
  k.table([{ label: 'Facility', width: 190 }, { label: 'Permit no.', width: 96 }, { label: 'Waste type', width: 150 }, { label: 'Pump-outs', width: 46, align: 'right' }, { label: 'Gallons', width: 46, align: 'right' }],
    [...summary.byFacilityWaste.map((r) => [r.facility, r.permit, wasteName(r.wasteType), String(r.jobs), g(r.gallons)]), ['Total', '', '', String(summary.jobs), g(summary.total)]], { boldLast: true });
  k.section('By receiving facility and town of origin');
  k.table([{ label: 'Facility', width: 190 }, { label: 'Town', width: 130 }, { label: 'County', width: 116 }, { label: 'Pump-outs', width: 46, align: 'right' }, { label: 'Gallons', width: 46, align: 'right' }],
    summary.byFacilityTown.map((r) => [r.facility, r.town || '(not recorded)', r.county, String(r.jobs), g(r.gallons)]));
  k.section('By receiving facility and month');
  k.table([{ label: 'Facility', width: 250 }, { label: 'Month', width: 186 }, { label: 'Pump-outs', width: 46, align: 'right' }, { label: 'Gallons', width: 46, align: 'right' }],
    summary.byFacilityMonth.map((r) => [r.facility, formatMonth(r.month), String(r.jobs), g(r.gallons)]));
  k.para('Totals are counted by the date of each pump-out, from the records kept in TankDue. Check them against your tickets and the form your agency requires before filing.', 8.5, MUTED);
  return k.finish(company?.name, 'Summary ' + label);
}
