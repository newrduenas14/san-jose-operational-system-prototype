import {
  getSalesOrderDetail,
  inventorySnapshot,
  listSalesOrders,
  lookupScan,
  recordInventoryMovement
} from "../js/api-smooth1.js?v=send1";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=send1";
import { escapeHtml, formatQuantity, notice } from "../js/utils.js?v=send1";

let activeDetail = null;
let activeInventoryRows = [];
let selectedLot = null;
let selectedLineId = "";

export async function render(ctx) {
  ctx.setTitle("Send Product", "Scan physical inventory before deducting Sales Order or Amazon outbound stock");
  const [orders, inventoryRows] = await Promise.all([listSalesOrders(), inventorySnapshot()]);
  activeInventoryRows = inventoryRows;
  activeDetail = null;
  selectedLot = null;
  selectedLineId = "";
  const routeSalesOrderId = routeId();
  const openOrders = orders.filter((order) => !["SHIPPED", "CANCELLED", "CLOSED"].includes(String(order.status || "").toUpperCase()));

  ctx.view.innerHTML = `
    <div class="grid send-product-page">
      <section class="panel receiving-scan-panel">
        <div class="panel-header">
          <div>
            <h2>Scan Product Leaving Warehouse</h2>
            <p class="muted">Sales Orders and Amazon do not deduct inventory until this scan-and-send step is completed.</p>
          </div>
          <button id="scanSendQr" class="btn" type="button">Scan QR</button>
        </div>
        <div class="receiving-scan-row">
          <div class="field">
            <label>Lot / Pallet / Box QR</label>
            <input id="sendScan" autocomplete="off" placeholder="Scan or paste physical inventory QR">
          </div>
          <div class="field">
            <label>Sales Order</label>
            <select id="salesOrderSelect">
              <option value="">Amazon / manual outbound, or choose Sales Order</option>
              ${openOrders.map((order) => `<option value="${escapeHtml(order.sales_order_id)}" ${order.sales_order_id === routeSalesOrderId ? "selected" : ""}>${escapeHtml(order.sales_order_id)} - ${escapeHtml(order.customer?.supplier_name || order.customer_name || order.customer_id || "Customer")} (${escapeHtml(order.status || "DRAFT")})</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="cameraReader"></div>
        <div id="sendScanResult" class="result">Scan a lot QR, then send product against a Sales Order or Amazon reference.</div>
      </section>

      <section class="panel receiving-workspace">
        <div class="panel-header receiving-order-header">
          <div>
            <h2 id="sendOrderTitle">Outbound Product</h2>
            <p id="sendOrderMeta" class="muted">Choose a Sales Order for guided picking, or use Amazon/manual reference.</p>
          </div>
          <span id="sendOrderStatus" class="status">WAITING</span>
        </div>

        <form id="sendProductForm">
          <div class="sales-order-header-grid">
            <div class="field">
              <label>Outbound Type</label>
              <select name="movement_type">
                <option value="SALE">Sales Order / Wholesale</option>
                <option value="AMAZON_OUT">Amazon Outbound</option>
                <option value="USE">Internal Use</option>
                <option value="ADJUST_OUT">Adjustment Out</option>
              </select>
            </div>
            <div class="field">
              <label>Amazon / External Reference</label>
              <input name="related_amazon_order_id" autocomplete="off" placeholder="Amazon order, FBA, or manual ref">
            </div>
            <div class="field">
              <label>Scanned Lot</label>
              <input name="internal_lot_id" readonly required placeholder="Scan inventory QR first">
            </div>
            <div class="field">
              <label>Location</label>
              <input name="location_id" readonly placeholder="Auto from inventory">
            </div>
          </div>

          <div id="sendLines" class="receiving-order-lines">
            <div class="empty">Sales Order pick lines will appear here.</div>
          </div>

          <section id="sendDetails" class="receiving-details">
            <div class="receiving-section-heading">
              <div>
                <span class="receiving-eyebrow">Send Product</span>
                <h3 id="sendProductName">Scan inventory to continue</h3>
              </div>
              <span id="sendMatchStatus" class="receiving-scan-badge" hidden>MATCHED</span>
            </div>
            <div class="receiving-facts">
              <div><span>Product ID</span><strong id="sendProductId">—</strong></div>
              <div><span>Lot</span><strong id="sendLotId">—</strong></div>
              <div><span>Available</span><strong id="sendAvailableQty">—</strong></div>
              <div><span>Location</span><strong id="sendLocationId">—</strong></div>
              <div><span>Sales Order Need</span><strong id="sendOrderNeed">Choose SO line</strong></div>
              <div><span>Inventory Unit</span><strong id="sendInventoryUnit">LB</strong></div>
            </div>
            <div class="receiving-entry-grid">
              <div class="field">
                <label>Quantity to Send</label>
                <input name="qty" type="number" min="0.01" step="0.01" required>
              </div>
              <div class="field">
                <label>Unit</label>
                <input name="unit_type" value="LB" required>
              </div>
              <div class="field full">
                <label>Notes</label>
                <textarea name="notes" placeholder="Optional: partial pick, damaged, substitution approval, Amazon reference"></textarea>
              </div>
            </div>
            <div id="sendValidation" class="receiving-quantity-preview"></div>
            <div class="receiving-submit-row">
              <div class="muted">Inventory is deducted only after this confirmation.</div>
              <button class="btn" type="submit">Confirm Send Product</button>
            </div>
          </section>
        </form>
      </section>
    </div>
  `;

  document.getElementById("salesOrderSelect").addEventListener("change", (event) => loadSalesOrder(event.target.value).catch((error) => notice(error.message)));
  handleKeyboardScan(document.getElementById("sendScan"), (value) => handleSendScan(value).catch((error) => notice(error.message)));
  document.getElementById("scanSendQr").addEventListener("click", startSendCamera);
  document.getElementById("sendProductForm").addEventListener("change", handleFormChange);
  document.getElementById("sendProductForm").addEventListener("input", updateSendValidation);
  document.getElementById("sendProductForm").addEventListener("submit", (event) => submitSendProduct(event, ctx));

  if (routeSalesOrderId) await loadSalesOrder(routeSalesOrderId);
}

async function loadSalesOrder(salesOrderId) {
  activeDetail = null;
  selectedLineId = "";
  selectedLot = null;
  document.getElementById("sendLines").innerHTML = `<div class="empty">Sales Order pick lines will appear here.</div>`;
  document.getElementById("sendOrderTitle").textContent = "Outbound Product";
  document.getElementById("sendOrderMeta").textContent = "Choose a Sales Order for guided picking, or use Amazon/manual reference.";
  document.getElementById("sendOrderStatus").textContent = "WAITING";
  if (!salesOrderId) {
    updateSendValidation();
    return;
  }

  const detail = await getSalesOrderDetail(salesOrderId);
  if (!detail) throw new Error("Sales Order was not found.");
  activeDetail = detail;
  document.getElementById("sendOrderTitle").textContent = salesOrderId;
  document.getElementById("sendOrderMeta").textContent = `${detail.order.customer?.supplier_name || detail.order.customer_name || "Customer"} | ${detail.lines.length} pick line${detail.lines.length === 1 ? "" : "s"}`;
  document.getElementById("sendOrderStatus").textContent = detail.order.status || "DRAFT";
  renderSalesOrderLines();
  updateSendValidation();
}

function renderSalesOrderLines() {
  const target = document.getElementById("sendLines");
  if (!activeDetail?.lines?.length) {
    target.innerHTML = `<div class="empty">This Sales Order has no pick lines.</div>`;
    return;
  }
  target.innerHTML = `
    <div class="receiving-lines-header">
      <span>Recommended lots and spaces</span>
      <small>Select the line that matches the scanned inventory.</small>
    </div>
    ${activeDetail.lines.map((line) => {
      const selected = line.sales_order_line_id === selectedLineId;
      const matchesScan = selectedLot && String(selectedLot.product_id) === String(line.product_id) && String(selectedLot.internal_lot_id) === String(line.preferred_internal_lot_id);
      return `<label class="receiving-order-line ${selected ? "is-selected" : ""} ${matchesScan ? "is-scanned" : ""}">
        <input class="receiving-line-radio" type="radio" name="sales_order_line_id" value="${escapeHtml(line.sales_order_line_id)}" ${selected ? "checked" : ""}>
        <span class="receiving-product-main"><strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong><small>${escapeHtml(line.product_id)}</small></span>
        <span><small>Order Qty</small><strong>${formatNumber(line.qty_ordered)} ${escapeHtml(line.unit_type)}</strong></span>
        <span><small>Pick Weight</small><strong>${formatNumber(line.inventory_qty_required || 0)} ${escapeHtml(line.inventory_unit_type || "LB")}</strong></span>
        <span><small>Lot</small><strong>${escapeHtml(line.preferred_internal_lot_id || "")}</strong></span>
        <span><small>Space</small><strong>${escapeHtml(line.preferred_location_id || "")}</strong></span>
        <span class="receiving-line-state">${matchesScan ? "MATCH" : selected ? "SELECTED" : line.line_status || "OPEN"}</span>
      </label>`;
    }).join("")}
  `;
}

async function handleSendScan(value) {
  const match = await lookupScan(value);
  if (!match || match.type !== "LOT") throw new Error("Scan an inventory lot/pallet/box QR created during receiving.");
  selectedLot = match.record;
  const snapshotRow = findInventoryRow(selectedLot.internal_lot_id);
  const form = document.getElementById("sendProductForm");
  form.elements.internal_lot_id.value = selectedLot.internal_lot_id || "";
  form.elements.location_id.value = snapshotRow?.location_id || selectedLot.current_location_id || "";
  form.elements.unit_type.value = snapshotRow?.unit_type || selectedLot.unit_type || "LB";
  document.getElementById("sendProductName").textContent = snapshotRow?.product?.product_name || selectedLot.product_id || "Scanned Product";
  document.getElementById("sendProductId").textContent = selectedLot.product_id || "—";
  document.getElementById("sendLotId").textContent = selectedLot.internal_lot_id || "—";
  document.getElementById("sendAvailableQty").textContent = snapshotRow ? `${formatNumber(snapshotRow.available_qty ?? snapshotRow.current_qty ?? 0)} ${snapshotRow.unit_type || "LB"}` : "Review inventory";
  document.getElementById("sendLocationId").textContent = form.elements.location_id.value || "—";
  document.getElementById("sendInventoryUnit").textContent = form.elements.unit_type.value || "LB";

  const matchingLine = activeDetail?.lines?.find((line) => String(line.product_id) === String(selectedLot.product_id) && String(line.preferred_internal_lot_id) === String(selectedLot.internal_lot_id));
  if (matchingLine) {
    selectedLineId = matchingLine.sales_order_line_id;
    form.elements.qty.value = formatNumber(matchingLine.inventory_qty_required || matchingLine.qty_ordered || 0);
    form.elements.unit_type.value = matchingLine.inventory_unit_type || form.elements.unit_type.value || "LB";
    document.getElementById("sendOrderNeed").textContent = `${formatNumber(matchingLine.inventory_qty_required || 0)} ${matchingLine.inventory_unit_type || "LB"}`;
  }

  renderSalesOrderLines();
  document.getElementById("sendScanResult").innerHTML = `<strong>${escapeHtml(match.type)}</strong><pre>${escapeHtml(JSON.stringify(match.record, null, 2))}</pre>`;
  updateSendValidation();
}

function handleFormChange(event) {
  if (event.target.name === "sales_order_line_id") {
    selectedLineId = event.target.value;
    const line = activeDetail?.lines?.find((item) => item.sales_order_line_id === selectedLineId);
    if (line) {
      const form = document.getElementById("sendProductForm");
      form.elements.qty.value = formatNumber(line.inventory_qty_required || line.qty_ordered || 0);
      form.elements.unit_type.value = line.inventory_unit_type || "LB";
      document.getElementById("sendOrderNeed").textContent = `${formatNumber(line.inventory_qty_required || 0)} ${line.inventory_unit_type || "LB"}`;
    }
    renderSalesOrderLines();
  }
  updateSendValidation();
}

async function startSendCamera() {
  try {
    await startCameraScanner("sendScan", (value) => {
      handleSendScan(value).catch((error) => notice(error.message));
      stopCameraScanner();
    });
  } catch (error) {
    notice(error.message);
  }
}

async function submitSendProduct(event, ctx) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.elements.internal_lot_id.value) return notice("Scan the physical lot QR first.");
  const qty = Number(form.elements.qty.value || 0);
  if (qty <= 0) return notice("Quantity to send must be greater than zero.");
  const line = selectedLineId ? activeDetail?.lines?.find((item) => item.sales_order_line_id === selectedLineId) : null;
  if (activeDetail && !line) return notice("Select the Sales Order line this scanned product is fulfilling.");
  if (line && selectedLot) {
    if (String(line.product_id) !== String(selectedLot.product_id)) return notice("Scanned product does not match the selected Sales Order line.");
    if (String(line.preferred_internal_lot_id) !== String(selectedLot.internal_lot_id)) return notice("Scanned lot does not match the recommended Sales Order lot. Add a manager-approved exception before sending a substitute.");
  }
  try {
    const movementType = form.elements.movement_type.value;
    const input = {
      internal_lot_id: form.elements.internal_lot_id.value,
      qty,
      unit_type: form.elements.unit_type.value || "LB",
      movement_type: movementType,
      location_id: form.elements.location_id.value,
      related_sales_order_id: activeDetail?.order?.sales_order_id || "",
      related_pick_task_id: relatedPickTaskId(line),
      related_amazon_order_id: form.elements.related_amazon_order_id.value.trim(),
      notes: [line ? `SO line ${line.sales_order_line_id}` : "", form.elements.notes.value.trim()].filter(Boolean).join(" | ")
    };
    const movement = await recordInventoryMovement(ctx.user, input);
    notice(`Sent product and deducted inventory movement ${movement.movement_id}.`);
    await render(ctx);
  } catch (error) {
    notice(error.message);
  }
}

function updateSendValidation() {
  const form = document.getElementById("sendProductForm");
  const target = document.getElementById("sendValidation");
  if (!form || !target) return;
  const line = selectedLineId ? activeDetail?.lines?.find((item) => item.sales_order_line_id === selectedLineId) : null;
  const snapshotRow = selectedLot ? findInventoryRow(selectedLot.internal_lot_id) : null;
  const qty = Number(form.elements.qty.value || 0);
  const available = Number(snapshotRow?.available_qty ?? snapshotRow?.current_qty ?? 0);
  const messages = [];
  messages.push(`<div><span>Inventory Action</span><strong>${escapeHtml(form.elements.movement_type.value || "SALE")}</strong></div>`);
  messages.push(`<div><span>Available Before Send</span><strong>${snapshotRow ? `${formatNumber(available)} ${escapeHtml(snapshotRow.unit_type || "LB")}` : "Scan inventory"}</strong></div>`);
  messages.push(`<div><span>Quantity Entered</span><strong>${formatNumber(qty)} ${escapeHtml(form.elements.unit_type.value || "LB")}</strong></div>`);
  messages.push(`<div><span>Match</span><strong>${line && selectedLot ? lineMatchesLot(line, selectedLot) ? "OK" : "MISMATCH" : activeDetail ? "Choose SO line" : "Manual/Amazon"}</strong></div>`);
  target.innerHTML = messages.join("");
  document.getElementById("sendMatchStatus").hidden = !(line && selectedLot && lineMatchesLot(line, selectedLot));
}

function lineMatchesLot(line, lot) {
  return String(line.product_id) === String(lot.product_id) && String(line.preferred_internal_lot_id) === String(lot.internal_lot_id);
}

function findInventoryRow(lotId) {
  return activeInventoryRows.find((row) => String(row.internal_lot_id) === String(lotId) && Number(row.current_qty || row.qty || 0) > 0) || null;
}

function relatedPickTaskId(line) {
  if (!line || !activeDetail?.pickTasks) return "";
  const task = activeDetail.pickTasks.find((item) => item.sales_order_line_id === line.sales_order_line_id);
  return task?.pick_task_id || "";
}

function routeId() {
  const hash = String(window.location.hash || "").replace(/^#/, "");
  const parts = hash.split(":");
  return parts[0] === "sendProduct" ? parts[1] || "" : "";
}

function formatNumber(value) {
  return formatQuantity(value);
}
