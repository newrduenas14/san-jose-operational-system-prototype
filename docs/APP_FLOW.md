# App Flow

## Catalog Setup

1. Admin or Manager adds products.
2. Admin or Manager adds suppliers.
3. QR/barcode values can be tested immediately in Scanner Test or Inventory Lookup.

## Purchase Order

1. Admin or Manager creates a PO.
2. PO line references a product and supplier.
3. Document buttons are placeholders for future Apps Script document generation.

## Receiving

1. Operator opens Receive Product.
2. Operator selects a PO.
3. App shows expected PO lines.
4. Operator scans product or lot value.
5. Operator enters received quantity, supplier lot, damage, and quality score.
6. Operator scans or enters a location.
7. App creates receiving, lot, and inventory movement records in local browser data.

## Scanner Testing

Keyboard scanners behave like fast typing:

1. Focus a scan input.
2. Scan code.
3. Scanner sends Enter.
4. App runs the lookup or confirmation.

Phone camera scanning uses `html5-qrcode` in the browser.
