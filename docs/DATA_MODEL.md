# Data Model

The prototype follows the workbook database blueprint.

## Catalogs

- `PRODUCTS`: product master with stable `product_id`, name, category, perishability days, active status, and a system-generated QR/barcode value. Purchase units and pack weights belong to purchase order lines rather than the product master.
- `SUPPLIERS`: shared customer/vendor directory with stable `supplier_id`, `party_type`, contact details, and payment terms. Existing blank types default to `VENDOR`.
- `LOCATIONS`: warehouse locations, stable `location_id`, QR value, category rules.
- `USERS`: app users and roles.
- `DEVICES`: scanners, tablets, and stations.

## Purchasing

- `PURCHASE_ORDERS`: one header per supplier order, including purchase date, learned expected delivery, ship method, tax settings, totals, and document status.
- `PURCHASE_ORDER_LINES`: one or more product lines per PO with purchase quantity, pack type, unit weight, cost, expected supplier lot, received quantities, and a receiving QR value.
- `PO_PRINT_TEMPLATES`: future templates for PO email/print/PDF.
- `PO_DOCUMENT_LOG`: future generated/sent/printed document audit trail.

## Receiving And Inventory

- `RECEIVING`: receiving events from the warehouse flow.
- `LOTS`: internal lot master. `internal_lot_id` is unique.
- `INVENTORY_MOVEMENTS`: source of truth for inventory.
- `ADJUSTMENTS`: future manager/admin corrections.

## Sales And Picking

- `SALES_ORDERS`
- `SALES_ORDER_LINES`
- `PICK_TASKS`

These are documented for the later workflow but intentionally light in this first prototype.

## Amazon Future API

- `AMAZON_ORDERS_API_RAW`
- `AMAZON_ORDER_LINES_API_RAW`
- `AMAZON_SHIPMENTS_API_RAW`
- `AMAZON_PACKAGES`
- `AMAZON_SCAN_MATCHES`
- `AMAZON_RETURNS_API_RAW`

The current prototype only tests package scan matching.

## Rules

- Do not use `supplier_lot_number` as a primary key.
- Use `internal_lot_id` as the unique lot key.
- Every inventory change must create an `INVENTORY_MOVEMENTS` row.
- Current inventory is calculated from movements.
