# Permissions

## ADMIN

Can access all prototype screens and actions.

## MANAGER

Can access dashboard, product/supplier catalog work, purchase orders, receiving, inventory, scanner testing, Amazon package matching, and reports.

Cannot access admin reset/configuration controls.

## OPERATOR

Can access:

- Dashboard
- Receive Product
- Inventory Lookup
- Scanner Test
- Amazon Match

Cannot create products, suppliers, or purchase orders.

## Future Backend Rule

The frontend hides unauthorized navigation and checks actions before writing to local data. Google Apps Script must repeat permission checks before writing to Google Sheets.
