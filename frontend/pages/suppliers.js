import { createSupplier, listSuppliers } from "../js/api-smooth1.js?v=parties1";
import { can } from "../js/permissions.js";
import { formToObject, notice, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Customers & Vendors", "Manage the companies you buy from and sell to");
  const parties = await listSuppliers();
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "suppliers:create") ? supplierForm() : ""}
      <section class="panel">
        <div class="panel-header"><h2>Business Directory</h2></div>
        ${table([
          { label: "Type", render: (row) => status(partyType(row)) },
          { label: "Record ID", key: "supplier_id" },
          { label: "Name", key: "supplier_name" },
          { label: "Contact", key: "contact_name" },
          { label: "Email", key: "email" },
          { label: "Phone", key: "phone" },
          { label: "Lead Days", render: (row) => partyType(row) === "VENDOR" ? row.lead_time_expected_days : "" },
          { label: "Status", render: (row) => status(row.is_active ? "ACTIVE" : "INACTIVE") }
        ], parties)}
      </section>
    </div>
  `;

  document.getElementById("supplierForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const party = await createSupplier(ctx.user, formToObject(event.currentTarget));
      notice(`${partyType(party) === "CUSTOMER" ? "Customer" : "Vendor"} saved: ${party.supplier_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function supplierForm() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Add Customer or Vendor</h2></div>
      <form id="supplierForm" class="form-grid">
        <div class="field">
          <label>Business Type</label>
          <select name="party_type" required>
            <option value="CUSTOMER">Customer</option>
            <option value="VENDOR" selected>Vendor</option>
          </select>
        </div>
        <div class="field"><label>Record ID</label><input name="supplier_id" placeholder="Auto if blank"></div>
        <div class="field"><label>Business Name</label><input name="supplier_name" required></div>
        <div class="field"><label>Contact Name</label><input name="contact_name"></div>
        <div class="field"><label>Email</label><input name="email" type="email"></div>
        <div class="field"><label>Phone</label><input name="phone"></div>
        <div class="field">
          <label>Payment Terms</label>
          <select name="payment_terms" required>
            <option>Net 15</option>
            <option>Net 21</option>
            <option selected>Net 30</option>
          </select>
        </div>
        <div class="field"><label>Currency</label><input name="default_currency" value="USD"></div>
        <div class="field full"><label>Address</label><textarea name="address"></textarea></div>
        <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field full"><button class="btn" type="submit">Save Business</button></div>
      </form>
    </section>
  `;
}

function partyType(record) {
  return String(record.party_type || "VENDOR").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
}
