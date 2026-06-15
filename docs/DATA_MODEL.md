# Data Model

The prototype follows the workbook database blueprint.

## Catalogs

- `PRODUCTS`: product master, stable `product_id`, QR/barcode value, SKUs, stock thresholds.
- `SUPPLIERS`: supplier master, stable `supplier_id`, contact and terms.
- `LOCATIONS`: warehouse locations, stable `location_id`, QR value, category rules.
- `USERS`: app users and roles.
- `DEVICES`: scanners, tablets, and stations.

## Purchasing

- `PURCHASE_ORDERS`: PO headers and document status.
- `PURCHASE_ORDER_LINES`: PO line items and received quantities.
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
