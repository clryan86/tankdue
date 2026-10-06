import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, toCSV, importRows, normaliseKind, normaliseDate } from '../app/src/domain/csv.js';

const ids = () => { let n = 0; return () => 'i' + (++n); };

test('parse handles quotes, commas, newlines, BOM, CRLF and inch marks', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x, y","he said ""hi"""\r\n"line\nbreak",z\r\n\r\n'), [['a', 'b'], ['x, y', 'he said "hi"'], ['line\nbreak', 'z']]);
  assert.deepEqual(parseCSV('Acme,24" riser,Front\nBeta,18" riser,Back\n'), [['Acme', '24" riser', 'Front'], ['Beta', '18" riser', 'Back']]);
});

test('round trip and formula guard', () => {
  const rows = [['name', 'note'], ['A & B, Inc.', 'say "hi"\nplease'], ['', '5']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.equal(toCSV([['=SUM(A1)', '-5.2', '+1 555']]), "'=SUM(A1),-5.2,'+1 555\r\n");
});

test('tank kinds and dates', () => {
  assert.equal(normaliseKind('Septic'), 'Septic tank');
  assert.equal(normaliseKind('1000 gal septic tank'), 'Septic tank');
  assert.equal(normaliseKind('Grease Trap'), 'Grease trap');
  assert.equal(normaliseKind('Tight tank'), 'Holding tank');
  assert.equal(normaliseKind('Cesspool(s)'), 'Cesspool');
  assert.equal(normaliseKind('ATU'), 'Aerobic treatment unit');
  assert.equal(normaliseKind('Lift station'), 'Pump chamber');
  assert.equal(normaliseKind('mystery'), '');
  assert.equal(normaliseDate('3/7/2023'), '2023-03-07');
  assert.equal(normaliseDate('1/2/24'), '2024-01-02');
  assert.equal(normaliseDate('5/6/27'), '2027-05-06'); // read as 20xx; a future date is then rejected on import
  assert.equal(normaliseDate('2/30/2026'), '');
  const fut = importRows(parseCSV('Customer,Last pumped\nA,5/6/27\n'), ids(), undefined, '2026-10-06');
  assert.equal(fut.tanks[0].lastPumpedImported, '');
  assert.match(fut.skipped[0].reason, /in the future/);
});

test('import: groups tanks under customers, reads sizes, intervals and dates, reports problems', () => {
  const rows = parseCSV([
    'Customer Name,Service Address,City,County,Email,Phone,Tank Type,Tank Size,Occupants,Pump every,Last pumped,Gate code',
    "Oak Family,12 Oak St,Hutto,Williamson,oak@example.com,'+1 512 555 0100,Septic,\"1,000 gal\",4,3 years,10/20/2023,1234",
    'Oak Family,12 Oak St,Hutto,Williamson,,,Pump chamber,500,,,,',
    ',99 Nowhere,,,,,Septic,,,,,',
    'Pine Cafe,4 Pine Rd,Hutto,Williamson,a@b.co?bcc=x@y.z,,Grease trap,750,,3,1/1/2099,',
    'Elm Farm,7 Elm Ave,Taylor,Williamson,,,Whatsit,big,lots,sometimes,Jan 5 2024,',
  ].join('\n'));
  const out = importRows(rows, ids(), undefined, '2026-10-06');
  assert.equal(out.rowsRead, 5);
  assert.equal(out.customers.length, 3);
  assert.equal(out.tanks.length, 4);
  assert.equal(out.customers[0].phone, '+1 512 555 0100');
  assert.deepEqual([out.tanks[0].kind, out.tanks[0].capacity, out.tanks[0].people, out.tanks[0].intervalMonths, out.tanks[0].lastPumpedImported], ['Septic tank', '1000', '4', '36', '2023-10-20']);
  assert.equal(out.tanks[1].customerId, out.customers[0].id);
  assert.equal(out.tanks[2].kind, 'Grease trap');
  assert.equal(out.tanks[2].intervalMonths, '3');
  assert.equal(out.tanks[2].lastPumpedImported, '');
  assert.equal(out.customers[1].email, '');
  assert.equal(out.tanks[3].kind, 'Septic tank');
  assert.deepEqual([out.tanks[3].capacity, out.tanks[3].people, out.tanks[3].intervalMonths, out.tanks[3].lastPumpedImported], ['', '', '', '']);
  // no name (1) + bad email (1) + future date (1) + unknown type, size, people, interval, date (5)
  assert.equal(out.skipped.length, 8);
  assert.deepEqual(out.unmapped, ['Gate code']);
});

test('importing the same file twice adds nothing; a new tank attaches to the existing customer', () => {
  const csv = 'Customer,Address,Type,Size\nOak Family,12 Oak St,Septic,1000\n';
  const id = ids();
  const first = importRows(parseCSV(csv), id);
  const again = importRows(parseCSV(csv), id, first);
  assert.equal(again.customers.length, 0);
  assert.equal(again.tanks.length, 0);
  const more = importRows(parseCSV('Customer,Address,Type,Size\nOak Family,12 Oak St,Grease trap,500\n'), id, first);
  assert.equal(more.customers.length, 0);
  assert.equal(more.tanks[0].customerId, first.customers[0].id);
});

test('a file without a customer column explains itself', () => {
  const out = importRows([['Size'], ['1000']], () => 'x');
  assert.match(out.skipped[0].reason, /Customer/);
});
