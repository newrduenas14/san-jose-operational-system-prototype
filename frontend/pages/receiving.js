import { getPurchaseOrderDetail, listLocations, listPurchaseOrders, receiveProduct } from "../js/api-smooth1.js?v=parties1";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=smooth1";
import { escapeHtml, formToObject, formatQuantity, notice } from "../js/utils.js";

const RECEIVABLE_STATUSES = ["DRAFT", "SENT", "ORDERED", "IN_TRANSIT", "PARTIALLY_RECEIVED"];
let activeOrder = null;
let warehouseLocations = [];
let scannedLineId = "";
let selectedLineId = "";

export async function render(ctx) {
  ctx.setTitle("Receive Product", "Scan a PO product, verify the delivery, and assign its location");
  const [allOrders, locations] = await Promise.all([listPurchaseOrders(), listLocations()]);
  const purchaseOrders = allOrders.filter((po) => RECEIVABLE_STATUSES.includes(String(po.po_status || "").toUpperCase()));
  warehouseLocations = locations.filter(isActiveLocation);
  activeOrder = null;
  scannedLineId = "";
  selectedLineId = "";

  ctx.view.innerHTML = `
    <div class="grid receiving-page">
      <section class="panel receiving-scan-panel">
        <div class="panel-header">
          <div>
            <h2>Scan Purchase Order Product</h2>
            <p class="muted">Scan the QR label for the product being unloaded.</p>
          </div>
          <button id="scanReceiveQr" class="btn" type="button">Scan QR</button>
        </div>
        <div class="receiving-scan-row">
          <div class="field">
            <label>PO/Product QR</label>
            <input id="receiveScan" name="scan_code" autocomplete="off" placeholder="Scan or paste QR value">
          </div>
          <div class="field">
            <label>Manual PO Selection</label>
            <select id="poSelect">
              <option value="">Select purchase order</option>
              ${purchaseOrders.map((po) => `<option value="${escapeHtml(po.po_id)}">${escapeHtml(po.po_id)} - ${escapeHtml(po.supplier?.supplier_name || po.supplier_id)} (${escapeHtml(po.po_status)})</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="cameraReader"></div>
        <div id="receiveResult" class="result">Scan a product QR or select a purchase order manually.</div>
      </section>

      <section class="panel receiving-workspace">
        <div class="panel-header receiving-order-header">
          <div>
            <h2 id="receivingOrderTitle">Purchase Order</h2>
            <p id="receivingOrderMeta" class="muted">No purchase order selected.</p>
          </div>
          <span id="receivingOrderStatus" class="status">WAITING</span>
        </div>

        <form id="receiveForm">
          <input id="receiveScanValue" name="scan_code" type="hidden">
          <div id="poLines" class="receiving-order-lines">
            <div class="empty">The products in the purchase order will appear here.</div>
          </div>

          <section id="receivingDetails" class="receiving-details" hidden>
            <div class="receiving-section-heading">
              <div>
                <span class="receiving-eyebrow">Receiving Product</span>
                <h3 id="selectedProductName">Product</h3>
              </div>
              <span id="scanLockStatus" class="receiving-scan-badge" hidden>Selected by QR</span>
            </div>

            <div class="receiving-facts">
              <div><span>Product ID</span><strong id="selectedProductId"></strong></div>
              <div><span>Quantity Expected</span><strong id="selectedExpectedQty"></strong></div>
              <div><span>Previously Received</span><strong id="selectedReceivedQty"></strong></div>
              <div><span>Quantity Remaining</span><strong id="selectedRemainingQty"></strong></div>
              <div><span>Unit Weight</span><strong id="selectedUnitWeight"></strong></div>
              <div><span>Expected Weight Remaining</span><strong id="selectedExpectedWeight"></strong></div>
            </div>

            <div class="receiving-entry-grid">
              <div class="field">
                <label>Quantity Received</label>
                <input name="qty_received" type="number" min="0.01" step="0.01" required>
              </div>
              <div class="field">
                <label>Damaged / Rejected</label>
                <input name="qty_damaged" type="number" min="0" step="0.01" value="0" required>
              </div>
              <div class="field">
                <label>Pallets Received</label>
                <input name="pallet_count" type="number" min="0" step="1" value="0">
              </div>
              <div class="field">
                <label>Quality Status</label>
                <select name="quality_status" required>
                  <option value="PASS">Pass</option>
                  <option value="HOLD">Hold for Review</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>
              <div class="field receiving-lot-field">
                <label>Supplier Lot Number</label>
                <input name="supplier_lot_number" autocomplete="off" required>
              </div>
            </div>

            <input name="quality_score" type="hidden" value="5">
            <div id="receivingQuantityPreview" class="receiving-quantity-preview"></div>

            <div class="receiving-putaway">
              <div class="receiving-placeholder">
                <span>Recommended Location</span>
                <strong>Placement recommendation coming later</strong>
              </div>
              <div class="receiving-location-controls">
                <div class="field">
                  <label>Confirmed Location</label>
                  <select name="confirmed_location_id" required>
                    <option value="">Select warehouse location</option>
                    ${warehouseLocations.map(locationOption).join("")}
                  </select>
                </div>
                <div class="field">
                  <label>Location QR</label>
                  <div class="receiving-location-scan">
                    <input id="locationScan" autocomplete="off" placeholder="Scan location QR">
                    <button id="scanLocationQr" class="btn secondary" type="button">Scan</button>
                  </div>
                </div>
              </div>
              <div id="locationFeedback" class="muted">Choose a location manually or scan its QR label.</div>
            </div>

            <div class="field receiving-notes">
              <label>Receiving Notes</label>
              <textarea name="notes" placeholder="Optional damage, quality, or unloading notes"></textarea>
            </div>

            <div class="receiving-submit-row">
              <div id="receivingCompletionNote" class="muted"></div>
              <button class="btn" type="submit">Complete Receiving</button>
            </div>
          </section>
        </form>
      </section>
    </div>
  `;

  const poSelect = document.getElementById("poSelect");
  poSelect.addEventListener("change", () => loadPurchaseOrder(poSelect.value).catch((error) => notice(error.message)));

  const scanInput = document.getElementById("receiveScan");
  handleKeyboardScan(scanInput, (value) => {
    handleReceivingScan(value).catch((error) => notice(error.message));
  });

  const locationScan = document.getElementById("locationScan");
  handleKeyboardScan(locationScan, handleLocationScan);

  document.getElementById("scanReceiveQr").addEventListener("click", () => startReceivingCamera("product"));
  document.getElementById("scanLocationQr").addEventListener("click", () => startReceivingCamera("location"));

  const form = document.getElementById("receiveForm");
  form.addEventListener("input", updateReceivingPreview);
  form.addEventListener("change", (event) => {
    if (event.target.name === "po_line_id") selectPoLine(event.target.value, false);
    if (event.target.name === "quality_status") {
      form.elements.quality_score.value = qualityScore(event.target.value);
    }
    if (event.target.name === "confirmed_location_id") showSelectedLocation();
    updateReceivingPreview();
  });
  form.addEventListener("submit", (event) => submitReceiving(event, ctx));
}

async function loadPurchaseOrder(poId, options = {}) {
  if (!poId) {
    activeOrder = null;
    scannedLineId = "";
    selectedLineId = "";
    resetOrderWorkspace();
    return;
  }
  const detail = await getPurchaseOrderDetail(poId);
  if (!detail) throw new Error("Purchase order was not found.");
  activeOrder = detail;
  scannedLineId = options.scannedLineId || "";
  selectedLineId = options.lineId || "";
  document.getElementById("poSelect").value = poId;
  document.getElementById("receivingOrderTitle").textContent = poId;
  document.getElementById("receivingOrderMeta").textContent = `${detail.po.supplier?.supplier_name || detail.po.supplier_id} | ${detail.lines.length} product${detail.lines.length === 1 ? "" : "s"}`;
  const orderStatus = document.getElementById("receivingOrderStatus");
  orderStatus.textContent = detail.po.po_status || "OPEN";
  renderOrderLines();
  document.getElementById("receivingDetails").hidden = true;
  if (options.lineId) selectPoLine(options.lineId, Boolean(options.scannedLineId));
}

function renderOrderLines() {
  const target = document.getElementById("poLines");
  if (!activeOrder?.lines?.length) {
    target.innerHTML = `<div class="empty">This purchase order has no product lines.</div>`;
    return;
  }
  target.innerHTML = `
    <div class="receiving-lines-header">
      <span>Products in this order</span>
      <small>Select a product manually when no QR was scanned.</small>
    </div>
    ${activeOrder.lines.map((line) => {
      const remaining = lineRemaining(line);
      const complete = remaining <= 0;
      const selected = line.po_line_id === selectedLineId;
      const scanned = line.po_line_id === scannedLineId;
      const locked = Boolean(scannedLineId) && !scanned;
      return `
        <label class="receiving-order-line ${selected ? "is-selected" : ""} ${scanned ? "is-scanned" : ""} ${complete ? "is-complete" : ""}">
          <input class="receiving-line-radio" type="radio" name="po_line_id" value="${escapeHtml(line.po_line_id)}" ${selected ? "checked" : ""} ${locked || complete ? "disabled" : ""} required>
          <span class="receiving-product-main">
            <strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong>
            <small>${escapeHtml(line.product_id)}</small>
          </span>
          <span><small>Expected</small><strong>${formatNumber(line.qty_ordered)} ${escapeHtml(line.unit_type)}</strong></span>
          <span><small>Received</small><strong>${formatNumber(line.qty_received_total)} ${escapeHtml(line.unit_type)}</strong></span>
          <span><small>Remaining</small><strong>${formatNumber(remaining)} ${escapeHtml(line.unit_type)}</strong></span>
          <span class="receiving-line-state">${scanned ? "SCANNED" : complete ? "COMPLETE" : selected ? "SELECTED" : "OPEN"}</span>
        </label>
      `;
    }).join("")}
  `;
}

function selectPoLine(poLineId, fromScan) {
  const line = activeOrder?.lines?.find((item) => item.po_line_id === poLineId);
  if (!line) throw new Error("The scanned product is not part of this purchase order.");
  if (lineRemaining(line) <= 0) throw new Error("This product has already been fully received.");
  selectedLineId = poLineId;
  if (fromScan) scannedLineId = poLineId;
  renderOrderLines();
  const selectedRadio = document.querySelector(`[name="po_line_id"][value="${cssEscape(poLineId)}"]`);
  if (selectedRadio) selectedRadio.checked = true;

  const form = document.getElementById("receiveForm");
  const remaining = lineRemaining(line);
  document.getElementById("receivingDetails").hidden = false;
  document.getElementById("selectedProductName").textContent = line.product?.product_name || line.product_id;
  document.getElementById("selectedProductId").textContent = line.product_id;
  document.getElementById("selectedExpectedQty").textContent = `${formatNumber(line.qty_ordered)} ${line.unit_type}`;
  document.getElementById("selectedReceivedQty").textContent = `${formatNumber(line.qty_received_total)} ${line.unit_type}`;
  document.getElementById("selectedRemainingQty").textContent = `${formatNumber(remaining)} ${line.unit_type}`;
  const unitWeight = Number(line.case_weight_lbs || line.units_per_purchase_unit || 0);
  document.getElementById("selectedUnitWeight").textContent = `${formatNumber(unitWeight)} LB per ${line.unit_type}`;
  document.getElementById("selectedExpectedWeight").textContent = `${formatNumber(remaining * unitWeight)} LB`;
  document.getElementById("scanLockStatus").hidden = !scannedLineId;
  form.elements.qty_received.value = formatNumber(remaining);
  form.elements.qty_damaged.value = "0";
  form.elements.pallet_count.value = "0";
  form.elements.quality_status.value = "PASS";
  form.elements.quality_score.value = "5";
  form.elements.supplier_lot_number.value = line.supplier_expected_lot_number || "";
  form.elements.confirmed_location_id.value = "";
  document.getElementById("locationScan").value = "";
  document.getElementById("locationFeedback").textContent = "Choose a location manually or scan its QR label.";
  updateReceivingPreview();
}

async function handleReceivingScan(value) {
  const parsed = parsePurchaseOrderQr(value);
  if (!parsed) throw new Error("This is not a valid purchase order product QR.");
  const poId = parsed.poId || activeOrder?.po?.po_id || "";
  if (!poId) throw new Error("Select the purchase order before scanning this legacy product QR.");
  const poExists = Array.from(document.getElementById("poSelect").options).some((option) => option.value === poId);
  if (!poExists) throw new Error(`${poId} is not available for receiving.`);
  await loadPurchaseOrder(poId);
  const line = activeOrder.lines.find((item) => parsed.poLineId
    ? item.po_line_id === parsed.poLineId
    : item.product_id === parsed.productId);
  if (!line) throw new Error("The scanned product is not part of this purchase order.");
  scannedLineId = line.po_line_id;
  selectPoLine(line.po_line_id, true);
  const form = document.getElementById("receiveForm");
  form.elements.supplier_lot_number.value = parsed.supplierLot || line.supplier_expected_lot_number || "";
  document.getElementById("receiveScanValue").value = value;
  document.getElementById("receiveResult").innerHTML = `
    <strong>${escapeHtml(line.product?.product_name || line.product_id)} selected</strong><br>
    ${escapeHtml(poId)} | ${escapeHtml(line.product_id)} | ${escapeHtml(formatNumber(lineRemaining(line)))} ${escapeHtml(line.unit_type)} remaining
  `;
}

function handleLocationScan(value) {
  const location = warehouseLocations.find((item) => [item.location_id, item.qr_value].includes(String(value || "").trim()));
  if (!location) {
    document.getElementById("locationFeedback").textContent = `Location QR not found: ${value}`;
    return;
  }
  const select = document.getElementById("receiveForm").elements.confirmed_location_id;
  select.value = location.location_id;
  document.getElementById("locationScan").value = location.qr_value || location.location_id;
  document.getElementById("locationFeedback").textContent = `Location confirmed: ${locationLabel(location)}`;
}

async function startReceivingCamera(mode) {
  try {
    await startCameraScanner(mode === "location" ? "locationScan" : "receiveScan", (value) => {
      if (mode === "location") handleLocationScan(value);
      else handleReceivingScan(value).catch((error) => notice(error.message));
      stopCameraScanner();
    });
  } catch (error) {
    notice(error.message);
  }
}

function updateReceivingPreview() {
  const preview = document.getElementById("receivingQuantityPreview");
  const completion = document.getElementById("receivingCompletionNote");
  const form = document.getElementById("receiveForm");
  const selected = form?.querySelector("[name='po_line_id']:checked");
  const line = activeOrder?.lines?.find((item) => item.po_line_id === selected?.value);
  if (!preview || !line) return;
  const qtyReceived = Number(form.elements.qty_received.value || 0);
  const qtyDamaged = Number(form.elements.qty_damaged.value || 0);
  const accepted = Math.max(0, qtyReceived - qtyDamaged);
  const remainingBefore = lineRemaining(line);
  const remainingAfter = Math.max(0, remainingBefore - accepted);
  const unitWeight = Number(line.case_weight_lbs || line.units_per_purchase_unit || 0);
  const variance = accepted - remainingBefore;
  preview.innerHTML = `
    <div><span>Accepted</span><strong>${formatNumber(accepted)} ${escapeHtml(line.unit_type)}</strong></div>
    <div><span>Inventory Weight</span><strong>${formatNumber(accepted * unitWeight)} LB</strong></div>
    <div><span>Remaining After Receipt</span><strong>${formatNumber(remainingAfter)} ${escapeHtml(line.unit_type)}</strong></div>
    <div><span>Delivery Result</span><strong>${variance > 0 ? `OVER BY ${formatNumber(variance)}` : remainingAfter > 0 ? "PARTIAL" : "COMPLETE"}</strong></div>
  `;
  completion.textContent = remainingAfter > 0
    ? `This product will remain open with ${formatNumber(remainingAfter)} ${line.unit_type} outstanding.`
    : "This product line will be complete after confirmation.";
}

async function submitReceiving(event, ctx) {
  event.preventDefault();
  const form = event.currentTarget;
  const selected = form.querySelector("[name='po_line_id']:checked");
  if (!selected) {
    notice("Select or scan a product from the purchase order.");
    return;
  }
  const qtyReceived = Number(form.elements.qty_received.value || 0);
  const qtyDamaged = Number(form.elements.qty_damaged.value || 0);
  if (qtyReceived <= 0) {
    notice("Quantity received must be greater than zero.");
    return;
  }
  if (qtyDamaged < 0 || qtyDamaged > qtyReceived) {
    notice("Damaged quantity cannot exceed quantity received.");
    return;
  }
  if (form.elements.quality_status.value === "REJECTED" && qtyDamaged !== qtyReceived) {
    notice("For a rejected delivery, damaged/rejected quantity must equal quantity received.");
    return;
  }
  const input = formToObject(form);
  input.po_id = activeOrder.po.po_id;
  try {
    const result = await receiveProduct(ctx.user, input);
    notice(`Received ${formatNumber(result.receiving.qty_accepted)} ${result.receiving.unit_type} into ${result.lot.internal_lot_id} at ${result.lot.current_location_id}.`);
    await render(ctx);
  } catch (error) {
    notice(error.message);
  }
}

function showSelectedLocation() {
  const locationId = document.getElementById("receiveForm").elements.confirmed_location_id.value;
  const location = warehouseLocations.find((item) => item.location_id === locationId);
  document.getElementById("locationFeedback").textContent = location
    ? `Location confirmed: ${locationLabel(location)}`
    : "Choose a location manually or scan its QR label.";
}

function resetOrderWorkspace() {
  document.getElementById("receivingOrderTitle").textContent = "Purchase Order";
  document.getElementById("receivingOrderMeta").textContent = "No purchase order selected.";
  document.getElementById("receivingOrderStatus").textContent = "WAITING";
  document.getElementById("poLines").innerHTML = `<div class="empty">The products in the purchase order will appear here.</div>`;
  document.getElementById("receivingDetails").hidden = true;
}

function parsePurchaseOrderQr(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed?.type === "PO_LINE" && parsed.product_id) {
      return {
        poId: parsed.po_id || "",
        poLineId: parsed.po_line_id || "",
        productId: parsed.product_id,
        supplierLot: parsed.supplier_lot_number === "PENDING" ? "" : parsed.supplier_lot_number || ""
      };
    }
  } catch (_error) {
    // Continue with legacy pipe-delimited QR values.
  }
  const parts = String(value || "").split("|").map((part) => part.trim());
  if (parts.length < 2 || !parts[1].startsWith("QTY:")) return null;
  return {
    poId: "",
    poLineId: "",
    productId: parts[0],
    supplierLot: parts.find((part) => part.startsWith("SUPLOT:"))?.replace("SUPLOT:", "") || ""
  };
}

function lineRemaining(line) {
  const hasExplicitRemaining = line.qty_remaining !== "" && line.qty_remaining !== null && line.qty_remaining !== undefined;
  const explicit = Number(line.qty_remaining);
  if (hasExplicitRemaining && Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, Number(line.qty_ordered || 0) - Number(line.qty_received_total || 0));
}

function locationOption(location) {
  return `<option value="${escapeHtml(location.location_id)}">${escapeHtml(locationLabel(location))}</option>`;
}

function locationLabel(location) {
  const type = location.location_type ? ` - ${location.location_type}` : "";
  return `${location.location_id}${type}`;
}

function isActiveLocation(location) {
  const active = location.is_active === undefined || location.is_active === true || String(location.is_active).toUpperCase() === "TRUE";
  return active && String(location.current_status || "AVAILABLE").toUpperCase() !== "BLOCKED";
}

function qualityScore(status) {
  return status === "PASS" ? 5 : status === "HOLD" ? 3 : 1;
}

function formatNumber(value) {
  return formatQuantity(value);
}

function cssEscape(value) {
  return String(value || "").replaceAll('"', '\\"');
}
