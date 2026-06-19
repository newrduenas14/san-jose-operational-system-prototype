import { createPurchaseOrder, getPurchaseOrderDetail, listProducts, listPurchaseOrders, listSuppliers, purchaseOrderAction } from "../js/api-smooth1.js?v=po-builder1";
import { can } from "../js/permissions.js";
import { escapeHtml, notice, status, table } from "../js/utils.js";

const PURCHASE_UNITS = ["BOX", "CASE", "BAG", "PALLET", "EACH", "DRUM", "TOTE", "LB"];
const SHIP_METHODS = [
  ["SUPPLIER_DELIVERY", "Supplier Delivery"],
  ["CUSTOMER_PICKUP", "Customer Pickup"],
  ["LTL_FREIGHT", "LTL Freight"],
  ["COMMON_CARRIER", "Common Carrier"],
  ["PARCEL", "Parcel"],
  ["OTHER", "Other"]
];

let nextDraftLineId = 1;

export async function render(ctx) {
  ctx.setTitle("Purchase Orders", "Create multi-product orders with receiving QR codes");
  const [purchaseOrders, products, suppliers] = await Promise.all([listPurchaseOrders(), listProducts(), listSuppliers()]);
  const activeProducts = products.filter(isActive);
  const activeSuppliers = suppliers.filter(isActive);

  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "purchaseOrders:create") ? poForm(activeProducts, activeSuppliers) : ""}
      <section class="panel">
        <div class="panel-header"><h2>Purchase Orders</h2></div>
        ${table([
          { label: "PO", key: "po_id" },
          { label: "Date", render: (row) => escapeHtml(formatDate(row.order_date)) },
          { label: "Supplier", render: (row) => escapeHtml(row.supplier?.supplier_name || row.supplier_id) },
          { label: "Products", render: (row) => escapeHtml(row.line_count || 0) },
          { label: "Total", render: (row) => money(row.total_amount) },
          { label: "Status", render: (row) => status(row.po_status) },
          { label: "Actions", render: (row) => actionButtons(ctx, row) }
        ], purchaseOrders)}
      </section>
    </div>
  `;

  setupPoBuilder(ctx, activeProducts, activeSuppliers);
  setupPurchaseOrderActions(ctx);
}

function poForm(products, suppliers) {
  const productOptions = products.map((product) => `
    <option value="${escapeHtml(productOptionLabel(product))}"></option>
  `).join("");
  return `
    <section class="panel po-builder">
      <div class="panel-header"><h2>Create Purchase Order</h2></div>
      <form id="poForm">
        <div class="po-header-grid">
          <div class="field">
            <label>Supplier</label>
            <select name="supplier_id" required>
              <option value="">Select supplier</option>
              ${suppliers.map((supplier) => `<option value="${escapeHtml(supplier.supplier_id)}">${escapeHtml(supplier.supplier_name)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Purchase Date</label><input name="order_date" type="date" value="${todayValue()}" required></div>
          <div class="field">
            <label>Ship Via</label>
            <select name="ship_via" required>
              ${SHIP_METHODS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Expected Delivery</label><input name="expected_delivery_date" type="date" readonly></div>
          <div class="field">
            <label>Tax</label>
            <label class="switch po-tax-switch"><input name="tax_enabled" type="checkbox"><span>Apply tax</span></label>
          </div>
          <div class="field">
            <label>Tax Rate</label>
            <div class="input-suffix"><input name="tax_rate_percent" type="number" min="0" step="0.01" value="6.25" disabled><span>%</span></div>
          </div>
        </div>

        <datalist id="poProductOptions">${productOptions}</datalist>
        <div class="po-lines-heading">
          <h3>Products</h3>
          <button id="addPoLine" class="btn secondary" type="button">Add Product</button>
        </div>
        <div id="poLineItems" class="po-line-items"></div>

        <div class="po-footer">
          <div class="po-totals" aria-live="polite">
            <div><span>Subtotal</span><strong id="poSubtotal">$0.00</strong></div>
            <div><span>Tax</span><strong id="poTax">$0.00</strong></div>
            <div class="po-grand-total"><span>Total</span><strong id="poTotal">$0.00</strong></div>
          </div>
          <button class="btn" type="submit">Create Purchase Order</button>
        </div>
      </form>
    </section>
  `;
}

function setupPoBuilder(ctx, products, suppliers) {
  const form = document.getElementById("poForm");
  if (!form) return;
  const container = document.getElementById("poLineItems");
  const productLookup = buildProductLookup(products);
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.supplier_id, supplier]));

  appendPoLine(container);
  updateExpectedDelivery(form, supplierMap);
  updatePoTotals(form);

  document.getElementById("addPoLine").addEventListener("click", () => {
    appendPoLine(container);
    updateRemoveButtons(container);
  });

  form.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-po-line]");
    if (!removeButton) return;
    removeButton.closest(".po-line-item")?.remove();
    updateRemoveButtons(container);
    updatePoTotals(form);
  });

  form.addEventListener("input", (event) => {
    const lineElement = event.target.closest(".po-line-item");
    if (lineElement) {
      if (event.target.matches("[data-product-search]")) {
        const product = productLookup.get(normalizeLookup(event.target.value));
        lineElement.querySelector("[data-product-id]").value = product?.product_id || "";
      }
      updatePoLine(lineElement);
    }
    if (event.target.name === "tax_rate_percent") updatePoTotals(form);
  });

  form.addEventListener("change", (event) => {
    if (event.target.name === "tax_enabled") {
      form.elements.tax_rate_percent.disabled = !event.target.checked;
      updatePoTotals(form);
    }
    if (["supplier_id", "order_date"].includes(event.target.name)) {
      updateExpectedDelivery(form, supplierMap);
    }
    const lineElement = event.target.closest(".po-line-item");
    if (lineElement) updatePoLine(lineElement);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = collectPurchaseOrder(form, productLookup);
      const result = await createPurchaseOrder(ctx.user, input);
      const lineCount = result.lines?.length || input.lines.length;
      notice(`${result.po_id} created with ${lineCount} product${lineCount === 1 ? "" : "s"}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function appendPoLine(container) {
  const lineId = `draft-po-line-${nextDraftLineId++}`;
  container.insertAdjacentHTML("beforeend", `
    <section class="po-line-item" data-draft-line-id="${lineId}">
      <div class="po-line-title">
        <strong>Product</strong>
        <button class="po-remove-line" data-remove-po-line type="button" aria-label="Remove product" title="Remove product">&times;</button>
      </div>
      <div class="po-line-grid">
        <div class="field po-product-field">
          <label>Product Search</label>
          <input data-product-search list="poProductOptions" placeholder="Name or Product ID" autocomplete="off" required>
          <input data-product-id type="hidden">
        </div>
        <div class="field"><label>Quantity Purchased</label><input data-line-field="qty_ordered" type="number" min="1" step="1" value="1" required></div>
        <div class="field">
          <label>Purchase Unit</label>
          <select data-line-field="unit_type" required>${PURCHASE_UNITS.map((unit) => `<option>${unit}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Unit Weight Lbs</label><input data-line-field="case_weight_lbs" type="number" min="0.01" step="0.01" required></div>
        <div class="field"><label>Unit Cost</label><input data-line-field="unit_cost" type="number" min="0" step="0.01" value="0" required></div>
        <div class="field"><label>Supplier Lot (optional)</label><input data-line-field="supplier_expected_lot_number" autocomplete="off"></div>
      </div>
      <div class="po-line-summary">
        <span>Expected <strong data-expected-weight>0 LB</strong></span>
        <span>Line Total <strong data-line-total>$0.00</strong></span>
      </div>
    </section>
  `);
  updateRemoveButtons(container);
}

function updateRemoveButtons(container) {
  const lines = container.querySelectorAll(".po-line-item");
  lines.forEach((line) => {
    line.querySelector("[data-remove-po-line]").disabled = lines.length === 1;
  });
}

function updatePoLine(lineElement) {
  const qty = numericLineValue(lineElement, "qty_ordered");
  const weight = numericLineValue(lineElement, "case_weight_lbs");
  const cost = numericLineValue(lineElement, "unit_cost");
  lineElement.querySelector("[data-expected-weight]").textContent = `${formatNumber(qty * weight)} LB`;
  lineElement.querySelector("[data-line-total]").textContent = money(qty * cost);
  updatePoTotals(document.getElementById("poForm"));
}

function updatePoTotals(form) {
  if (!form) return;
  const subtotal = Array.from(form.querySelectorAll(".po-line-item")).reduce((sum, line) => {
    return sum + numericLineValue(line, "qty_ordered") * numericLineValue(line, "unit_cost");
  }, 0);
  const taxEnabled = form.elements.tax_enabled.checked;
  const taxRate = Number(form.elements.tax_rate_percent.value || 0) / 100;
  const tax = taxEnabled ? subtotal * taxRate : 0;
  document.getElementById("poSubtotal").textContent = money(subtotal);
  document.getElementById("poTax").textContent = money(tax);
  document.getElementById("poTotal").textContent = money(subtotal + tax);
}

function updateExpectedDelivery(form, supplierMap) {
  const supplier = supplierMap.get(form.elements.supplier_id.value);
  const orderDate = form.elements.order_date.value;
  if (!supplier || !orderDate) {
    form.elements.expected_delivery_date.value = "";
    return;
  }
  const leadDays = Math.max(0, Number(supplier.lead_time_expected_days || 5));
  const date = new Date(`${orderDate}T12:00:00`);
  date.setDate(date.getDate() + Math.round(leadDays));
  form.elements.expected_delivery_date.value = date.toISOString().slice(0, 10);
}

function collectPurchaseOrder(form, productLookup) {
  const supplierId = form.elements.supplier_id.value;
  if (!supplierId) throw new Error("Select a supplier.");
  const lines = Array.from(form.querySelectorAll(".po-line-item")).map((line, index) => {
    const lookupValue = line.querySelector("[data-product-search]").value;
    const product = productLookup.get(normalizeLookup(lookupValue));
    const productId = line.querySelector("[data-product-id]").value || product?.product_id || "";
    const qty = numericLineValue(line, "qty_ordered");
    const unitWeight = numericLineValue(line, "case_weight_lbs");
    const unitCost = numericLineValue(line, "unit_cost");
    const unitType = line.querySelector('[data-line-field="unit_type"]').value;
    if (!productId) throw new Error(`Select a valid product on line ${index + 1}.`);
    if (qty <= 0) throw new Error(`Quantity must be greater than zero on line ${index + 1}.`);
    if (!unitType) throw new Error(`Select a purchase unit on line ${index + 1}.`);
    if (unitWeight <= 0) throw new Error(`Unit weight must be greater than zero on line ${index + 1}.`);
    if (unitCost < 0) throw new Error(`Unit cost cannot be negative on line ${index + 1}.`);
    return {
      product_id: productId,
      qty_ordered: qty,
      unit_type: unitType,
      case_weight_lbs: unitWeight,
      unit_cost: unitCost,
      supplier_expected_lot_number: line.querySelector('[data-line-field="supplier_expected_lot_number"]').value.trim()
    };
  });
  return {
    supplier_id: supplierId,
    order_date: form.elements.order_date.value,
    expected_delivery_date: form.elements.expected_delivery_date.value,
    ship_via: form.elements.ship_via.value,
    tax_enabled: form.elements.tax_enabled.checked,
    tax_rate_percent: Number(form.elements.tax_rate_percent.value || 6.25),
    lines
  };
}

function setupPurchaseOrderActions(ctx) {
  document.querySelectorAll("[data-po-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { poId, poAction } = button.dataset;
      if (poAction === "print") {
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          notice("Pop-up blocked. Allow pop-ups to view the purchase order.");
          return;
        }
        try {
          printWindow.document.write("<p>Preparing purchase order...</p>");
          const detail = await getPurchaseOrderDetail(poId);
          printWindow.document.open();
          printWindow.document.write(printablePurchaseOrderHtml(detail));
          printWindow.document.close();
          printWindow.focus();
        } catch (error) {
          printWindow.close();
          notice(error.message);
        }
        return;
      }
      if (poAction === "markSent") {
        try {
          await purchaseOrderAction(ctx.user, poId, "markSent");
          notice(`${poId} marked as sent.`);
          await render(ctx);
        } catch (error) {
          notice(error.message);
        }
      }
    });
  });
}

