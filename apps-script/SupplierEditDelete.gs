/**
 * Customer/Vendor edit + delete helpers.
 *
 * Deployment note:
 * 1) Add this file to the same Apps Script project as Code.gs.
 * 2) In Code.gs inside handleApiRequest_ routes, add:
 *      updateSupplier: updateSupplier,
 *      deactivateSupplier: deactivateSupplier,
 * 3) Deploy a new Web App version.
 *
 * These actions archive records by setting is_active=false instead of hard-deleting rows.
 * That protects purchase orders, sales orders, analytics, and old references.
 */

function updateSupplier(payload) {
  payload = payload || {};
  requirePermission_(payload.user, "suppliers:create");

  const input = payload.input || {};
  const supplierId = String(input.supplier_id || "").trim();
  const partyType = normalizePartyType_(input.party_type);
  const supplierName = String(input.supplier_name || "").trim();

  if (!supplierId) throw new Error("Business record ID is required.");
  if (!supplierName) throw new Error("Business name is required.");

  ensureTableColumns_("SUPPLIERS", [
    "supplier_id", "supplier_name", "contact_name", "email", "phone", "address",
    "payment_terms", "default_currency", "lead_time_expected_days", "is_active",
    "created_at", "updated_at", "notes", "party_type"
  ]);

  const existing = readTable_("SUPPLIERS").find((row) => String(row.supplier_id || "") === supplierId);
  if (!existing) throw new Error("Business record was not found.");

  const changes = {
    supplier_name: supplierName,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: partyType === "VENDOR" ? num_(input.lead_time_expected_days, 5) : "",
    is_active: true,
    updated_at: nowIso_(),
    notes: input.notes || "",
    party_type: partyType
  };

  updateTableRecord_("SUPPLIERS", "supplier_id", supplierId, changes);

  return readTable_("SUPPLIERS").find((row) => String(row.supplier_id || "") === supplierId);
}

function deactivateSupplier(payload) {
  payload = payload || {};
  requirePermission_(payload.user, "suppliers:create");

  const supplierId = String(payload.supplierId || payload.supplier_id || "").trim();
  if (!supplierId) throw new Error("Business record ID is required.");

  const existing = readTable_("SUPPLIERS").find((row) => String(row.supplier_id || "") === supplierId);
  if (!existing) throw new Error("Business record was not found.");

  updateTableRecord_("SUPPLIERS", "supplier_id", supplierId, {
    is_active: false,
    updated_at: nowIso_()
  });

  return {
    supplier_id: supplierId,
    supplier_name: existing.supplier_name || supplierId,
    party_type: normalizePartyType_(existing.party_type),
    is_active: false
  };
}
