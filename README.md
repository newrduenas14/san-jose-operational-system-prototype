# San Jose Operational System Prototype

Frontend-only warehouse operations prototype for San Jose Produce.

This version does not connect to Google Sheets yet. It starts from data extracted from `San_Jose_Operational_System_WebApp_First.xlsx` in `data/spreadsheetSeed.json`, then stores any records you add in browser `localStorage`.

## Run

From this folder:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080/frontend/
```

Camera QR scanning requires a browser that allows camera access. On many phones, camera access works best over HTTPS or localhost. Keyboard scanner testing works anywhere: focus the scan field, scan/type a value, and press Enter.

## Roles

- `ADMIN`: all screens and actions.
- `MANAGER`: operations screens, catalog edits, PO work, reports.
- `OPERATOR`: receiving, inventory lookup, scanner test, and Amazon package scan.

## Useful Test Scan Values

- Product: `PROD-001`
- Lot: `LOT-000001`
- Location: `LOC-B-02-01`
- Amazon package: `PKG-000001`

Products added in the app can also be scanned using their `QR / Barcode Value`.

## Current Scope

- Role-based navigation.
- Add products.
- Add suppliers.
- Create purchase orders.
- Placeholder PO document actions.
- Receive product against a PO.
- Generate internal lot records.
- Create inventory movement records.
- Inventory lookup from movement records.
- Camera scanner and keyboard scanner helpers.
- Fast Amazon outbound flow: scan a lot, record quantity leaving, and view the recent outbound log.

## Important Limitation

This is a browser prototype. Frontend permissions are useful for testing the experience, but the future Google Apps Script backend must enforce permissions again before writing to Google Sheets.
