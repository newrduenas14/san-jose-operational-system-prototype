# Customer/Vendor Edit and Delete Deployment

The Customers & Vendors screen now has row-level Edit and Delete buttons.

The live GitHub Pages app writes through Google Apps Script, so the deployed Apps Script project needs the matching backend actions before edits and deletes can write to the Google Sheet.

## Deployment steps

1. Open the Apps Script project connected to the operations spreadsheet.
2. Add a new script file named SupplierEditDelete.gs.
3. Copy the repository file apps-script/SupplierEditDelete.gs into that Apps Script file.
4. In Code.gs, find the routes object inside handleApiRequest_.
5. Add updateSupplier and deactivateSupplier beside the existing listSuppliers and createSupplier routes.
6. Save the Apps Script project.
7. Deploy a new Web App version.
8. Hard-refresh the GitHub Pages site.

## Behavior

Edit updates the existing row in SUPPLIERS.

Delete archives the row by setting is_active=false instead of removing it. This keeps old purchase orders, sales orders, and reporting history safe.
