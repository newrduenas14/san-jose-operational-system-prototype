import { createPurchaseOrder, getPurchaseOrderDetail, listProducts, listPurchaseOrders, listSuppliers, purchaseOrderAction } from "../js/api-smooth1.js";
import { can } from "../js/permissions.js";
import { escapeHtml, formToObject, notice, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Purchase Orders", "Create and test PO document placeholders");
  const [purchaseOrders, products, suppliers] = await Promise.all([listPurchaseOrders(), listProducts(), listSuppliers()]);
  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "purchaseOrders:create") ? poForm(products, suppliers) : ""}
      <section class="panel">
        <div class="panel-header"><h2>Purchase Orders</h2></div>
        ${table([
          { label: "PO", key: "po_id" },
          { label: "Status", render: (row) => status(row.po_status) },
          { label: "Supplier", render: (row) => row.supplier?.supplier_name || row.supplier_id },
          { label: "Total", render: (row) => `$${Number(row.total_amount || 0).toFixed(2)}` },
          { label: "Document Actions", render: (row) => actionButtons(ctx, row) }
        ], purchaseOrders)}
      </section>
    </div>
  `;

  document.getElementById("poForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = formToObject(event.currentTarget);
      input.supplier_expected_lot_number ||= supplierLotNumber(input.supplier_id, input.product_id);
      const po = await createPurchaseOrder(ctx.user, input);
      notice(`Purchase order saved: ${po.po_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });

  const poFormElement = document.getElementById("poForm");
  if (poFormElement) {
    const productMap = new Map(products.flatMap((product) => [
      [productOptionLabel(product), product],
      [String(product.product_id || ""), product],
      [String(product.product_name || ""), product],
      [String(product.wholesale_sku || ""), product]
    ]).filter(([key]) => key));
    const updateSupplierLot = () => {
      const input = formToObject(poFormElement);
      poFormElement.elements.supplier_expected_lot_number.value = supplierLotNumber(input.supplier_id, input.product_id);
    };
    const updateProductFields = () => {
      const lookup = document.getElementById("productLookup").value.trim();
      const product = productMap.get(lookup);
      const qty = Number(poFormElement.elements.qty_ordered.value || 0);
      if (!product) {
        poFormElement.elements.product_id.value = "";
        return;
      }
      const unitsPerPurchaseUnit = Number(product.units_per_purchase_unit || product.case_weight_lbs || 1) || 1;
      poFormElement.elements.product_id.value = product.product_id;
      poFormElement.elements.unit_type.value = product.default_unit || "CASE";
      poFormElement.elements.case_weight_lbs.value = product.case_weight_lbs || "";
      poFormElement.elements.base_unit.value = product.base_unit || product.default_unit || "EACH";
      poFormElement.elements.units_per_purchase_unit.value = unitsPerPurchaseUnit;
      poFormElement.elements.expected_base_qty.value = qty ? qty * unitsPerPurchaseUnit : "";
      updateSupplierLot();
    };
    poFormElement.elements.supplier_id.addEventListener("change", updateSupplierLot);
    document.getElementById("productLookup").addEventListener("input", updateProductFields);
    poFormElement.elements.qty_ordered.addEventListener("input", updateProductFields);
    updateSupplierLot();
  }

  document.querySelectorAll("[data-po-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { poId, poAction } = button.dataset;
      if (poAction === "markSent") {
        await purchaseOrderAction(ctx.user, poId, poAction);
        notice(`${poId} marked as sent.`);
        await render(ctx);
      } else if (poAction === "printTemplate") {
        const template = await getPurchaseOrderDetail(poId);
        openPrintablePurchaseOrder(addQrValues(template));
      } else {
        notice(`${button.textContent} is a placeholder for ${poId}.`);
      }
    });
  });
}

function poForm(products, suppliers) {
  return `
    <section class="panel">
      <div class="panel-header"><h2>Create Purchase Order</h2></div>
      <form id="poForm" class="form-grid">
        <div class="field"><label>Supplier</label><select name="supplier_id" required>${suppliers.map((s) => `<option value="${s.supplier_id}">${s.supplier_name}</option>`).join("")}</select></div>
        <div class="field">
          <label>Product Search</label>
          <input id="productLookup" list="productOptions" placeholder="Name, Product ID, or Wholesale Lot #" required>
          <datalist id="productOptions">
            ${products.map((p) => `<option value="${escapeHtml(productOptionLabel(p))}"></option>`).join("")}
          </datalist>
          <input name="product_id" type="hidden" required>
        </div>
        <div class="field"><label>Quantity</label><input name="qty_ordered" type="number" min="1" value="1"></div>
        <div class="field"><label>Supplier Lot Number</label><input name="supplier_expected_lot_number" readonly></div>
        <div class="field"><label>Unit Cost</label><input name="unit_cost" type="number" min="0" step="0.01" value="0"></div>
        <div class="field"><label>Purchase Unit</label><input name="unit_type" readonly></div>
        <div class="field"><label>Case Weight Lbs</label><input name="case_weight_lbs" readonly></div>
        <div class="field"><label>Base Unit</label><input name="base_unit" readonly></div>
        <div class="field"><label>Units Per Purchase Unit</label><input name="units_per_purchase_unit" readonly></div>
        <div class="field"><label>Expected Base Qty</label><input name="expected_base_qty" readonly></div>
        <div class="field"><label>Expected Delivery</label><input name="expected_delivery_date" type="date"></div>
        <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="field full"><button class="btn" type="submit">Save PO</button></div>
      </form>
    </section>
  `;
}

