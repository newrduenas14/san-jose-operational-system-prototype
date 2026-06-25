import { createOpeningInventory, listLocations, listLots, listProducts } from "../js/api-smooth1.js?v=open5";
import { escapeHtml, notice } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Opening Inventory", "Add products to available spaces");
  const [locations, products, lots] = await Promise.all([listLocations(), listProducts(), listLots()]);
  const spaces = locations.filter((location) => String(location.current_status || "AVAILABLE").toUpperCase() === "AVAILABLE");

  ctx.view.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Add opening stock</h2>
          <p class="muted">Pick one or many spaces for the same product and lot setup.</p>
        </div>
      </div>
      <form id="openingForm" class="form-grid">
        <div class="field full">
          <label>Available spaces</label>
          <div class="actions opening-space-actions">
            <button id="selectAllOpeningLocations" class="btn secondary" type="button">Select all spaces</button>
            <button id="clearOpeningLocations" class="btn secondary" type="button">Clear</button>
            <span id="openingLocationCount" class="field-hint">0 selected</span>
          </div>
          <select id="openingLocations" name="location_ids" multiple required size="${Math.min(Math.max(spaces.length, 4), 10)}">
            ${spaces.map((location) => `<option value="${escapeHtml(location.location_id)}">${escapeHtml(location.location_id)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Product name</label>
          <input id="openingProduct" name="product_name" list="products" required>
          <datalist id="products">${products.map((product) => `<option value="${escapeHtml(product.product_name)}"></option>`).join("")}</datalist>
        </div>
        <div class="field">
          <label>Previous lot (optional)</label>
          <select id="openingLot" name="previous_lot"><option value="">New lot / type details</option></select>
        </div>
        <div class="field"><label>Lot #</label><input name="supplier_lot_number"></div>
        <div class="field"><label>Amount per space</label><input name="qty" type="number" step=".01" required></div>
        <div class="field"><label>Purchase unit</label><input name="purchase_unit" required></div>
        <div class="field"><label>Weight per unit (LB)</label><input name="purchase_unit_weight" type="number" step=".01" required></div>
        <div class="field"><label>Perishability (days)</label><input name="perishability_days" type="number" value="0"></div>
        <div class="field"><label>Category</label><input name="product_category" value="General"></div>
        <div class="field full">
          <button class="btn" type="submit">Add opening inventory</button>
        </div>
      </form>
    </section>
  `;

  const form = document.getElementById("openingForm");
  const productInput = document.getElementById("openingProduct");
  const lotSelect = document.getElementById("openingLot");
  const locationSelect = document.getElementById("openingLocations");
  const locationCount = document.getElementById("openingLocationCount");

  const updateLocationCount = () => {
    const count = locationSelect.selectedOptions.length;
    locationCount.textContent = `${count} selected`;
  };

  const refreshLots = () => {
    const product = products.find((item) => item.product_name.toLowerCase() === productInput.value.trim().toLowerCase());
    const uniqueLots = new Map();
    lots.filter((lot) => !product || lot.product_id === product.product_id).forEach((lot) => {
      const key = String(lot.supplier_lot_number || lot.internal_lot_id).trim();
      if (key && !uniqueLots.has(key)) uniqueLots.set(key, lot);
    });
    lotSelect.innerHTML = `<option value="">New lot / type details</option>${Array.from(uniqueLots.values()).map((lot) => {
      const label = lot.supplier_lot_number || lot.internal_lot_id;
      return `<option value="${escapeHtml(lot.internal_lot_id)}">${escapeHtml(label)} (${escapeHtml(lot.purchase_unit_type || "unit")})</option>`;
    }).join("")}`;
    if (product) {
      form.elements.perishability_days.value = product.perishability_days || 0;
      form.elements.product_category.value = product.product_category || "General";
    }
  };

  productInput.addEventListener("change", refreshLots);
  productInput.addEventListener("input", refreshLots);
  locationSelect.addEventListener("change", updateLocationCount);
  document.getElementById("selectAllOpeningLocations").addEventListener("click", () => {
    Array.from(locationSelect.options).forEach((option) => { option.selected = true; });
    updateLocationCount();
  });
  document.getElementById("clearOpeningLocations").addEventListener("click", () => {
    Array.from(locationSelect.options).forEach((option) => { option.selected = false; });
    updateLocationCount();
  });
  lotSelect.addEventListener("change", () => {
    const lot = lots.find((item) => item.internal_lot_id === lotSelect.value);
    if (!lot) return;
    form.elements.supplier_lot_number.value = lot.supplier_lot_number || "";
    form.elements.purchase_unit.value = lot.purchase_unit_type || "";
    form.elements.purchase_unit_weight.value = (Number(lot.original_qty || 0) / Number(lot.purchase_qty_received || 1)) || "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const locationIds = Array.from(locationSelect.selectedOptions).map((option) => option.value);
    if (!locationIds.length) {
      notice("Select at least one available space.");
      return;
    }

    const button = form.querySelector("button[type='submit']");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = `Adding ${locationIds.length} space${locationIds.length === 1 ? "" : "s"}...`;

    try {
      const input = Object.fromEntries(new FormData(form).entries());
      input.location_ids = locationIds;
      const result = await createOpeningInventory(ctx.user, input);
      const count = result.lots?.length || 1;
      notice(`${result.product.product_name} added to ${count} space${count === 1 ? "" : "s"}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  updateLocationCount();
}
