import { inventorySnapshot, lookupScan } from "../js/api.js?v=phonefix1";
import { handleKeyboardScan } from "../js/scanner.js";
import { escapeHtml, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Inventory Lookup", "Inventory is calculated from movement records");
  const rows = await inventorySnapshot();
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header"><h2>Lookup by Scan</h2></div>
        <div class="scan-box">
          <div class="field"><label>Scan product, lot, location, or package</label><input id="inventoryScan" placeholder="Scan and press Enter"></div>
          <div id="inventoryResult" class="result">Waiting for scan.</div>
        </div>
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

  handleKeyboardScan(document.getElementById("inventoryScan"), async (value) => {
    const match = await lookupScan(value);
    document.getElementById("inventoryResult").innerHTML = match
      ? `<strong>${match.type}</strong><pre>${escapeHtml(JSON.stringify(match.record, null, 2))}</pre>`
      : `No inventory match for <strong>${escapeHtml(value)}</strong>.`;
  });
}
