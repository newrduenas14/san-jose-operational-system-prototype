import { inventorySnapshot, lookupScan, recordInventoryMovement } from "../js/api-smooth1.js?v=parties1";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=smooth1";
import { escapeHtml, formToObject, formatQuantity, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Inventory Lookup", "Inventory is calculated from movement records");
  const rows = await inventorySnapshot();
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <h2>Lookup by Scan</h2>
          <div class="actions">
            <button id="scanInventoryQr" class="btn secondary" type="button">Scan</button>
          </div>
        </div>
        <div class="scan-box">
          <div class="field"><label>Scan product, lot, location, or package</label><input id="inventoryScan" placeholder="Scan and press Enter"></div>
          <div id="inventoryResult" class="result">Waiting for scan.</div>
        </div>
        <div id="cameraReader"></div>
        <form id="movementForm" class="form-grid">
          <div class="field"><label>Internal Lot ID</label><input name="internal_lot_id" required placeholder="Scan or type lot"></div>
          <div class="field">
            <label>Movement Type</label>
            <select name="movement_type">
              <option>SALE</option>
              <option>USE</option>
              <option>ADJUST_OUT</option>
              <option>ADJUST_IN</option>
            </select>
          </div>
          <div class="field"><label>Quantity</label><input name="qty" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label>Unit</label><input name="unit_type" placeholder="Auto from lot"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" placeholder="Example: sold 40 LB from supplier lot"></textarea></div>
          <div class="field full"><button class="btn" type="submit">Record Movement</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Current Inventory Snapshot</h2></div>
        ${table([
          { label: "Product", render: (row) => escapeHtml(row.product?.product_name || row.product_id) },
          { label: "Product ID", key: "product_id" },
          { label: "Internal Lot", key: "internal_lot_id" },
          { label: "Supplier Lot", render: (row) => escapeHtml(row.lot?.supplier_lot_number || "") },
          { label: "Location", key: "location_id" },
          { label: "Qty", render: (row) => formatQuantity(row.qty) },
          { label: "Purchase Units", render: (row) => escapeHtml(purchaseUnits(row)) },
          { label: "Base Unit", key: "unit_type" }
        ], rows)}
      </section>
    </div>
  `;

  const handleInventoryScan = async (value) => {
    const match = await lookupScan(value);
    if (match?.type === "LOT") fillMovementForm(match.record);
    document.getElementById("inventoryResult").innerHTML = match
      ? `<strong>${match.type}</strong><pre>${escapeHtml(JSON.stringify(match.record, null, 2))}</pre>`
      : `No inventory match for <strong>${escapeHtml(value)}</strong>.`;
  };

  handleKeyboardScan(document.getElementById("inventoryScan"), handleInventoryScan);
  document.getElementById("scanInventoryQr").addEventListener("click", async () => {
    try {
      await startCameraScanner("inventoryScan", (value) => {
        handleInventoryScan(value);
        stopCameraScanner();
      });
    } catch (error) {
      document.getElementById("inventoryResult").textContent = error.message;
    }
  });

  document.getElementById("movementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await recordInventoryMovement(ctx.user, formToObject(event.currentTarget));
      notice(`Movement saved: ${result.movement_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function purchaseUnits(row) {
  const lot = row.lot || {};
  const received = Number(lot.purchase_qty_received || 0);
  const original = Number(lot.original_qty || 0);
  const weightPerUnit = received > 0 ? original / received : 0;
  const purchaseUnit = lot.purchase_unit_type || "";
  if (!weightPerUnit || !purchaseUnit) return "—";
  const units = Number(row.qty || 0) / weightPerUnit;
  return `${formatQuantity(units)} ${purchaseUnit}`;
}

function fillMovementForm(lot) {
  const form = document.getElementById("movementForm");
  if (!form) return;
  form.elements.internal_lot_id.value = lot.internal_lot_id || "";
  form.elements.unit_type.value = lot.unit_type || "";
}
