import { createSupplier, listSuppliers } from "../js/api-smooth1.js?v=buttons1";
import { can } from "../js/permissions.js";
import { enableTableSorting, escapeHtml, formToObject, notice, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Customers & Vendors", "Manage the companies you buy from and sell to");
  const parties = await listSuppliers();
  const counts = partyCounts(parties);

  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "suppliers:create") ? supplierFormPanel() : ""}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Business Directory</h2>
            <p class="muted">${counts.customers} customer${counts.customers === 1 ? "" : "s"} · ${counts.vendors} vendor${counts.vendors === 1 ? "" : "s"}</p>
          </div>
          ${can(ctx.user, "suppliers:create") ? `
            <div class="actions">
              <button class="btn secondary" type="button" data-open-party-form="CUSTOMER">Add Customer</button>
              <button class="btn" type="button" data-open-party-form="VENDOR">Add Vendor</button>
            </div>
          ` : ""}
        </div>
        ${table([
          { label: "Type", sortable: true, sortValue: (row) => partyType(row), render: (row) => status(partyType(row)) },
          { label: "Record ID", key: "supplier_id", sortable: true },
          { label: "Name", key: "supplier_name", sortable: true },
          { label: "Contact", key: "contact_name", sortable: true },
          { label: "Email", key: "email", sortable: true },
          { label: "Phone", key: "phone" },
          {
            label: "Lead Days",
            sortable: true,
            sortType: "number",
            sortValue: (row) => Number(row.lead_time_expected_days || 0),
            render: (row) => partyType(row) === "VENDOR" ? escapeHtml(row.lead_time_expected_days || "") : ""
          },
          { label: "Status", sortable: true, sortValue: (row) => isActive(row) ? "ACTIVE" : "INACTIVE", render: (row) => status(isActive(row) ? "ACTIVE" : "INACTIVE") }
        ], parties)}
      </section>
    </div>
  `;

  enableTableSorting(ctx.view);
  setupSupplierFlow(ctx);
}

function setupSupplierFlow(ctx) {
  const formPanel = document.getElementById("supplierFormPanel");
  const form = document.getElementById("supplierForm");
  if (!form || !formPanel) return;

  ctx.view.querySelectorAll("[data-open-party-form]").forEach((button) => {
    button.addEventListener("click", () => openPartyForm(formPanel, form, button.dataset.openPartyForm));
  });

  document.getElementById("cancelSupplierForm")?.addEventListener("click", () => {
    form.reset();
    formPanel.hidden = true;
  });

  form.elements.party_type.addEventListener("change", () => updatePartyFormMode(form));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector("[data-save-party]");
    const payload = normalizePartyInput(formToObject(form));

    if (!form.reportValidity()) return;
    setButtonBusy(saveButton, true, `Saving ${payload.party_type === "CUSTOMER" ? "customer" : "vendor"}...`);

    try {
      const party = await createSupplier(ctx.user, payload);
      notice(`${partyType(party) === "CUSTOMER" ? "Customer" : "Vendor"} saved: ${party.supplier_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
      setButtonBusy(saveButton, false);
    }
  });
}

function openPartyForm(panel, form, partyType = "VENDOR") {
  panel.hidden = false;
  form.reset();
  form.elements.party_type.value = partyType === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
  form.elements.payment_terms.value = "Net 30";
  form.elements.default_currency.value = "USD";
  form.elements.lead_time_expected_days.value = form.elements.party_type.value === "VENDOR" ? "5" : "";
  updatePartyFormMode(form);
  window.setTimeout(() => form.elements.supplier_name.focus(), 0);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updatePartyFormMode(form) {
  const isVendor = form.elements.party_type.value === "VENDOR";
  form.querySelectorAll("[data-vendor-only]").forEach((field) => {
    field.hidden = !isVendor;
  });
  form.elements.lead_time_expected_days.required = isVendor;
  if (!isVendor) form.elements.lead_time_expected_days.value = "";
}

function supplierFormPanel() {
  return `
    <section id="supplierFormPanel" class="panel" hidden>
      <div class="panel-header">
        <div>
          <h2>Add Customer or Vendor</h2>
          <p class="muted">Create one clean business record, then use it in purchase orders or sales orders.</p>
        </div>
      </div>
      <form id="supplierForm" class="form-grid">
        <div class="field">
          <label>Business Type</label>
          <select name="party_type" required>
            <option value="CUSTOMER">Customer</option>
            <option value="VENDOR" selected>Vendor</option>
          </select>
        </div>
        <div class="field">
          <label>Record ID</label>
          <input name="supplier_id" placeholder="Auto if blank" autocomplete="off">
        </div>
        <div class="field"><label>Business Name</label><input name="supplier_name" autocomplete="organization" required></div>
        <div class="field"><label>Contact Name</label><input name="contact_name" autocomplete="name"></div>
        <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email"></div>
        <div class="field"><label>Phone</label><input name="phone" autocomplete="tel"></div>
        <div class="field">
          <label>Payment Terms</label>
          <select name="payment_terms" required>
            <option>Net 15</option>
            <option>Net 21</option>
            <option selected>Net 30</option>
          </select>
        </div>
        <div class="field"><label>Currency</label><input name="default_currency" value="USD" maxlength="3" required></div>
        <div class="field" data-vendor-only>
          <label>Expected Lead Days</label>
          <input name="lead_time_expected_days" type="number" min="0" step="1" value="5">
        </div>
        <div class="field full"><label>Address</label><textarea name="address" autocomplete="street-address"></textarea></div>
        <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field full actions">
          <button class="btn" type="submit" data-save-party>Save Business</button>
          <button id="cancelSupplierForm" class="btn secondary" type="button">Cancel</button>
        </div>
      </form>
    </section>
  `;
}

function normalizePartyInput(input) {
  const partyTypeValue = String(input.party_type || "VENDOR").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
  return {
    ...input,
    party_type: partyTypeValue,
    supplier_id: String(input.supplier_id || "").trim(),
    supplier_name: String(input.supplier_name || "").trim(),
    contact_name: String(input.contact_name || "").trim(),
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    address: String(input.address || "").trim(),
    payment_terms: String(input.payment_terms || "Net 30").trim(),
    default_currency: String(input.default_currency || "USD").trim().toUpperCase(),
    lead_time_expected_days: partyTypeValue === "VENDOR" ? String(input.lead_time_expected_days || "5").trim() : "",
    notes: String(input.notes || "").trim()
  };
}

function setButtonBusy(button, isBusy, label = "Working...") {
  if (!button) return;
  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.textContent = button.dataset.originalText || "Save Business";
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

function partyCounts(parties) {
  return parties.reduce((counts, row) => {
    if (partyType(row) === "CUSTOMER") counts.customers += 1;
    else counts.vendors += 1;
    return counts;
  }, { customers: 0, vendors: 0 });
}

function partyType(record) {
  return String(record.party_type || "VENDOR").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
}

function isActive(record) {
  return record.is_active === true || String(record.is_active).toUpperCase() === "TRUE";
}
