import { inventorySnapshot, listAmazonOutboundActivity, lookupScan, recordAmazonOutbound } from "../js/api-smooth1.js?v=amazonout1";
import { handleKeyboardScan } from "../js/scanner.js";
import { escapeHtml, formToObject, formatQuantity, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Amazon Outbound", "Scan a lot and record stock leaving the warehouse for Amazon");
  const [inventory, activity] = await Promise.all([inventorySnapshot(), listAmazonOutboundActivity()]);
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header"><h2>Send Product to Amazon</h2></div>
        <p class="muted">Scan the bag or case sticker, then record either full packages or the exact pounds used. Available inventory updates immediately.</p>
        <div class="scan-box">
          <div class="field"><label>Scan Internal Lot</label><input id="amazonLotScan" placeholder="Example: LOT-000001" autofocus></div>
          <div id="amazonLotResult" class="result">Waiting for a lot scan.</div>
        </div>
        <form id="amazonOutboundForm" class="form-grid">
          <div class="field"><label>Internal Lot ID</label><input name="internal_lot_id" required placeholder="Scan or type a lot"></div>
          <div class="field"><label>Product</label><input name="product_name" readonly placeholder="Filled after scan"></div>
          <div class="field"><label>Available</label><input name="available_qty" readonly placeholder="Filled after scan"></div>
          <div class="field">
            <label>How was it used?</label>
            <select name="quantity_mode">
              <option value="FULL_PACKAGE">Full case / bag</option>
              <option value="POUNDS">Certain amount (LB)</option>
            </select>
          </div>
          <div class="field"><label id="amazonQuantityLabel">Full cases / bags used</label><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></div>
          <div class="field"><label>Unit</label><input name="unit_type" readonly placeholder="Filled after scan"></div>
          <input name="package_weight_lbs" type="hidden">
          <div class="field"><label>Amazon Shipment / Reference</label><input name="amazon_reference" placeholder="Optional: FBA shipment ID"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" placeholder="Optional: pallet, carrier, or handoff note"></textarea></div>
          <div class="field full"><button class="btn" type="submit">Record Amazon Outbound</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Recent Amazon Outbound</h2></div>
        ${table([
          { label: "Time", render: (row) => escapeHtml(formatTime(row.timestamp)) },
          { label: "Product", render: (row) => escapeHtml(row.product?.product_name || row.product_id) },
          { label: "Lot", key: "internal_lot_id" },
          { label: "Qty", render: (row) => escapeHtml(`${formatQuantity(Math.abs(Number(row.qty_change || 0)))} ${row.unit_type || ""}`) },
          { label: "Reference", render: (row) => escapeHtml(row.related_amazon_order_id || "—") },
          { label: "By", key: "user_id" }
        ], activity)}
      </section>
    </div>
  `;

  const findLot = (lotId) => inventory.find((row) => row.internal_lot_id === lotId && Number(row.available_qty) > 0);
  const fillLot = async (value) => {
    const match = await lookupScan(value);
    const lotId = match?.type === "LOT" ? match.record.internal_lot_id : value;
    const row = findLot(lotId);
    const result = document.getElementById("amazonLotResult");
    if (!row) {
      result.textContent = "This lot was not found or has no available inventory.";
      return;
    }
    const form = document.getElementById("amazonOutboundForm");
    form.elements.internal_lot_id.value = row.internal_lot_id;
    form.elements.product_name.value = row.product?.product_name || row.product_id;
    const packageCount = Number(row.lot?.purchase_qty_received || 0);
    const packageWeight = packageCount > 0 ? Number(row.lot?.original_qty || 0) / packageCount : 0;
    const packageName = row.lot?.purchase_unit_type || "case / bag";
    form.elements.available_qty.value = `${formatQuantity(row.available_qty)} ${row.unit_type || ""}`;
    form.elements.unit_type.value = row.unit_type || row.lot?.unit_type || "";
    form.elements.package_weight_lbs.value = packageWeight || "";
    form.dataset.packageName = packageName;
    form.dataset.availableQty = row.available_qty;
    updateQuantityFields(form);
    form.elements.quantity.focus();
    const packageHint = packageWeight ? ` One ${packageName} = ${packageWeight} LB.` : "";
    result.innerHTML = `<strong>Ready:</strong> ${escapeHtml(row.product?.product_name || row.product_id)} — ${escapeHtml(formatQuantity(row.available_qty))} ${escapeHtml(row.unit_type || "")} available.${escapeHtml(packageHint)}`;
  };

  handleKeyboardScan(document.getElementById("amazonLotScan"), (value) => fillLot(value).catch((error) => notice(error.message)));
  const form = document.getElementById("amazonOutboundForm");
  form.elements.quantity_mode.addEventListener("change", () => updateQuantityFields(form));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = formToObject(event.currentTarget);
      const quantity = Number(input.quantity || 0);
      const isFullPackage = input.quantity_mode === "FULL_PACKAGE";
      const packageWeight = Number(input.package_weight_lbs || 0);
      if (isFullPackage && packageWeight <= 0) throw new Error("This sticker does not have a package weight. Choose Certain amount (LB) instead.");
      const qty = isFullPackage ? quantity * packageWeight : quantity;
      const movement = await recordAmazonOutbound(ctx.user, {
        ...input,
        qty,
        notes: [
          isFullPackage ? `${quantity} full ${form.dataset.packageName || "package(s)"} (${qty} LB)` : `${qty} LB used`,
          input.notes
        ].filter(Boolean).join(" | ")
      });
      notice(`Amazon outbound recorded: ${movement.movement_id}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function updateQuantityFields(form) {
  const fullPackage = form.elements.quantity_mode.value === "FULL_PACKAGE";
  const packageWeight = Number(form.elements.package_weight_lbs.value || 0);
  const packageName = form.dataset.packageName || "case / bag";
  const label = document.getElementById("amazonQuantityLabel");
  label.textContent = fullPackage ? `Full ${packageName}s used${packageWeight ? ` (${packageWeight} LB each)` : ""}` : "Pounds used";
  form.elements.quantity.max = fullPackage && packageWeight && form.dataset.availableQty
    ? Number(form.dataset.availableQty) / packageWeight
    : form.dataset.availableQty || "";
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
