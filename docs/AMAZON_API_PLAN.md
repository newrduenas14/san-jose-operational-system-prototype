# Amazon API Plan

This prototype records outbound stock before API integration: scan the internal lot, enter the quantity, and optionally capture the Amazon shipment/reference. This writes an `AMAZON_OUT` inventory movement and reduces available inventory immediately.

Future Amazon integration should:

1. Import raw Amazon orders to `AMAZON_ORDERS_API_RAW`.
2. Import order lines to `AMAZON_ORDER_LINES_API_RAW`.
3. Map Amazon SKUs to internal `product_id`.
4. Create sales orders and pick tasks.
5. Scan finished packages.
6. Match package to Amazon order line.
7. Link package, sales order, pick task, movement, and internal lot.
8. Log exceptions in `AMAZON_SCAN_MATCHES` and `ERROR_LOG`.
