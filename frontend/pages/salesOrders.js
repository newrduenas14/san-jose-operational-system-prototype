import {
  createSalesOrder,
  getSalesOrderDetail,
  inventorySnapshot,
  listSalesOrders,
  listSuppliers,
  salesOrderAction
} from "../js/api-smooth1.js?v=orders1";
import { can } from "../js/permissions.js?v=orders1";
import { escapeHtml, formatMoney, formatQuantity, notice, status, table } from "../js/utils.js?v=filters1";

const SALES_UNITS = ["CASE", "BAG", "BOX", "LB", "EACH", "PALLET"];
const SALES_CHANNELS = ["BULK", "AMAZON", "RETAIL", "DISTRIBUTOR", "OTHER"];
const SHIP_METHODS = ["CUSTOMER_PICKUP", "SAN_JOSE_DELIVERY", "LTL_FREIGHT", "PARCEL", "AMAZON_FBA", "OTHER"];
let nextSalesLineId = 1;

export async function render(ctx) {
  ctx.setTitle("Sales Orders", "Sell available inventory with FEFO lot recommendations");
  const [orders, parties, inventoryRows] = await Promise.all([listSalesOrders(), listSuppliers(), inventorySnapshot()]);
  const customers = parties.filter(isActive).filter(isCustomer);
  const inventoryChoices = buildInventoryChoices(inventoryRows);

  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "salesOrders:create") ? salesOrderForm(customers, inventoryChoices) : ""}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Sales Orders</h2>
            <p class="muted">Confirmed orders reserve inventory without deducting it.</p>
          </div>
        </div>
        ${table([
          { label: "SO", key: "sales_order_id" },
          { label: "Date", render: (row) => escapeHtml(formatDate(row.order_date)) },
          { label: "Customer", render: (row) => escapeHtml(row.customer?.supplier_name || row.customer_name || row.customer_id) },
          { label: "Channel", render: (row) => escapeHtml(displayValue(row.channel)) },
          { label: "Products", render: (row) => escapeHtml(row.product_names || row.line_count || 0) },
          { label: "Total", render: (row) => money(row.total_amount) },
          { label: "Status", render: (row) => status(row.status) },
          { label: "Actions", render: (row) => actionButtons(ctx, row) }
        ], orders)}
      </section>
    </div>
  `;

  setupSalesOrderBuilder(ctx, customers, inventoryChoices);
  setupSalesOrderActions(ctx);
}

function salesOrderForm(customers, inventoryChoices) {
  return `
    <section class="panel po-builder sales-order-builder">
      <div class="panel-header">
        <div>
          <h2>Create Sales Order</h2>
          <p class="muted">Inventory is allocated by lot and location. Recommended rows follow FEFO.</p>
        </div>
      </div>
      <form id="salesOrderForm">
        <div class="sales-order-header-grid">
          <div class="field">
            <label>Customer</label>
            <select name="customer_id" required>
              <option value="">Select customer</option>
              ${customers.map((customer) => `<option value="${escapeHtml(customer.supplier_id)}">${escapeHtml(customer.supplier_name)} | ${escapeHtml(customer.supplier_id)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Order Date</label><input name="order_date" type="date" value="${todayValue()}" required></div>
          <div class="field"><label>Requested Delivery / Pickup</label><input name="requested_delivery_date" type="date" required></div>
          <div class="field">
            <label>Sales Channel</label>
            <select name="sales_channel" required>${SALES_CHANNELS.map((value) => `<option>${value}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Ship Method</label>
            <select name="ship_method" required>${SHIP_METHODS.map((value) => `<option>${value}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Payment Terms</label>
            <select name="payment_terms" required>
              <option>Net 15</option><option>Net 21</option><option selected>Net 30</option>
            </select>
          </div>
          <div class="field full">
            <label>Ship To Address</label>
            <textarea name="shipping_address" placeholder="Select a customer to load the saved address" required></textarea>
          </div>
          <div class="field">
            <label>Tax</label>
            <label class="switch po-tax-switch"><input name="tax_enabled" type="checkbox"><span>Apply tax</span></label>
          </div>
          <div class="field">
            <label>Tax Rate</label>
            <div class="input-suffix"><input name="tax_rate_percent" type="number" min="0" step="0.01" value="6.25" disabled><span>%</span></div>
          </div>
          <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
        </div>

        <div class="po-lines-heading">
          <h3>Inventory Allocations</h3>
          <button id="addSalesLine" class="btn secondary" type="button">Add Inventory</button>
        </div>
        ${inventoryChoices.length ? "" : `<div class="empty">No sellable inventory is currently available.</div>`}
        <div id="salesLineItems" class="po-line-items"></div>

        <div class="po-footer sales-order-footer">
          <div class="po-totals" aria-live="polite">
            <div><span>Subtotal</span><strong id="salesSubtotal">$0.00</strong></div>
            <div><span>Tax</span><strong id="salesTax">$0.00</strong></div>
            <div><span>Estimated Gross Profit</span><strong id="salesProfit">$0.00</strong></div>
            <div><span>Estimated Gross Margin</span><strong id="salesMargin">0.00%</strong></div>
            <div class="po-grand-total"><span>Total</span><strong id="salesTotal">$0.00</strong></div>
          </div>
          <button class="btn" type="submit" ${inventoryChoices.length ? "" : "disabled"}>Create Sales Order</button>
        </div>
      </form>
    </section>
  `;
}

function setupSalesOrderBuilder(ctx, customers, inventoryChoices) {
  const form = document.getElementById("salesOrderForm");
  if (!form) return;
  const container = document.getElementById("salesLineItems");
  const customerMap = new Map(customers.map((customer) => [customer.supplier_id, customer]));
  const choiceMap = new Map(inventoryChoices.map((choice) => [choice.key, choice]));
  if (inventoryChoices.length) appendSalesLine(container, inventoryChoices);

  document.getElementById("addSalesLine")?.addEventListener("click", () => {
    appendSalesLine(container, inventoryChoices);
    updateSalesRemoveButtons(container);
  });
  form.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-sales-line]");
    if (!removeButton) return;
    removeButton.closest(".po-line-item")?.remove();
    updateSalesRemoveButtons(container);
    updateSalesTotals(form);
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "customer_id") {
      const customer = customerMap.get(event.target.value);
      if (customer?.payment_terms) form.elements.payment_terms.value = customer.payment_terms;
      form.elements.shipping_address.value = customer?.address || "";
    }
    if (event.target.name === "tax_enabled") {
      form.elements.tax_rate_percent.disabled = !event.target.checked;
    }
    const line = event.target.closest(".po-line-item");
    if (line && event.target.matches("[data-inventory-choice]")) applyInventoryChoice(line, choiceMap.get(event.target.value));
    if (line && event.target.matches('[data-line-field="unit_type"]')) applySalesUnit(line);
    if (line) updateSalesLine(line);
    updateSalesTotals(form);
  });
  form.addEventListener("input", (event) => {
    const line = event.target.closest(".po-line-item");
    if (line) updateSalesLine(line);
    updateSalesTotals(form);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = collectSalesOrder(form, choiceMap);
      const result = await createSalesOrder(ctx.user, input);
      notice(`${result.sales_order_id} created with ${result.lines.length} inventory allocation${result.lines.length === 1 ? "" : "s"}.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function appendSalesLine(container, inventoryChoices) {
  const lineId = `draft-sales-line-${nextSalesLineId++}`;
  container.insertAdjacentHTML("beforeend", `
    <section class="po-line-item sales-line-item" data-draft-line-id="${lineId}">
      <div class="po-line-title">
        <strong>Inventory</strong>
        <button class="po-remove-line" data-remove-sales-line type="button" aria-label="Remove inventory" title="Remove inventory">&times;</button>
      </div>
      <div class="sales-line-grid">
        <div class="field sales-inventory-field">
          <label>Product Search / Inventory</label>
          <select data-inventory-choice required>
            <option value="">Select available inventory</option>
            ${inventoryChoices.map((choice) => `<option value="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Internal Lot ID</label><input data-allocation-field="lot" readonly></div>
        <div class="field"><label>Location ID</label><input data-allocation-field="location" readonly></div>
        <div class="field"><label>Quantity Sold</label><input data-line-field="qty_ordered" type="number" min="0.01" step="0.01" value="1" required></div>
        <div class="field">
          <label>Sales Unit</label>
          <select data-line-field="unit_type" required>${SALES_UNITS.map((unit) => `<option>${unit}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Unit Weight Lbs</label><input data-line-field="unit_weight_lbs" type="number" min="0.01" step="0.01" value="1" required></div>
        <div class="field"><label>Unit Price</label><input data-line-field="unit_price" type="number" min="0" step="0.01" value="0" required></div>
        <div class="field"><label>Unit Cost</label><input data-line-field="unit_cost" type="number" step="0.0001" value="0" readonly></div>
      </div>
      <div class="sales-line-facts">
        <span>Available <strong data-available>0</strong></span>
        <span>Expires <strong data-expiration>Not dated</strong></span>
        <span>FEFO <strong data-fefo>Choose inventory</strong></span>
        <span>Line Total <strong data-line-total>$0.00</strong></span>
        <span>Gross Profit <strong data-line-profit>$0.00</strong></span>
      </div>
    </section>
  `);
  updateSalesRemoveButtons(container);
}

function applyInventoryChoice(line, choice) {
  if (!choice) return;
  line.dataset.inventoryKey = choice.key;
  line.dataset.productId = choice.productId;
  line.dataset.inventoryUnit = choice.inventoryUnit;
  line.dataset.availableInventoryQty = String(choice.availableInventoryQty);
  line.dataset.availableSalesQty = String(choice.availableSalesQty);
  line.dataset.baseUnitCost = String(choice.baseUnitCost);
  line.querySelector('[data-allocation-field="lot"]').value = choice.lotId;
  line.querySelector('[data-allocation-field="location"]').value = choice.locationId;
  line.querySelector('[data-line-field="unit_type"]').value = choice.salesUnit;
  line.querySelector('[data-line-field="unit_weight_lbs"]').value = formatNumber(choice.unitWeight);
  line.querySelector('[data-line-field="unit_cost"]').value = choice.unitCost.toFixed(4);
  line.querySelector("[data-available]").textContent = `${formatNumber(choice.availableSalesQty)} ${choice.salesUnit}`;
  line.querySelector("[data-expiration]").textContent = choice.expirationDate || "Not dated";
  line.querySelector("[data-fefo]").textContent = choice.recommended ? "Recommended" : "Manual override";
  updateSalesLine(line);
}

function applySalesUnit(line) {
  const unit = line.querySelector('[data-line-field="unit_type"]').value;
  const weightInput = line.querySelector('[data-line-field="unit_weight_lbs"]');
  if (unit === "LB") weightInput.value = "1";
  const weight = Number(weightInput.value || 1);
  const baseCost = Number(line.dataset.baseUnitCost || 0);
  line.querySelector('[data-line-field="unit_cost"]').value = (baseCost * weight).toFixed(4);
}

function updateSalesLine(line) {
  const qty = numericLineValue(line, "qty_ordered");
  const unitPrice = numericLineValue(line, "unit_price");
  const unitCost = numericLineValue(line, "unit_cost");
  const weight = numericLineValue(line, "unit_weight_lbs");
  const unit = line.querySelector('[data-line-field="unit_type"]').value;
  const baseCost = Number(line.dataset.baseUnitCost || 0);
  line.querySelector('[data-line-field="unit_cost"]').value = (baseCost * (unit === "LB" ? 1 : weight)).toFixed(4);
  const updatedCost = numericLineValue(line, "unit_cost");
  line.querySelector("[data-line-total]").textContent = money(qty * unitPrice);
  line.querySelector("[data-line-profit]").textContent = money(qty * (unitPrice - updatedCost));
  updateSalesTotals(document.getElementById("salesOrderForm"));
}

function updateSalesTotals(form) {
  if (!form) return;
  const totals = Array.from(form.querySelectorAll(".sales-line-item")).reduce((result, line) => {
    const qty = numericLineValue(line, "qty_ordered");
    const price = numericLineValue(line, "unit_price");
    const cost = numericLineValue(line, "unit_cost");
    result.subtotal += qty * price;
    result.profit += qty * (price - cost);
    return result;
  }, { subtotal: 0, profit: 0 });
  const taxRate = Number(form.elements.tax_rate_percent.value || 0) / 100;
  const tax = form.elements.tax_enabled.checked ? totals.subtotal * taxRate : 0;
  document.getElementById("salesSubtotal").textContent = money(totals.subtotal);
  document.getElementById("salesTax").textContent = money(tax);
  document.getElementById("salesProfit").textContent = money(totals.profit);
  document.getElementById("salesMargin").textContent = `${totals.subtotal > 0 ? (totals.profit / totals.subtotal * 100).toFixed(2) : "0.00"}%`;
  document.getElementById("salesTotal").textContent = money(totals.subtotal + tax);
}

function collectSalesOrder(form, choiceMap) {
  if (!form.elements.customer_id.value) throw new Error("Select a customer.");
  const allocatedByChoice = new Map();
  const lines = Array.from(form.querySelectorAll(".sales-line-item")).flatMap((line, index) => {
    const choice = choiceMap.get(line.querySelector("[data-inventory-choice]").value);
    if (!choice) throw new Error(`Select inventory on line ${index + 1}.`);
    const qty = numericLineValue(line, "qty_ordered");
    const unit = line.querySelector('[data-line-field="unit_type"]').value;
    const weight = numericLineValue(line, "unit_weight_lbs");
    const price = numericLineValue(line, "unit_price");
    if (qty <= 0) throw new Error(`Quantity must be greater than zero on line ${index + 1}.`);
    if (weight <= 0) throw new Error(`Unit weight must be greater than zero on line ${index + 1}.`);
    if (price < 0) throw new Error(`Unit price cannot be negative on line ${index + 1}.`);
    return allocateFefoLots(choice, qty, unit, weight, price, choiceMap, allocatedByChoice, index + 1);
  });
  return {
    customer_id: form.elements.customer_id.value,
    order_date: form.elements.order_date.value,
    requested_delivery_date: form.elements.requested_delivery_date.value,
    sales_channel: form.elements.sales_channel.value,
    ship_method: form.elements.ship_method.value,
    payment_terms: form.elements.payment_terms.value,
    shipping_address: form.elements.shipping_address.value.trim(),
    tax_enabled: form.elements.tax_enabled.checked,
    tax_rate_percent: Number(form.elements.tax_rate_percent.value || 6.25),
    notes: form.elements.notes.value,
    lines
  };
}

function allocateFefoLots(selectedChoice, requestedQty, unit, weight, price, choiceMap, allocatedByChoice, lineNumber) {
  const sameVariation = Array.from(choiceMap.values()).filter((choice) =>
    choice.productId === selectedChoice.productId
    && choice.salesUnit === selectedChoice.salesUnit
    && Math.abs(choice.unitWeight - selectedChoice.unitWeight) < 0.001
  );
  const candidates = selectedChoice.recommended
    ? sameVariation
    : [selectedChoice, ...sameVariation.filter((choice) => choice.key !== selectedChoice.key)];
  const allocations = [];
  let remainingQty = requestedQty;

  candidates.forEach((choice) => {
    if (remainingQty <= 0.0001) return;
    const conversion = choice.inventoryUnit === unit ? 1 : weight;
    const alreadyAllocated = allocatedByChoice.get(choice.key) || 0;
    const remainingInventoryQty = Math.max(0, choice.availableInventoryQty - alreadyAllocated);
    const availableSalesQty = remainingInventoryQty / conversion;
    const allocatedSalesQty = Math.min(remainingQty, availableSalesQty);
    if (allocatedSalesQty <= 0) return;
    const inventoryQty = allocatedSalesQty * conversion;
    allocatedByChoice.set(choice.key, alreadyAllocated + inventoryQty);
    allocations.push({
      product_id: choice.productId,
      internal_lot_id: choice.lotId,
      location_id: choice.locationId,
      qty_ordered: Number(allocatedSalesQty.toFixed(4)),
      unit_type: unit,
      unit_weight_lbs: weight,
      unit_price: price,
      unit_cost: choice.baseUnitCost * conversion
    });
    remainingQty -= allocatedSalesQty;
  });

  if (remainingQty > 0.0001) {
    throw new Error(`Line ${lineNumber} exceeds all available FEFO inventory for this product and pack variation.`);
  }
  return allocations;
}

function buildInventoryChoices(rows) {
  const today = startOfDay(new Date());
  const choices = rows.map((row) => {
    const lot = row.lot || {};
    const product = row.product || {};
    const availableInventoryQty = Number(row.available_qty ?? row.qty ?? row.current_qty ?? 0);
    const expiration = effectiveExpiration(lot, product);
    const unitWeight = lotUnitWeight(lot);
    const inventoryUnit = String(row.unit_type || lot.unit_type || "LB").toUpperCase();
    const salesUnit = String(lot.purchase_unit_type || inventoryUnit).toUpperCase();
    const availableSalesQty = inventoryUnit === salesUnit ? availableInventoryQty : inventoryUnit === "LB" ? availableInventoryQty / unitWeight : 0;
    const baseUnitCost = inventoryUnit === salesUnit ? Number(lot.unit_cost || 0) : Number(lot.unit_cost || 0) / unitWeight;
    return {
      key: `${row.product_id}|${row.internal_lot_id}|${row.location_id}`,
      productId: row.product_id,
      productName: product.product_name || row.product_id,
      lotId: row.internal_lot_id,
      locationId: row.location_id,
      inventoryUnit,
      salesUnit,
      unitWeight,
      unitCost: baseUnitCost * (salesUnit === "LB" ? 1 : unitWeight),
      baseUnitCost,
      availableInventoryQty,
      availableSalesQty,
      expirationDate: expiration ? dateValue(expiration) : "",
      expirationSort: expiration ? expiration.getTime() : Number.MAX_SAFE_INTEGER,
      receivedSort: new Date(lot.received_date || 0).getTime(),
      lotStatus: String(lot.status || "ACTIVE").toUpperCase()
    };
  }).filter((choice) =>
    choice.availableInventoryQty > 0
    && choice.availableSalesQty > 0
    && ["ACTIVE", "AVAILABLE"].includes(choice.lotStatus)
    && (!choice.expirationDate || startOfDay(choice.expirationDate) >= today)
  ).sort((a, b) =>
    a.productName.localeCompare(b.productName)
    || a.expirationSort - b.expirationSort
    || a.receivedSort - b.receivedSort
  );

  const recommendedVariations = new Set();
  choices.forEach((choice) => {
    const variation = `${choice.productId}|${choice.salesUnit}|${choice.unitWeight}`;
    choice.recommended = !recommendedVariations.has(variation);
    recommendedVariations.add(variation);
    choice.label = `${choice.recommended ? "[RECOMMENDED] " : ""}${choice.productName} | ${choice.lotId} | ${formatNumber(choice.unitWeight)} LB ${choice.salesUnit} | ${choice.locationId} | ${formatNumber(choice.availableSalesQty)} available | ${choice.expirationDate || "No expiration"}`;
  });
  return choices;
}

function setupSalesOrderActions(ctx) {
  document.querySelectorAll("[data-sales-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { salesOrderId, salesAction } = button.dataset;
      if (["blSjp", "pickList"].includes(salesAction)) {
        const documentWindow = window.open("", "_blank");
        if (!documentWindow) return notice("Pop-up blocked. Allow pop-ups to open Sales Order documents.");
        try {
          documentWindow.document.write("<p>Preparing Sales Order...</p>");
          const detail = await getSalesOrderDetail(salesOrderId);
          documentWindow.document.open();
          documentWindow.document.write(salesAction === "pickList" ? printablePickList(detail) : printableBillOfLading(detail));
          documentWindow.document.close();
        } catch (error) {
          documentWindow.close();
          notice(error.message);
        }
        return;
      }
      try {
        await salesOrderAction(ctx.user, salesOrderId, salesAction);
        notice(`${salesOrderId} marked ${salesAction.toLowerCase()}.`);
        await render(ctx);
      } catch (error) {
        notice(error.message);
      }
    });
  });
}

function actionButtons(ctx, order) {
  if (!can(ctx.user, "salesOrders:view")) return "";
  const orderStatus = String(order.status || "DRAFT").toUpperCase();
  const operator = String(ctx.user.role || "").toUpperCase() === "OPERATOR";
  return `
    <div class="actions po-actions">
      <button class="btn secondary" data-sales-action="blSjp" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">BL SJP</button>
      <button class="btn secondary" data-sales-action="pickList" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">Pick List</button>
      ${!operator && orderStatus === "DRAFT" ? actionButton(order, "CONFIRM", "Mark Confirmed") : ""}
      ${orderStatus === "CONFIRMED" ? actionButton(order, "PICKED", "Mark Picked") : ""}
      ${!operator && orderStatus === "PICKED" ? actionButton(order, "SHIPPED", "Mark Shipped") : ""}
    </div>
  `;
}

function actionButton(order, action, label) {
  return `<button class="btn" data-sales-action="${action}" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">${label}</button>`;
}

export function printableBillOfLading(detail) {
  if (!detail) throw new Error("Sales Order was not found.");
  const { order, lines } = detail;
  const customerName = order.customer?.supplier_name || order.customer_name || "";
  const shipToAddress = order.shipping_address || order.customer?.address || "";
  const logoUrl = new URL("../logo_San_Jose.png", window.location.href).href;
  const totals = lines.reduce((result, line) => {
    const qty = Number(line.qty_ordered || 0);
    const unit = String(line.unit_type || "").toUpperCase();
    result.weight += qty * Number(line.unit_weight_lbs || 0);
    if (["CASE", "BOX"].includes(unit)) result.boxes += qty;
    return result;
  }, { boxes: 0, weight: 0 });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BL ${escapeHtml(order.bl_folio || order.sales_order_id)}</title>
    <style>
      @page{size:letter;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#050505;margin:0;font-size:12px}.toolbar{margin:0 0 14px}.toolbar button{padding:9px 15px}.sheet{max-width:760px;margin:auto}.header{position:relative;min-height:128px;text-align:center}.logo{width:255px;max-height:110px;object-fit:contain}.folio{position:absolute;right:4px;top:14px;text-align:left;font-weight:700;font-size:13px}.folio strong{display:block;font-size:29px;line-height:1.05}.company-address{font-weight:700;font-size:12px;margin-top:-5px}.ship-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:20px 0 14px}.ship-box{border:2px solid #050505;min-height:100px}.ship-box h2{font-size:13px;margin:0;padding:5px 8px;border-bottom:2px solid #050505}.ship-box div{padding:8px;font-size:13px;line-height:1.4;white-space:pre-line}.items{width:100%;border-collapse:collapse;table-layout:fixed}.items th,.items td{border:2px solid #050505;padding:6px 7px;height:32px}.items th{font-size:12px;text-align:center}.items th:first-child{width:54%}.items th:nth-child(2){width:15%}.items th:nth-child(3){width:16%}.items th:nth-child(4){width:15%}.number{text-align:center}.product{font-weight:700}.product small{display:block;font-weight:400;margin-top:2px}.totals{display:grid;grid-template-columns:repeat(3,1fr);margin-top:12px;border:2px solid #050505}.totals div{padding:9px 12px;display:flex;justify-content:space-between;border-right:2px solid #050505;font-weight:700}.totals div:last-child{border-right:0}.signatures{margin-top:26px}.line{display:grid;grid-template-columns:105px 1fr;align-items:end;margin-top:18px}.line span:last-child{border-bottom:1px solid #050505;min-height:22px}.signature-row{display:grid;grid-template-columns:1fr 1fr;gap:28px}.muted{font-size:10px;color:#333}@media print{.toolbar{display:none}.sheet{max-width:none}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print BL SJP</button></div><main class="sheet">
      <header class="header"><img class="logo" src="${escapeHtml(logoUrl)}" alt="San Jose Produce"><div class="folio">FOLIO:<strong>${escapeHtml(order.bl_folio || "PENDING")}</strong></div><div class="company-address">6001 S INTERNATIONAL PKWY SUITE 50<br>MCALLEN, TX 78503</div></header>
      <section class="ship-grid"><div class="ship-box"><h2>SHIP FROM</h2><div><strong>SAN JOSE PRODUCE &amp; IMPORTS LLC</strong>\n6001 S INTERNATIONAL PKWY SUITE 50\nMCALLEN, TX 78503</div></div><div class="ship-box"><h2>SHIP TO</h2><div><strong>${escapeHtml(customerName)}</strong>\n${escapeHtml(shipToAddress)}</div></div></section>
      <table class="items"><thead><tr><th>DESCRIPTION</th><th>WEIGHT</th><th>LOTE</th><th>BOXES</th></tr></thead><tbody>${lines.map((line) => {
        const qty = Number(line.qty_ordered || 0);
        const unit = String(line.unit_type || "").toUpperCase();
        const boxes = ["CASE", "BOX"].includes(unit) ? formatNumber(qty) : `${formatNumber(qty)} ${unit}`;
        return `<tr><td class="product">${escapeHtml(line.product?.product_name || line.product_id)}<small>${escapeHtml(line.product_id)} | ${escapeHtml(line.preferred_location_id || "")}</small></td><td class="number">${formatNumber(qty * Number(line.unit_weight_lbs || 0))} LB</td><td class="number">${escapeHtml(line.preferred_internal_lot_id || "")}</td><td class="number">${escapeHtml(boxes)}</td></tr>`;
      }).join("")}</tbody></table>
      <section class="totals"><div><span>TOTAL BOXES</span><strong>${formatNumber(totals.boxes)}</strong></div><div><span>TOTAL PALLETS</span><strong>&nbsp;</strong></div><div><span>TOTAL WEIGHT</span><strong>${formatNumber(totals.weight)} LB</strong></div></section>
      <section class="signatures"><div class="line"><span>SHIPPER:</span><span>${escapeHtml(displayValue(order.ship_method || ""))}</span></div><div class="line"><span>ADDRESS:</span><span></span></div><div class="signature-row"><div class="line"><span>NAME:</span><span></span></div><div class="line"><span>DATE:</span><span></span></div></div><div class="signature-row"><div class="line"><span>SIGNATURE:</span><span></span></div><div class="line"><span>SO:</span><span>${escapeHtml(order.sales_order_id)}</span></div></div></section>
    </main></body></html>`;
}

function printablePickList(detail) {
  if (!detail) throw new Error("Sales Order was not found.");
  const { order, lines } = detail;
  return printableDocument("Warehouse Pick List", order, lines, true);
}

function printableDocument(title, order, lines, pickList) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(order.sales_order_id)} ${title}</title>
    <style>body{font-family:Arial,sans-serif;color:#17211b;margin:24px}button{padding:9px 14px;margin-bottom:18px}h1{margin:0 0 14px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;border:1px solid #d8e1da;padding:14px;margin-bottom:18px}.meta span{color:#607064;display:block;font-size:12px;font-weight:700}.meta strong{display:block;margin-top:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8e1da;padding:8px;text-align:left}th{background:#eaf3ec}.number{text-align:right}.totals{margin:18px 0 0 auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:5px}.grand{border-top:2px solid #17211b}@media print{button{display:none}body{margin:10mm}}</style>
    </head><body><button onclick="window.print()">Print ${title}</button><h1>${title} ${escapeHtml(order.sales_order_id)}</h1>
    <section class="meta"><div><span>Customer</span><strong>${escapeHtml(order.customer?.supplier_name || order.customer_name)}</strong></div><div><span>Status</span><strong>${escapeHtml(order.status)}</strong></div><div><span>Order Date</span><strong>${escapeHtml(formatDate(order.order_date))}</strong></div><div><span>Requested Date</span><strong>${escapeHtml(formatDate(order.ship_by_date))}</strong></div><div><span>Channel</span><strong>${escapeHtml(displayValue(order.channel))}</strong></div><div><span>Ship Method</span><strong>${escapeHtml(displayValue(order.ship_method))}</strong></div></section>
    <table><thead><tr><th>Product</th><th>Lot</th><th>Location</th><th class="number">Qty</th><th>Unit</th><th class="number">Weight</th>${pickList ? "<th>Pick Status</th>" : "<th class=\"number\">Price</th><th class=\"number\">Total</th>"}</tr></thead><tbody>${lines.map((line) => `<tr><td>${escapeHtml(line.product?.product_name || line.product_id)}</td><td>${escapeHtml(line.preferred_internal_lot_id)}</td><td>${escapeHtml(line.preferred_location_id)}</td><td class="number">${formatNumber(line.qty_ordered)}</td><td>${escapeHtml(line.unit_type)}</td><td class="number">${formatNumber(line.unit_weight_lbs)} LB</td>${pickList ? `<td>${escapeHtml(line.line_status)}</td>` : `<td class="number">${money(line.unit_price)}</td><td class="number">${money(line.line_total)}</td>`}</tr>`).join("")}</tbody></table>
    ${pickList ? "" : `<section class="totals"><div><span>Subtotal</span><strong>${money(order.subtotal_amount)}</strong></div><div><span>Tax</span><strong>${money(order.tax_amount)}</strong></div><div><span>Estimated Gross Profit</span><strong>${money(order.estimated_gross_profit)}</strong></div><div class="grand"><span>Total</span><strong>${money(order.total_amount)}</strong></div></section>`}</body></html>`;
}

function updateSalesRemoveButtons(container) {
  const lines = container.querySelectorAll(".sales-line-item");
  lines.forEach((line) => {
    line.querySelector("[data-remove-sales-line]").disabled = lines.length === 1;
  });
}

function effectiveExpiration(lot, product) {
  if (lot.expiration_date) return startOfDay(lot.expiration_date);
  const received = startOfDay(lot.received_date);
  const days = Number(product.perishability_days || 0);
  return received && days > 0 ? new Date(received.getTime() + days * 86400000) : null;
}

function lotUnitWeight(lot) {
  const original = Number(lot.original_qty || 0);
  const purchased = Number(lot.purchase_qty_received || 0);
  return original > 0 && purchased > 0 ? original / purchased : 1;
}

function startOfDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateValue(value) {
  const date = startOfDay(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function numericLineValue(line, field) {
  return Number(line.querySelector(`[data-line-field="${field}"]`)?.value || 0);
}

function isActive(record) {
  return record.is_active === undefined || record.is_active === "" || record.is_active === true || String(record.is_active).toUpperCase() === "TRUE";
}

function isCustomer(record) {
  return String(record.party_type || "VENDOR").toUpperCase() === "CUSTOMER";
}

function displayValue(value) {
  return String(value || "").replaceAll("_", " ");
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function formatNumber(value) {
  return formatQuantity(value);
}

function money(value) {
  return formatMoney(value);
}