function actionButtons(ctx, row) {
  if (!can(ctx.user, "purchaseOrders:actions")) return "";
  return `
    <div class="actions">
      <button class="btn secondary" data-po-action="generate" data-po-id="${row.po_id}" type="button">Generate PO</button>
      <button class="btn secondary" data-po-action="printTemplate" data-po-id="${row.po_id}" type="button">Print Template</button>
      <button class="btn secondary" data-po-action="send" data-po-id="${row.po_id}" type="button">Send</button>
      <button class="btn" data-po-action="markSent" data-po-id="${row.po_id}" type="button">Mark Sent</button>
    </div>
  `;
}

function openPrintablePurchaseOrder(template) {
  const win = window.open("", "_blank");
  if (!win) {
    notice("Pop-up blocked. Allow pop-ups to print purchase orders.");
    return;
  }
  win.document.write(printablePurchaseOrderHtml(template));
  win.document.close();
  win.focus();
}

function printablePurchaseOrderHtml({ po, lines }) {
  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(po.po_id)} Purchase Order</title>
        <style>
          body { font-family: Arial, sans-serif; color: #17211b; margin: 24px; }
          h1, h2 { margin: 0 0 10px; }
          .meta, .line { border: 1px solid #d8e1da; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
          .qr { width: 180px; height: 180px; }
          .muted { color: #607064; }
          @media print { button { display: none; } body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Print Purchase Order</button>
        <h1>Purchase Order ${escapeHtml(po.po_id)}</h1>
        <section class="meta grid">
          <div><strong>Supplier</strong><br>${escapeHtml(po.supplier?.supplier_name || po.supplier_id)}</div>
          <div><strong>Status</strong><br>${escapeHtml(po.po_status)}</div>
          <div><strong>Order Date</strong><br>${escapeHtml(formatDate(po.order_date))}</div>
          <div><strong>Expected Delivery</strong><br>${escapeHtml(formatDate(po.expected_delivery_date) || "Not set")}</div>
        </section>
        <h2>Receiving QR Codes</h2>
        ${lines.map((line) => `
          <section class="line">
            <div class="grid">
              <div>
                <strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong>
                <p class="muted">Product ID: ${escapeHtml(line.product_id)}</p>
                <p>Quantity Ordered: ${escapeHtml(line.qty_ordered)} ${escapeHtml(line.unit_type)}</p>
                <p>Expected Base Qty: ${escapeHtml(line.expected_base_qty || "")} ${escapeHtml(line.base_unit || "")}</p>
                <p>Supplier Lot: ${escapeHtml(line.supplier_expected_lot_number || "PENDING")}</p>
                <p>QR Value: <strong>${escapeHtml(line.qr_value)}</strong></p>
              </div>
              <div>
                <img class="qr" alt="Receiving QR" src="${qrImageUrl(line.qr_value)}">
              </div>
            </div>
          </section>
        `).join("")}
      </body>
    </html>
  `;
}

function addQrValues(template) {
  return {
    ...template,
    lines: template.lines.map((line) => ({
      ...line,
      qr_value: purchaseOrderQrValue(line.product_id, line.qty_ordered, line.supplier_expected_lot_number)
    }))
  };
}

function purchaseOrderQrValue(productId, qty, supplierLotNumber = "") {
  return [productId, `QTY:${Number(qty || 0)}`, `SUPLOT:${supplierLotNumber || "PENDING"}`].join("|");
}

function productOptionLabel(product) {
  const unit = product.default_unit || "UNIT";
  const base = product.base_unit || unit;
  const multiplier = product.units_per_purchase_unit || product.case_weight_lbs || 1;
  const lot = product.wholesale_sku ? ` | Lot ${product.wholesale_sku}` : "";
  return `${product.product_name} | ${product.product_id} | ${unit} x ${multiplier} ${base}${lot}`;
}

function supplierLotNumber(supplierId, productId) {
  const supplier = String(supplierId || "SUP").replace(/[^A-Z0-9]/gi, "").slice(-4).toUpperCase();
  const product = String(productId || "PROD").replace(/[^A-Z0-9]/gi, "").slice(-4).toUpperCase();
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `${supplier}-${product}-${date}`;
}

function qrImageUrl(value) {
  return `https://quickchart.io/qr?size=220&margin=2&text=${encodeURIComponent(value)}`;
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}
