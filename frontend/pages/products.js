import { createProduct, listProducts } from "../js/api-smooth1.js";
import { can } from "../js/permissions.js";
import { escapeHtml, formToObject, notice, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Products", "Add products and let the system create scan values");
  const products = await listProducts();
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "products:create") ? productForm() : ""}
      <section class="panel">
        <div class="panel-header"><h2>Product Catalog</h2></div>
        ${table([
          { label: "Product ID", key: "product_id" },
          { label: "Name", key: "product_name" },
          { label: "Category", key: "product_category" },
          { label: "Purchase Unit", key: "default_unit" },
          { label: "Base Unit", render: (row) => row.base_unit || row.default_unit },
          { label: "Units / Purchase Unit", render: (row) => row.units_per_purchase_unit || 1 },
          { label: "QR / Barcode", key: "barcode_or_qr_value" },
          { label: "Status", render: (row) => status(row.is_active ? "ACTIVE" : "INACTIVE") }
        ], products)}
      </section>
    </div>
  `;

  document.getElementById("productForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const product = await createProduct(ctx.user, formToObject(event.currentTarget));
      notice(`Product saved: ${product.product_id}. Use ${product.barcode_or_qr_value} to test scanning.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function productForm() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Add Product</h2></div>
      <form id="productForm" class="form-grid">
        <div class="field"><label>Product ID</label><input name="product_id" placeholder="Auto if blank"></div>
        <div class="field"><label>Product Name</label><input name="product_name" required></div>
        <div class="field">
          <label>Category</label>
          <select name="product_category" required>
            <option value="">Select category</option>
            <option>Packaging</option>
            <option>Ingredients</option>
            <option>Labels</option>
            <option>Finished Goods</option>
            <option>Supplies</option>
            <option>Hardware</option>
            <option>Other</option>
          </select>
        </div>
        <div class="field">
          <label>Purchase Unit</label>
          <select name="default_unit">
            <option>CASE</option>
            <option>BOX</option>
            <option>BAG</option>
            <option>LB</option>
            <option>EACH</option>
            <option>ROLL</option>
            <option>BUNDLE</option>
            <option>PALLET</option>
          </select>
        </div>
        <div class="field">
          <label>Base Inventory Unit</label>
          <select name="base_unit">
            <option>LB</option>
            <option>EACH</option>
            <option>CASE</option>
            <option>BOX</option>
            <option>BAG</option>
            <option>ROLL</option>
            <option>BUNDLE</option>
          </select>
        </div>
        <div class="field"><label>Units Per Purchase Unit</label><input name="units_per_purchase_unit" type="number" min="0.01" step="0.01" value="1"></div>
        <div class="field">
          <label>Breakable?</label>
          <select name="can_break_case">
            <option value="TRUE">Yes</option>
            <option value="FALSE">No</option>
          </select>
        </div>
        <div class="field"><label>Velocity Class</label><select name="velocity_class"><option value="">Auto/Unknown</option><option>FAST</option><option>MEDIUM</option><option>SLOW</option></select></div>
        <div class="field"><label>Amazon SKU</label><input name="amazon_sku"></div>
        <div class="field"><label>Wholesale Lot #</label><input name="wholesale_sku"></div>
        <div class="field"><label>Case Weight Lbs</label><input name="case_weight_lbs" type="number" min="0" step="0.01"></div>
        <div class="field full"><p class="muted">Example: Tamarindo bought as CASE, base unit LB, units per purchase unit 25. Receiving 30 CASE creates 750 LB in inventory.</p></div>
        <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field full"><button class="btn" type="submit">Save Product</button></div>
      </form>
    </section>
  `;
}
