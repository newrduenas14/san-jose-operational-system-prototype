import { createProduct, inventorySnapshot, listProducts, updateProductStatus } from "../js/api-smooth1.js";
import { can } from "../js/permissions.js";
import { enableTableSorting, escapeHtml, formToObject, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Products", "Create product records for purchasing and inventory learning");
  const [products, inventoryRows] = await Promise.all([listProducts(), inventorySnapshot()]);
  const inventoryByProduct = inventoryTotalsByProduct(inventoryRows);
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "products:create") ? productForm(products) : ""}
      <section class="panel">
        <div class="panel-header"><h2>Product Catalog</h2></div>
        ${table([
          { label: "Product ID", key: "product_id", sortable: true },
          { label: "Name", key: "product_name", sortable: true },
          { label: "Purchase Unit", key: "default_unit", sortable: true },
          {
            label: "Lbs / Purchase Unit",
            sortable: true,
            sortType: "number",
            sortDirection: "desc",
            sortValue: (row) => Number(row.case_weight_lbs || row.units_per_purchase_unit || 0),
            render: (row) => formatNumber(row.case_weight_lbs || row.units_per_purchase_unit || 0)
          },
          {
            label: "Inventory",
            sortable: true,
            sortType: "number",
            sortDirection: "desc",
            sortValue: (row) => inventoryByProduct[row.product_id]?.purchaseUnits || 0,
            render: (row) => inventoryText(inventoryByProduct[row.product_id])
          },
          {
            label: "Status",
            sortable: true,
            sortValue: (row) => isProductActive(row) ? "Active" : "Off",
            render: (row) => productStatus(row, ctx.user)
          }
        ], products)}
      </section>
    </div>
  `;

  enableTableSorting(ctx.view);

  document.getElementById("productForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const product = await createProduct(ctx.user, formToObject(event.currentTarget));
      notice(`Product saved: ${product.product_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });

  document.querySelectorAll("[data-product-status]").forEach((control) => {
    control.addEventListener("change", async (event) => {
      const checkbox = event.currentTarget;
      try {
        await updateProductStatus(ctx.user, checkbox.dataset.productStatus, checkbox.checked);
        notice(`${checkbox.dataset.productStatus} is now ${checkbox.checked ? "active" : "off"}.`);
        await render(ctx);
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        notice(error.message);
      }
    });
  });
}

function productForm(products) {
  const productNames = unique(products.map((product) => product.product_name).filter(Boolean));
  return `
    <section class="panel">
      <div class="panel-header"><h2>Add Product</h2></div>
      <form id="productForm" class="form-grid">
        <input name="base_unit" type="hidden" value="LB">
        <input name="can_break_case" type="hidden" value="TRUE">
        <div class="field">
          <label>Product Name</label>
          <input name="product_name" list="productNameOptions" required>
          <datalist id="productNameOptions">
            ${productNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
          </datalist>
        </div>
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
            <option>LB</option>
            <option>BOX</option>
            <option>EACH</option>
            <option>BAG</option>
            <option>ROLL</option>
          </select>
        </div>
        <div class="field"><label>Amount Per Purchase Unit</label><input name="amount_per_purchase_unit" type="number" min="0.01" step="0.01" value="1" required></div>
        <div class="field"><label>Weight Per Purchase Unit Lbs</label><input name="case_weight_lbs" type="number" min="0" step="0.01" required></div>
        <div class="field"><label>Perishability Days</label><input name="perishability_days" type="number" min="0" step="1" placeholder="0 if none"></div>
        <div class="field full"><button class="btn" type="submit">Save Product</button></div>
      </form>
    </section>
  `;
}

function inventoryTotalsByProduct(rows) {
  return rows.reduce((totals, row) => {
    const key = row.product_id;
    if (!key) return totals;
    const purchaseUnit = row.product?.default_unit || "";
    const baseUnit = row.unit_type || row.product?.base_unit || "";
    const total = totals[key] || { purchaseUnits: 0, lbs: 0, unit: purchaseUnit || baseUnit };
    const qty = Number(row.qty || row.current_qty || 0);
    const lbsPerUnit = Number(row.product?.case_weight_lbs || row.product?.units_per_purchase_unit || 0);
    if (String(baseUnit).toUpperCase() === "LB") {
      total.lbs += qty;
      total.purchaseUnits += lbsPerUnit > 0 ? qty / lbsPerUnit : qty;
    } else {
      total.purchaseUnits += qty;
      total.lbs += lbsPerUnit > 0 ? qty * lbsPerUnit : 0;
    }
    totals[key] = total;
    return totals;
  }, {});
}

function inventoryText(total) {
  if (!total) return "0";
  const unit = total.unit ? ` ${escapeHtml(total.unit)}` : "";
  const lbs = total.lbs > 0 ? ` / ${formatNumber(total.lbs)} LB` : "";
  return `${formatNumber(total.purchaseUnits)}${unit}${lbs}`;
}

function productStatus(row, user) {
  const checked = isProductActive(row);
  if (!can(user, "products:edit")) return checked ? "ACTIVE" : "OFF";
  return `
    <label class="switch">
      <input data-product-status="${escapeHtml(row.product_id)}" type="checkbox" ${checked ? "checked" : ""}>
      <span>${checked ? "Active" : "Off"}</span>
    </label>
  `;
}

function isProductActive(row) {
  return row.is_active === true || String(row.is_active).toUpperCase() === "TRUE";
}

function unique(values) {
  return Array.from(new Set(values));
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}
