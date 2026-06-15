# Google Apps Script Connection Starter

This file shows the code needed to replace the prototype's local browser data with Google Sheets + Apps Script calls later.

## Frontend Adapter

Create a second API adapter, for example `frontend/js/apiAppsScript.js`, and swap imports when the app is hosted inside Apps Script HTML Service.

```js
function callScript(functionName, payload = {}) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(new Error(error.message || String(error))))
      [functionName](payload);
  });
}

export async function listProducts() {
  return callScript("listProducts");
}

export async function createProduct(user, input) {
  return callScript("createProduct", { user, input });
}

export async function listSuppliers() {
  return callScript("listSuppliers");
}

export async function createSupplier(user, input) {
  return callScript("createSupplier", { user, input });
}

export async function receiveProduct(user, input) {
  return callScript("receiveProduct", { user, input });
}

export async function lookupScan(scanValue) {
  return callScript("lookupScan", { scanValue });
}
```

## Apps Script Backend Starter

Create `Code.gs` in Apps Script and connect it to the Google Sheet.

```js
const SPREADSHEET_ID = "PASTE_SPREADSHEET_ID_HERE";

function sheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Missing sheet: ${name}`);
  return sh;
}

function rows_(sheetName) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headerRowIndex = values.findIndex((row) => row.some((cell) => String(cell).endsWith("_id")));
  const headers = values[headerRowIndex];
  return values.slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
}

function appendRow_(sheetName, record) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headerRowIndex = values.findIndex((row) => row.some((cell) => String(cell).endsWith("_id")));
  const headers = values[headerRowIndex];
  sh.appendRow(headers.map((key) => record[key] ?? ""));
  return record;
}

function listProducts() {
  return rows_("PRODUCTS");
}

function createProduct(payload) {
  const product = payload.input;
  if (!product.product_id) product.product_id = nextId_("PROD", "PRODUCTS", "product_id");
  product.is_active = true;
  product.created_at = new Date();
  product.updated_at = new Date();
  return appendRow_("PRODUCTS", product);
}

function listSuppliers() {
  return rows_("SUPPLIERS");
}

function createSupplier(payload) {
  const supplier = payload.input;
  if (!supplier.supplier_id) supplier.supplier_id = nextId_("SUP", "SUPPLIERS", "supplier_id");
  supplier.is_active = true;
  supplier.created_at = new Date();
  supplier.updated_at = new Date();
  return appendRow_("SUPPLIERS", supplier);
}

function lookupScan(payload) {
  const value = String(payload.scanValue || "").trim();
  const product = rows_("PRODUCTS").find((row) =>
    [row.product_id, row.barcode_or_qr_value, row.amazon_sku, row.wholesale_sku].includes(value)
  );
  if (product) return { type: "PRODUCT", record: product };

  const location = rows_("LOCATIONS").find((row) =>
    [row.location_id, row.qr_value].includes(value)
  );
  if (location) return { type: "LOCATION", record: location };

  const lot = rows_("LOTS").find((row) =>
    [row.internal_lot_id, row.qr_value, row.supplier_lot_number].includes(value)
  );
  if (lot) return { type: "LOT", record: lot };

  return null;
}

function nextId_(prefix, sheetName, idColumn) {
  const count = rows_(sheetName).length + 1;
  return `${prefix}-${String(count).padStart(6, "0")}`;
}
```

## Backend Rules To Add Before Production

- Enforce role permissions in Apps Script before every write.
- Validate duplicate IDs before appending rows.
- Use locks when generating IDs.
- Write receiving, lots, and inventory movements together.
- Log failed scans and exceptions to `ERROR_LOG`.
