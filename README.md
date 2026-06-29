# San Jose Operational System Prototype

Spreadsheet-backed warehouse operations prototype for San Jose Produce and Imports.

This project was designed from the Google Sheet `San_Jose_Operational_System_WebApp_First`. The Google Sheet defines the operating model, tables, field names, workflow tabs, and reporting structure. Codex/ChatGPT used that sheet design to create the GitHub Pages frontend and the matching Google Apps Script backend source in `apps-script/Code.gs`.

## Current Architecture

```text
Google Sheet: San_Jose_Operational_System_WebApp_First
        ↓
Apps Script backend copied manually from apps-script/Code.gs
        ↓
Apps Script Web App deployment URL ending in /exec
        ↓
frontend/js/config.js
        ↓
GitHub Pages frontend
```

The live website is intended to run from GitHub Pages. The frontend calls the deployed Apps Script Web App endpoint in `frontend/js/config.js`. Apps Script reads and writes the Google Sheet, validates backend permissions, calculates dashboards/reports, and returns JSON data to the website.

## Source Of Truth

The Google Sheet is the operational database and system design source of truth.

Important tabs include:

- `PRODUCTS` — product master catalog.
- `SUPPLIERS` — vendors and customers.
- `LOCATIONS` — warehouse locations and QR values.
- `PURCHASE_ORDERS` and `PURCHASE_ORDER_LINES` — purchase order headers and lines.
- `RECEIVING` — receiving events.
- `LOTS` — internal lot records.
- `INVENTORY_MOVEMENTS` — central inventory movement ledger.
- `SALES_ORDERS` and `SALES_ORDER_LINES` — customer/wholesale/Amazon sales order structure.
- `PICK_TASKS` — fulfillment and picking tasks.
- `AMAZON_*` tabs — Amazon API/import matching structure.
- `*_SCRIPT` tabs — planned or audited Apps Script calculation outputs.
- `USERS`, `DEVICES`, `ERROR_LOG`, `DATA_DICTIONARY`, and `SYSTEM_MAP` — controls, audit, and documentation.

The website should not invent its own database schema. New screens and backend functions should follow the field names already defined in the Google Sheet.

## Apps Script Backend

The backend source lives in:

```text
apps-script/Code.gs
```

Deployment is currently manual:

1. Open the Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Copy the code from `apps-script/Code.gs` into the Apps Script project.
4. Set the real spreadsheet ID in the Apps Script project.
5. Save and run a small backend function once to approve permissions.
6. Deploy as a Web App.
7. Copy the deployed `/exec` URL into `frontend/js/config.js`.
8. Commit the updated frontend config to GitHub.

Important: the GitHub copy of `Code.gs` is the backend source template, but the deployed Apps Script project must be kept in sync manually whenever backend code changes.

## Frontend Connection

The frontend connection is configured here:

```text
frontend/js/config.js
```

The app checks whether `GOOGLE_SCRIPT_WEB_APP_URL` contains `/exec`. If it does, frontend reads and writes go through Apps Script. If the URL is missing or disabled, the prototype can fall back to local seed/browser storage behavior for testing.

The main frontend API adapter is:

```text
frontend/js/api.js
```

That file sends actions such as `getDashboard`, `listProducts`, `createProduct`, `createPurchaseOrder`, `receiveProduct`, `inventorySnapshot`, and `getOperationalReports` to the deployed Apps Script endpoint.

## Calculation Model

Current Apps Script functions calculate dashboard and report values directly from raw operating tabs, especially:

- `PRODUCTS`
- `SUPPLIERS`
- `PURCHASE_ORDERS`
- `PURCHASE_ORDER_LINES`
- `SALES_ORDERS`
- `SALES_ORDER_LINES`
- `LOTS`
- `INVENTORY_MOVEMENTS`
- `LOCATIONS`

`INVENTORY_MOVEMENTS` is the central source of truth for inventory math. Receiving, sales, adjustments, Amazon outbound activity, and warehouse movement should all create movement rows so current inventory can be calculated from the movement ledger.

The `*_SCRIPT` tabs exist to support future audited calculation outputs. The current frontend can receive calculated values directly from Apps Script JSON responses, but long term the system should also write important calculations back to these tabs for review and auditability.

## Run Locally

From the repository root:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080/frontend/
```

Camera QR scanning requires a browser that allows camera access. On many phones, camera access works best over HTTPS or localhost. Keyboard scanner testing works anywhere: focus the scan field, scan/type a value, and press Enter.

## Roles

Frontend roles currently supported:

- `ADMIN`: all screens and actions.
- `MANAGER`: operations screens, catalog edits, PO work, reports.
- `OPERATOR`: receiving, inventory lookup, scanner test, Amazon outbound, and pick/warehouse actions.

Backend Apps Script must enforce permissions again before every write. Frontend permissions are only for user experience and should not be treated as security.

## Current Scope

- Role-based navigation.
- PIN-based sign-in backed by the `USERS` tab.
- Product and supplier/customer management.
- Purchase order creation.
- Placeholder PO document actions.
- Opening inventory entry.
- Product receiving against purchase orders.
- Internal lot creation.
- Inventory movement logging.
- Inventory lookup from movement records.
- Dashboard and reports from Apps Script calculations.
- Scanner helpers for products, lots, locations, PO lines, and Amazon packages.
- Fast Amazon outbound flow.

## Important Deployment Notes

- Keep `apps-script/Code.gs` and the deployed Apps Script project synchronized.
- After changing Apps Script code, deploy a new Web App version.
- After redeploying Apps Script, update `frontend/js/config.js` only if the deployment URL changes.
- If the frontend shows stale values, clear browser storage/session cache and refresh.
- If a screen fails to load, test the Apps Script deployment first and confirm it points to the correct Google Sheet.

## Production Safety Notes

Before using this as a real production system:

- Move secrets and spreadsheet IDs into Apps Script Properties instead of hard-coding them.
- Add a backend health-check action.
- Add structured error logging into `ERROR_LOG`.
- Normalize role names between `USERS`, frontend permissions, and Apps Script permissions.
- Decide whether dashboard/report calculations should be returned live only, written into `*_SCRIPT` tabs, or both.
- Add stronger validation around inventory movement quantities, duplicate IDs, sales order allocation, and Amazon order matching.
