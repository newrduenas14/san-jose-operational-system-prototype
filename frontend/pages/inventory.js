import { inventorySnapshot, lookupScan } from "../js/api.js?v=opsupdate1";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=opsupdate1";
import { escapeHtml, table } from "../js/utils.js";

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
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Current Inventory Snapshot</h2></div>
        ${table([
          { label: "Product", render: (row) => escapeHtml(row.product?.product_name || row.product_id) },
          { label: "Product ID", key: "product_id" },
          { label: "Internal Lot", key: "internal_lot_id" },
          { label: "Supplier Lot", render: (row) => escapeHtml(row.lot?.supplier_lot_number || "") },
          { label: "Location", key: "location_id" },
          { label: "Qty", key: "qty" },
          { label: "Unit", key: "unit_type" }
        ], rows)}
      </section>
    </div>
  `;

  const handleInventoryScan = async (value) => {
    const match = await lookupScan(value);
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
}
