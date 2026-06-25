import { createProduct, inventorySnapshot, listProducts, updateProductStatus } from "../js/api-smooth1.js?v=parties1";
import { can } from "../js/permissions.js";
import { enableTableSorting, escapeHtml, formToObject, formatQuantity, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Products", "Maintain the product master used across purchasing and inventory");
  const [products, inventoryRows] = await Promise.all([listProducts(), inventorySnapshot()]);
  const inventoryByProduct = inventoryTotalsByProduct(inventoryRows);
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "products:create") ? productForm() : ""}
      <section class="panel">
        <div class="panel-header"><h2>Product Catalog</h2></div>
        ${table([
          { label: "Product ID", key: "product_id", sortable: true },
          { label: "Name", key: "product_name", sortable: true },
          { label: "Category", key: "product_category", sortable: true },
          {
            label: "Perishability",
            sortable: true,
            sortType: "number",
            sortValue: (row) => Number(row.perishability_days || 0),
            render: (row) => formatPerishability(row.perishability_days)
          },
          {
            label: "Inventory",
            sortable: true,
            sortType: "number",
            sortDirection: "desc",
            sortValue: (row) => inventorySortValue(inventoryByProduct[row.product_id]),
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

function productForm() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Add Product</h2></div>
      <form id="productForm" class="form-grid">
        <div class="field">
          <label>Product Name</label>
          <input name="product_name" autocomplete="off" required>
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
        <div class="field"><label>Perishability Days</label><input name="perishability_days" type="number" min="0" step="1" value="0" required></div>
        <div class="field full"><button class="btn" type="submit">Save Product</button></div>
      </form>
    </section>
  `;
}

function inventoryTotalsByProduct(rows) {
  return rows.reduce((totals, row) => {
    const key = row.product_id;
    if (!key) return totals;
    const baseUnit = row.unit_type || row.product?.base_unit || "";
    const total = totals[key] || { lbs: 0, otherQty: 0, otherUnit: "" };
    const qty = Number(row.qty || row.current_qty || 0);
    const lbsPerUnit = Number(row.product?.case_weight_lbs || row.product?.units_per_purchase_unit || 0);
    if (String(baseUnit).toUpperCase() === "LB") {
      total.lbs += qty;
    } else if (lbsPerUnit > 0) {
      total.lbs += qty * lbsPerUnit;
    } else {
      total.otherQty += qty;
      total.otherUnit = baseUnit;
    }
    totals[key] = total;
    return totals;
  }, {});
}

function inventoryText(total) {
  if (!total) return "0";
  const values = [];
  if (total.lbs) values.push(`${formatNumber(total.lbs)} LB`);
  if (total.otherQty) values.push(`${formatNumber(total.otherQty)} ${escapeHtml(total.otherUnit)}`.trim());
  return values.join(" / ") || "0";
}

function inventorySortValue(total) {
  return total ? total.lbs || total.otherQty : 0;
}

function formatPerishability(value) {
  const days = Number(value || 0);
  return days > 0 ? `${formatNumber(days)} days` : "Non-perishable";
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

function formatNumber(value) {
  return formatQuantity(value);
}
