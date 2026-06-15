import { getPurchaseOrderDetail, listPurchaseOrders, receiveProduct } from "../js/api.js?v=phonefix1";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js";
import { formToObject, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Receive Product", "Receive against purchase orders and create lot/movement records");
  const purchaseOrders = (await listPurchaseOrders()).filter((po) => ["DRAFT", "SENT", "ORDERED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(po.po_status));
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <h2>Receiving Form</h2>
          <div class="actions">
            <button id="startCamera" class="btn secondary" type="button">Start Camera</button>
            <button id="stopCamera" class="btn secondary" type="button">Stop Camera</button>
          </div>
        </div>
        <form id="receiveForm" class="form-grid">
          <div class="field full">
            <label>Purchase Order</label>
            <select id="poSelect" name="po_id" required>
              <option value="">Select PO</option>
              ${purchaseOrders.map((po) => `<option value="${po.po_id}">${po.po_id} - ${po.supplier?.supplier_name || po.supplier_id} (${po.po_status})</option>`).join("")}
            </select>
          </div>
          <div id="poLines" class="field full"></div>
          <div class="field"><label>Product/Lot Scan</label><input id="receiveScan" name="scan_code" placeholder="Scan product or lot and press Enter"></div>
          <div class="field"><label>Supplier Lot Number</label><input name="supplier_lot_number" placeholder="Not unique"></div>
          <div class="field"><label>Internal Lot ID</label><input name="internal_lot_id" placeholder="Auto if blank"></div>
          <div class="field"><label>Quantity Received</label><input name="qty_received" type="number" min="1" value="1" required></div>
          <div class="field"><label>Damaged Qty</label><input name="qty_damaged" type="number" min="0" value="0"></div>
          <div class="field"><label>Quality Score</label><input name="quality_score" type="number" min="1" max="5" value="5"></div>
          <div class="field"><label>Location Scan</label><input id="locationScan" name="confirmed_location_id" placeholder="Scan location QR"></div>
          <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
          <div class="field full"><button class="btn" type="submit">Confirm Receiving</button></div>
        </form>
        <div id="cameraReader"></div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Scan Feedback</h2></div>
        <div id="receiveResult" class="result">Select a PO, then scan the product or lot.</div>
      </section>
    </div>
  `;

  const poSelect = document.getElementById("poSelect");
  poSelect.addEventListener("change", async () => renderLines(poSelect.value));
  const scanInput = document.getElementById("receiveScan");
  handleKeyboardScan(scanInput, (value) => {
    document.getElementById("receiveResult").textContent = `Captured product/lot scan: ${value}`;
  });
  handleKeyboardScan(document.getElementById("locationScan"), (value) => {
    document.getElementById("receiveResult").textContent = `Captured location scan: ${value}`;
  });

  document.getElementById("startCamera").addEventListener("click", async () => {
    try {
      await startCameraScanner("receiveScan", (value) => {
        document.getElementById("receiveResult").textContent = `Camera captured: ${value}`;
      });
    } catch (error) {
      notice(error.message);
    }
  });
  document.getElementById("stopCamera").addEventListener("click", stopCameraScanner);

  document.getElementById("receiveForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await receiveProduct(ctx.user, formToObject(event.currentTarget));
      notice(`Received into ${result.lot.internal_lot_id} at ${result.lot.current_location_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

async function renderLines(poId) {
  const target = document.getElementById("poLines");
  if (!poId) {
    target.innerHTML = "";
    return;
  }
  const detail = await getPurchaseOrderDetail(poId);
  target.innerHTML = `
    <label>Expected Products</label>
    ${table([
      { label: "Use", render: (line) => `<input type="radio" name="po_line_id" value="${line.po_line_id}" required>` },
      { label: "Product", render: (line) => line.product?.product_name || line.product_id },
      { label: "Ordered", key: "qty_ordered" },
      { label: "Received", key: "qty_received_total" },
      { label: "Remaining", key: "qty_remaining" },
      { label: "Unit", key: "unit_type" }
    ], detail.lines)}
  `;
}
