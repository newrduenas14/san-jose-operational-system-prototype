# Google Apps Script Plan

The frontend API layer is isolated in `frontend/js/api.js`. Later, each local function can be replaced with a call to Apps Script.

## Replacement Pattern

Current:

```js
createProduct(user, input)
```

Future:

```js
google.script.run
  .withSuccessHandler(...)
  .withFailureHandler(...)
  .createProduct(input)
```

## Backend Responsibilities

- Validate required IDs.
- Enforce role permissions.
- Generate unique IDs.
- Validate scans against products, lots, locations, and packages.
- Write receiving records.
- Write inventory movements.
- Recalculate script output tabs.
- Log errors to `ERROR_LOG`.

## Spreadsheet Tables

Apps Script should write to the workbook tables using the same field names documented in `DATA_MODEL.md`.
