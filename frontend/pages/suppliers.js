import { createSupplier, listSuppliers } from "../js/api-smooth1.js";
import { can } from "../js/permissions.js";
import { formToObject, notice, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Suppliers", "Add suppliers for purchase orders");
  const suppliers = await listSuppliers();
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "suppliers:create") ? supplierForm() : ""}
      <section class="panel">
        <div class="panel-header"><h2>Supplier Catalog</h2></div>
        ${table([
          { label: "Supplier ID", key: "supplier_id" },
          { label: "Name", key: "supplier_name" },
          { label: "Contact", key: "contact_name" },
          { label: "Email", key: "email" },
          { label: "Phone", key: "phone" },
          { label: "Lead Days", key: "lead_time_expected_days" },
          { label: "Status", render: (row) => status(row.is_active ? "ACTIVE" : "INACTIVE") }
        ], suppliers)}
      </section>
    </div>
  `;

  document.getElementById("supplierForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const supplier = await createSupplier(ctx.user, formToObject(event.currentTarget));
      notice(`Supplier saved: ${supplier.supplier_id}. Lead time starts/calculates at ${supplier.lead_time_expected_days} days.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function supplierForm() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Add Supplier</h2></div>
      <form id="supplierForm" class="form-grid">
        <div class="field"><label>Supplier ID</label><input name="supplier_id" placeholder="Auto if blank"></div>
        <div class="field"><label>Supplier Name</label><input name="supplier_name" required></div>
        <div class="field"><label>Contact Name</label><input name="contact_name"></div>
        <div class="field"><label>Email</label><input name="email" type="email"></div>
        <div class="field"><label>Phone</label><input name="phone"></div>
        <div class="field"><label>Payment Terms</label><input name="payment_terms" value="Net 30"></div>
        <div class="field"><label>Currency</label><input name="default_currency" value="USD"></div>
        <div class="field full"><p class="muted">Lead time starts at 5 days and is recalculated from completed purchase order history over time.</p></div>
        <div class="field full"><label>Address</label><textarea name="address"></textarea></div>
        <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field full"><button class="btn" type="submit">Save Supplier</button></div>
      </form>
    </section>
  `;
}
