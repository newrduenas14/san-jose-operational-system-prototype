import { createPurchaseOrder, listProducts, listPurchaseOrders, listSuppliers, purchaseOrderAction } from "../js/api.js";
import { can } from "../js/permissions.js";
import { formToObject, notice, status, table } from "../js/utils.js";

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
      <button class="btn secondary" data-po-action="print" data-po-id="${row.po_id}" type="button">Print</button>
      <button class="btn secondary" data-po-action="send" data-po-id="${row.po_id}" type="button">Send</button>
      <button class="btn" data-po-action="markSent" data-po-id="${row.po_id}" type="button">Mark Sent</button>
    </div>
  `;
}
