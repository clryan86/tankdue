# TankDue

Job records, hauling tickets, a disposal log and pump-out reminders for small
septic pumping businesses. It runs in a phone, tablet or desktop browser,
installs to the home screen, and keeps working with no signal.

- `index.html`, `privacy.html`, `site.css`: the public landing and privacy pages
- `app/`: the application (open `app/` in a browser)

## What it does

- **Customers and tanks**: size, type, where the lid is, household size,
  pump-out interval. An interval can be suggested from tank size and
  household size using the table in Oregon State University Extension
  EC 1343 (K. Mancl), capped at a limit you set.
- **Pump-out records**: gallons, waste type, reason, tank condition
  (liquid level, scum and sludge depth, baffles, effluent filter, lids,
  leaks, backflow), work done, charge, customer and driver signatures.
- **Truck**: a running total of pickups not yet discharged, against the
  truck's tank size, with warnings for over-capacity totals and mixed waste.
- **Disposal**: one entry at the receiving facility stamps every pickup on
  the load with the facility, permit number, date, time and receipt number.
  A disposal can be undone.
- **Documents** (PDF, built on the device): pumping record and hauling
  ticket per job; load sheet per truck load; hauling summary for a period.
- **Hauling summary**: gallons by facility and waste type, by facility and
  town, and by facility and month, for a calendar year or a 1 June to
  31 May year. Waste with no disposal recorded is shown as such.
- **Copy deadlines**: optional day counts for getting the record to the
  customer and to the local authority, with a to-send list.
- **Due list and reminders** sent from the user's own email or phone.
- **Import and export**: CSV in, CSV out, full backup and restore.
- **Licence keys** verified on the device. 20 trial jobs. Saved records stay
  readable and exportable in every licence state.
- A saved record keeps the customer, tank, driver, truck and company details
  it was made with; later edits do not alter it.

## What it does not do

- No sync between devices and no accounts. One device, with a backup file.
- It does not reproduce state or county forms and files nothing.
- No dispatch, routing, invoicing or payments.
- A job cannot be split across two loads.
- PDFs use the standard Latin alphabet; letters outside it print as "?".

## How it is built

Plain HTML, CSS and JavaScript modules. No build step and no runtime
dependencies other than a vendored copy of pdf-lib. Records are kept in the
browser's IndexedDB. The app makes no network requests after it has loaded;
a Content-Security-Policy in `app/index.html` restricts it to its own origin.

```
app/src/domain/   scheduling, truck loads, summaries, CSV, licence checks
app/src/views/    screens
app/src/pdf.js    PDFs
app/src/store.js  IndexedDB
app/sw.js         offline cache (generated list, see below)
```

## Working on it

```
npm test                     # unit tests (Node 22+, no install needed)
node tools/stamp-sw.mjs      # after ANY change under app/: refresh the offline file list
npm run serve                # http://localhost:8080  (landing page; app at /app/)
npm run e2e                  # browser journey incl. offline; needs Playwright + Chromium
```

## Publishing

The repository root is a static site. On GitHub: Settings, Pages, deploy from
branch `main`, folder `/ (root)`. The app is then at `<site>/app/`.

## Sources for what the app assumes

- Record fields follow what these rules ask for, read in October 2026:
  Texas 30 TAC 312.145 (trip tickets, annual summary on form TCEQ-00316),
  Florida 62-6.010, Massachusetts 310 CMR 15.351 (System Pumping Record),
  Wisconsin NR 113.11, Minnesota 7083.0770, Ohio OAC 3701-29-20,
  New Hampshire Env-Wq 1605.
- The rules were read as extracted web text, not from the official PDFs, and
  were not reviewed by anyone in the trade or by a lawyer. The app does not
  claim to satisfy any of them. Have a working pumper check the record
  against what their county accepts before relying on it.
