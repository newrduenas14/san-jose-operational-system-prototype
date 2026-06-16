import { createPurchaseOrder, getPurchaseOrderDetail, listProducts, listPurchaseOrders, listSuppliers, purchaseOrderAction } from "../js/api.js?v=opsupdate1";
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
      const po = await createPurchaseOrder(ctx.user, formToObject(event.currentTarget));
      notice(`Purchase order saved: ${po.po_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });

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
        <div class="field"><label>Product</label><select name="product_id" required>${products.map((p) => `<option value="${p.product_id}">${p.product_name}</option>`).join("")}</select></div>
        <div class="field"><label>Quantity</label><input name="qty_ordered" type="number" min="1" value="1"></div>
        <div class="field"><label>Supplier Lot Number</label><input name="supplier_expected_lot_number" placeholder="Supplier lot if known"></div>
        <div class="field"><label>Unit Cost</label><input name="unit_cost" type="number" min="0" step="0.01" value="0"></div>
        <div class="field"><label>Unit Type</label><input name="unit_type" value="BOX"></div>
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

function qrImageUrl(value) {
  return `https://quickchart.io/qr?size=220&margin=2&text=${encodeURIComponent(value)}`;
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}
