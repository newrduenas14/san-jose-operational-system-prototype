import { getPurchaseOrderDetail, listPurchaseOrders, receiveProduct } from "../js/api-smooth1.js";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=smooth1";
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
            <button id="scanReceiveQr" class="btn secondary" type="button">Scan</button>
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
          <div id="putAwayRecommendation" class="field full result">Select a PO to see the put-away recommendation placeholder.</div>
          <div class="field"><label>PO/Product QR Scan</label><input id="receiveScan" name="scan_code" placeholder="Scan PO QR, product, or lot"></div>
          <div class="field"><label>Supplier Lot Number</label><input name="supplier_lot_number" placeholder="Not unique"></div>
          <div class="field"><label>Internal Lot ID</label><input name="internal_lot_id" placeholder="Auto if blank"></div>
          <div class="field"><label>Purchase Qty Received</label><input name="qty_received" type="number" min="1" value="1" required></div>
          <div class="field"><label>Damaged Qty</label><input name="qty_damaged" type="number" min="0" value="0"></div>
          <div class="field"><label>Pallets Received</label><input name="pallet_count" type="number" min="0" value="1"></div>
          <div class="field"><label>Actual Base Qty</label><input name="actual_base_qty" type="number" min="0" step="0.01" placeholder="Auto from product"></div>
          <div id="baseQtyPreview" class="field full result">Select a PO line to preview base inventory quantity.</div>
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
  document.getElementById("receiveForm").addEventListener("input", updateBaseQtyPreview);
  document.getElementById("receiveForm").addEventListener("change", updateBaseQtyPreview);
  const scanInput = document.getElementById("receiveScan");
  handleKeyboardScan(scanInput, (value) => {
    handleReceivingScan(value);
  });
  handleKeyboardScan(document.getElementById("locationScan"), (value) => {
    document.getElementById("receiveResult").textContent = `Captured location scan: ${value}`;
  });

  document.getElementById("scanReceiveQr").addEventListener("click", async () => {
    try {
      await startCameraScanner("receiveScan", (value) => {
        handleReceivingScan(value);
        stopCameraScanner();
      });
    } catch (error) {
      notice(error.message);
    }
  });

  document.getElementById("receiveForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await receiveProduct(ctx.user, formToObject(event.currentTarget));
      notice(`Received ${result.lot.original_qty} ${result.lot.unit_type} into ${result.lot.internal_lot_id} at ${result.lot.current_location_id}.`);
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
    document.getElementById("putAwayRecommendation").textContent = "Select a PO to see the put-away recommendation placeholder.";
    return;
  }
  const detail = await getPurchaseOrderDetail(poId);
  const firstLine = detail.lines[0];
  document.getElementById("putAwayRecommendation").innerHTML = `
    <strong>Put-away recommendation placeholder</strong><br>
    Product: ${firstLine?.product?.product_name || firstLine?.product_id || "Select a line"}<br>
    Future rule: recommend a location from category, velocity, current capacity, FIFO, and temperature/zone rules.<br>
    For now: confirm the final location manually with the Location Scan field.
  `;
  target.innerHTML = `
    <label>Expected Products</label>
    ${table([
      { label: "Use", render: (line) => `<input type="radio" name="po_line_id" value="${line.po_line_id}" data-product-id="${line.product_id}" data-unit="${line.unit_type || ""}" data-base-unit="${line.base_unit || line.product?.base_unit || line.unit_type || ""}" data-units-per="${line.units_per_purchase_unit || line.product?.units_per_purchase_unit || line.product?.case_weight_lbs || 1}" required>` },
      { label: "Product", render: (line) => line.product?.product_name || line.product_id },
      { label: "Supplier Lot", key: "supplier_expected_lot_number" },
      { label: "Ordered", key: "qty_ordered" },
      { label: "Received", key: "qty_received_total" },
      { label: "Remaining", key: "qty_remaining" },
      { label: "Purchase Unit", key: "unit_type" },
      { label: "Expected Base", render: (line) => `${line.expected_base_qty || ""} ${line.base_unit || line.product?.base_unit || ""}` }
    ], detail.lines)}
  `;
  target.querySelectorAll("[name='po_line_id']").forEach((radio) => {
    radio.addEventListener("change", updateBaseQtyPreview);
  });
  updateBaseQtyPreview();
}

function handleReceivingScan(value) {
  const parsed = parsePurchaseOrderQr(value);
  if (parsed) {
    document.querySelector("[name='qty_received']").value = parsed.qty || 1;
    document.querySelector("[name='supplier_lot_number']").value = parsed.supplierLot || "";
    const matchingRadio = Array.from(document.querySelectorAll("[name='po_line_id']"))
      .find((radio) => radio.dataset.productId === parsed.productId);
    if (matchingRadio) matchingRadio.checked = true;
    updateBaseQtyPreview();
    document.getElementById("receiveResult").innerHTML = `
      <strong>PO QR captured</strong><br>
      Product: ${parsed.productId}<br>
      Quantity: ${parsed.qty}<br>
      Supplier lot: ${parsed.supplierLot || "PENDING"}<br>
      Confirm quality, quantity, and final location before receiving.
    `;
    return;
  }
  document.getElementById("receiveResult").textContent = `Captured scan: ${value}`;
}

function updateBaseQtyPreview() {
  const preview = document.getElementById("baseQtyPreview");
  const form = document.getElementById("receiveForm");
  if (!preview || !form) return;
  const selectedLine = document.querySelector("[name='po_line_id']:checked");
  if (!selectedLine) {
    preview.textContent = "Select a PO line to preview base inventory quantity.";
    return;
  }
  const qtyReceived = Number(form.elements.qty_received.value || 0);
  const qtyDamaged = Number(form.elements.qty_damaged.value || 0);
  const acceptedPurchaseQty = Math.max(0, qtyReceived - qtyDamaged);
  const unitsPerPurchaseUnit = Number(selectedLine.dataset.unitsPer || 1) || 1;
  const baseUnit = selectedLine.dataset.baseUnit || selectedLine.dataset.unit || "";
  const autoBaseQty = acceptedPurchaseQty * unitsPerPurchaseUnit;
  const actualBaseQty = Number(form.elements.actual_base_qty.value || 0);
  const finalBaseQty = actualBaseQty > 0 ? actualBaseQty : autoBaseQty;
  preview.innerHTML = `
    Accepted purchase qty: <strong>${acceptedPurchaseQty} ${selectedLine.dataset.unit || ""}</strong><br>
    Inventory qty to lot: <strong>${finalBaseQty} ${baseUnit}</strong>
    ${actualBaseQty > 0 ? "<br>Using manually entered actual base qty." : ""}
  `;
}

function parsePurchaseOrderQr(value) {
  const parts = String(value || "").split("|").map((part) => part.trim());
  if (parts.length < 2 || !parts[1].startsWith("QTY:")) return null;
  return {
    productId: parts[0],
    qty: Number(parts.find((part) => part.startsWith("QTY:"))?.replace("QTY:", "") || 0),
    supplierLot: parts.find((part) => part.startsWith("SUPLOT:"))?.replace("SUPLOT:", "") || ""
  };
}
