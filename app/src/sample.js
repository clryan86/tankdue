// Sample records for trying the app. Every name and address is invented.
import { state, putMany, saveSettings, newId } from './store.js';
import { addMonthsISO } from './domain/service.js';
import { todayISO } from './domain/due.js';

function shift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export async function loadSampleData() {
  const C = (name, contact, email, phone, address, city) => ({ id: newId(), name, contact, email, phone, address, city, state: 'TX', zip: '', county: 'Williamson', notes: '', sample: true });
  const customers = [
    C('Harlan Family', 'Dana Harlan', 'dana@harlan.example', '(512) 555-0142', '2210 County Road 118', 'Hutto'),
    C('Pecan Ridge Ranch', 'Foreman', 'office@pecanridge.example', '(512) 555-0177', '9400 Ranch Road 12', 'Georgetown'),
    C('Ortega Family', 'Luis Ortega', 'luis@ortega.example', '(512) 555-0109', '18 Mesa Verde Loop', 'Leander'),
    C('Northside Feed and Supply', 'Manager', 'manager@northsidefeed.example', '(512) 555-0163', '75 Mill Road', 'Taylor'),
    C('Whitfield Family', 'Sam Whitfield', '', '(512) 555-0121', '310 Pecan Lane', 'Liberty Hill'),
  ];
  const T = (ci, kind, capacity, people, location, intervalMonths, dueInDays, extra = {}) => ({
    id: newId(), customerId: customers[ci].id, kind, capacity: String(capacity), people: people ? String(people) : '', material: 'Concrete', compartments: '2',
    location, serviceAddress: '', county: 'Williamson', intervalMonths: String(intervalMonths),
    lastPumpedImported: dueInDays === null ? '' : addMonthsISO(shift(dueInDays), -intervalMonths),
    garbageDisposal: false, onCall: false, active: true, sample: true, ...extra,
  });
  const tanks = [
    T(0, 'Septic tank', 1000, 4, '15 ft off the back porch, lid 6 in down', 36, -12),
    T(1, 'Septic tank', 1500, 6, 'Behind the bunkhouse, two risers', 30, 9),
    T(1, 'Holding tank', 2000, 0, 'At the show barn, alarm on the post', 6, 24),
    T(2, 'Septic tank', 1250, 3, 'Side yard by the gas meter', 36, 48),
    T(3, 'Septic tank', 1000, 0, 'Under the gravel at the loading dock end', 24, 200),
    T(4, 'Septic tank', 750, 2, 'Front yard, left of the walk, no riser', 36, null),
  ];
  await putMany('customers', customers);
  await putMany('tanks', tanks);
  if (!state.drivers.length) await putMany('drivers', [{ id: newId(), name: 'Sample Driver', licenceNo: '', sample: true }]);
  if (!state.trucks.length) await putMany('trucks', [{ id: newId(), name: 'Truck 1', plate: 'SAMPLE1', capacity: '2500', sample: true }]);
  if (!state.facilities.length) await putMany('facilities', [{ id: newId(), name: 'County Wastewater Treatment Plant', address: '1 Plant Road', permitNo: 'WQ0000000', method: 'Wastewater treatment plant', sample: true }]);
  if (!state.settings.company.name) {
    state.settings.company = { name: 'Sample Septic Service', address: '100 Example Way', cityStateZip: 'Hutto, TX', phone: '(512) 555-0100', email: 'office@sampleseptic.example', registration: '00000' };
    await saveSettings('company');
  }
}