function actionButtons(ctx, row) {
  if (!can(ctx.user, "purchaseOrders:actions")) return "";
  const canMarkSent = !["SENT", "COMPLETE"].includes(String(row.po_status || "").toUpperCase());
  return `
    <div class="actions po-actions">
      <button class="btn secondary" data-po-action="print" data-po-id="${escapeHtml(row.po_id)}" type="button">View / Print</button>
      ${canMarkSent ? `<button class="btn" data-po-action="markSent" data-po-id="${escapeHtml(row.po_id)}" type="button">Mark Sent</button>` : ""}
    </div>
  `;
}

function printablePurchaseOrderHtml(detail) {
  if (!detail) throw new Error("Purchase order was not found.");
  const { po, lines } = detail;
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(po.po_id)} Purchase Order</title>
        <style>
          body { font-family: Arial, sans-serif; color: #17211b; margin: 24px; }
          button { padding: 9px 14px; margin-bottom: 18px; }
          h1, h2 { margin: 0 0 12px; }
          .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 18px; border: 1px solid #d8e1da; padding: 14px; margin-bottom: 18px; }
          .meta span, .totals span { color: #607064; font-size: 12px; font-weight: 700; }
          .meta strong, .totals strong { display: block; margin-top: 4px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
          th, td { border: 1px solid #d8e1da; padding: 8px; text-align: left; }
          th { background: #eaf3ec; font-size: 12px; }
          .number { text-align: right; }
          .totals { margin-left: auto; width: 260px; }
          .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
          .totals .grand { border-top: 2px solid #17211b; margin-top: 4px; padding-top: 9px; }
          .qr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
          .qr-card { border: 1px solid #d8e1da; padding: 14px; page-break-inside: avoid; }
          .qr-card img { display: block; height: 170px; margin: 10px auto 0; width: 170px; }
          .qr-card p { margin: 5px 0; }
          @media print { button { display: none; } body { margin: 10mm; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Print Purchase Order</button>
        <h1>Purchase Order ${escapeHtml(po.po_id)}</h1>
        <section class="meta">
          ${printMeta("Supplier", po.supplier?.supplier_name || po.supplier_id)}
          ${printMeta("Status", po.po_status)}
          ${printMeta("Purchase Date", formatDate(po.order_date))}
          ${printMeta("Expected Delivery", formatDate(po.expected_delivery_date) || "Not set")}
          ${printMeta("Ship Via", displayShipVia(po.ship_via))}
          ${printMeta("Payment Terms", po.payment_terms || "")}
        </section>
        <table>
          <thead><tr><th>Product</th><th>Purchase Unit</th><th class="number">Qty</th><th class="number">Unit Weight</th><th class="number">Expected</th><th class="number">Unit Cost</th><th class="number">Line Total</th><th>Expected Lot</th></tr></thead>
          <tbody>${lines.map((line) => `
            <tr>
              <td>${escapeHtml(line.product?.product_name || line.product_id)}<br><small>${escapeHtml(line.product_id)}</small></td>
              <td>${escapeHtml(line.unit_type)}</td>
              <td class="number">${escapeHtml(formatNumber(line.qty_ordered))}</td>
              <td class="number">${escapeHtml(formatNumber(line.case_weight_lbs || line.units_per_purchase_unit))} LB</td>
              <td class="number">${escapeHtml(formatNumber(line.expected_base_qty))} LB</td>
              <td class="number">${money(line.unit_cost)}</td>
              <td class="number">${money(line.line_total)}</td>
              <td>${escapeHtml(line.supplier_expected_lot_number || "PENDING")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
        <section class="totals">
          <div><span>Subtotal</span><strong>${money(po.subtotal_amount)}</strong></div>
          <div><span>Tax${isTrue(po.tax_enabled) ? ` (${formatNumber(Number(po.tax_rate || 0) * 100)}%)` : ""}</span><strong>${money(po.tax_amount)}</strong></div>
          <div class="grand"><span>Total</span><strong>${money(po.total_amount)}</strong></div>
        </section>
        <h2>Receiving QR Codes</h2>
        <section class="qr-grid">
          ${lines.map((line) => `
            <article class="qr-card">
              <strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong>
              <p>PO: ${escapeHtml(po.po_id)}</p>
              <p>Line: ${escapeHtml(line.po_line_id)}</p>
              <p>Pack: ${escapeHtml(line.unit_type)} x ${escapeHtml(formatNumber(line.case_weight_lbs || line.units_per_purchase_unit))} LB</p>
              <p>Supplier Lot: ${escapeHtml(line.supplier_expected_lot_number || "PENDING")}</p>
              <img alt="Receiving QR for ${escapeHtml(line.product?.product_name || line.product_id)}" src="${qrImageUrl(qrValueForLine(po, line))}">
            </article>
          `).join("")}
        </section>
      </body>
    </html>
  `;
}

function buildProductLookup(products) {
  const lookup = new Map();
  const nameCounts = products.reduce((counts, product) => {
    const name = normalizeLookup(product.product_name);
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
  products.forEach((product) => {
    lookup.set(normalizeLookup(productOptionLabel(product)), product);
    lookup.set(normalizeLookup(product.product_id), product);
    const name = normalizeLookup(product.product_name);
    if (nameCounts[name] === 1) lookup.set(name, product);
  });
  return lookup;
}

function productOptionLabel(product) {
  return `${product.product_name} | ${product.product_id}`;
}

function numericLineValue(lineElement, field) {
  return Number(lineElement.querySelector(`[data-line-field="${field}"]`)?.value || 0);
}

function normalizeLookup(value) {
  return String(value || "").trim().toLowerCase();
}

function isActive(record) {
  return record.is_active === true || String(record.is_active).toUpperCase() === "TRUE";
}

function isTrue(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function qrValueForLine(po, line) {
  if (line.qr_value) return line.qr_value;
  return JSON.stringify({
    v: 1,
    type: "PO_LINE",
    po_id: po.po_id,
    po_line_id: line.po_line_id,
    product_id: line.product_id,
    product_name: line.product?.product_name || line.product_id,
    qty: Number(line.qty_ordered || 0),
    supplier_lot_number: line.supplier_expected_lot_number || "PENDING"
  });
}

function printMeta(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "")}</strong></div>`;
}

function displayShipVia(value) {
  return SHIP_METHODS.find(([key]) => key === value)?.[1] || String(value || "").replaceAll("_", " ");
}

function qrImageUrl(value) {
  return `https://quickchart.io/qr?size=220&margin=2&text=${encodeURIComponent(value || "")}`;
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}
