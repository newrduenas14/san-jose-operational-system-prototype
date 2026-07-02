import {
  createSalesOrder,
  getSalesOrderDetail,
  inventorySnapshot,
  listSalesOrders,
  listSuppliers,
  salesOrderAction
} from "../js/api-smooth1.js?v=send1";
import { can } from "../js/permissions.js?v=send1";
import { escapeHtml, formatMoney, formatQuantity, notice, status, table } from "../js/utils.js?v=filters1";

const SALES_UNITS = ["CASE", "BAG", "BOX", "LB", "EACH", "PALLET"];
const SALES_CHANNELS = ["BULK", "AMAZON", "RETAIL", "DISTRIBUTOR", "OTHER"];
const SHIP_METHODS = ["CUSTOMER_PICKUP", "SAN_JOSE_DELIVERY", "LTL_FREIGHT", "PARCEL", "AMAZON_FBA", "OTHER"];
let nextSalesLineId = 1;

export async function render(ctx) {
  ctx.setTitle("Sales Orders", "Create clean finance and warehouse documents without deducting inventory");
  const [orders, parties, inventoryRows] = await Promise.all([listSalesOrders(), listSuppliers(), inventorySnapshot()]);
  const customers = parties.filter(isActive).filter(isCustomer);
  const inventoryChoices = buildInventoryChoices(inventoryRows);
  const productChoices = buildProductChoices(inventoryChoices);

  ctx.view.innerHTML = `
    <div class="grid">
      ${can(ctx.user, "salesOrders:create") ? salesOrderForm(customers, productChoices) : ""}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Sales Orders</h2>
            <p class="muted">Sales Orders reserve/recommend inventory. Actual deduction happens in Send Product after scanning the physical lot.</p>
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

  setupSalesOrderBuilder(ctx, customers, inventoryChoices, productChoices);
  setupSalesOrderActions(ctx);
}

function salesOrderForm(customers, productChoices) {
  return `
    <section class="panel po-builder sales-order-builder">
      <div class="panel-header">
        <div>
          <h2>Create Sales Order</h2>
          <p class="muted">Order by cases/boxes/lb. The app recommends matching case weight first, then FEFO lots and spaces.</p>
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
          <h3>Products Ordered</h3>
          <button id="addSalesLine" class="btn secondary" type="button">Add Product</button>
        </div>
        ${productChoices.length ? "" : `<div class="empty">No sellable inventory is currently available.</div>`}
        <div id="salesLineItems" class="po-line-items"></div>

        <div class="po-footer sales-order-footer">
          <div class="po-totals" aria-live="polite">
            <div><span>Subtotal</span><strong id="salesSubtotal">$0.00</strong></div>
            <div><span>Tax</span><strong id="salesTax">$0.00</strong></div>
            <div><span>Estimated Gross Profit</span><strong id="salesProfit">$0.00</strong></div>
            <div><span>Estimated Gross Margin</span><strong id="salesMargin">0.00%</strong></div>
            <div class="po-grand-total"><span>Total</span><strong id="salesTotal">$0.00</strong></div>
          </div>
          <button class="btn" type="submit" ${productChoices.length ? "" : "disabled"}>Create Sales Order</button>
        </div>
      </form>
    </section>
  `;
}

function setupSalesOrderBuilder(ctx, customers, inventoryChoices, productChoices) {
  const form = document.getElementById("salesOrderForm");
  if (!form) return;
  const container = document.getElementById("salesLineItems");
  const customerMap = new Map(customers.map((customer) => [customer.supplier_id, customer]));
  const productMap = new Map(productChoices.map((product) => [product.productId, product]));
  const choiceMap = new Map(inventoryChoices.map((choice) => [choice.key, choice]));
  if (productChoices.length) appendSalesLine(container, productChoices);

  document.getElementById("addSalesLine")?.addEventListener("click", () => {
    appendSalesLine(container, productChoices);
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
    if (line && event.target.matches("[data-product-choice]")) applyProductChoice(line, productMap.get(event.target.value), inventoryChoices);
    if (line && event.target.matches('[data-line-field="unit_type"]')) applySalesUnit(line);
    if (line) updateSalesLine(line, inventoryChoices);
    updateSalesTotals(form);
  });
  form.addEventListener("input", (event) => {
    const line = event.target.closest(".po-line-item");
    if (line) updateSalesLine(line, inventoryChoices);
    updateSalesTotals(form);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = collectSalesOrder(form, choiceMap);
      const result = await createSalesOrder(ctx.user, input);
      notice(`${result.sales_order_id} created. Inventory is reserved/recommended, not deducted.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
}

function appendSalesLine(container, productChoices) {
  const lineId = `draft-sales-line-${nextSalesLineId++}`;
  container.insertAdjacentHTML("beforeend", `
    <section class="po-line-item sales-line-item" data-draft-line-id="${lineId}">
      <div class="po-line-title">
        <strong>Product</strong>
        <button class="po-remove-line" data-remove-sales-line type="button" aria-label="Remove inventory" title="Remove inventory">&times;</button>
      </div>
      <div class="sales-line-grid">
        <div class="field sales-inventory-field">
          <label>Product</label>
          <select data-product-choice required>
            <option value="">Select product</option>
            ${productChoices.map((product) => `<option value="${escapeHtml(product.productId)}">${escapeHtml(product.productName)} | ${formatNumber(product.availableLb)} LB available</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Quantity Sold</label><input data-line-field="qty_ordered" type="number" min="0.01" step="0.01" value="1" required></div>
        <div class="field">
          <label>Sales Unit</label>
          <select data-line-field="unit_type" required>${SALES_UNITS.map((unit) => `<option>${unit}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Weight Per Unit (LB)</label><input data-line-field="unit_weight_lbs" type="number" min="0.01" step="0.01" value="1" required></div>
        <div class="field"><label>Unit Price</label><input data-line-field="unit_price" type="number" min="0" step="0.01" value="0" required></div>
        <div class="field"><label>Est. Unit Cost</label><input data-line-field="unit_cost" type="number" step="0.0001" value="0" readonly></div>
      </div>
      <div class="sales-line-facts">
        <span>Available <strong data-available>Choose product</strong></span>
        <span>Total Weight <strong data-total-weight>0 LB</strong></span>
        <span>Recommendation <strong data-fefo>Choose product</strong></span>
        <span>Line Total <strong data-line-total>$0.00</strong></span>
        <span>Gross Profit <strong data-line-profit>$0.00</strong></span>
      </div>
      <div class="sales-allocation-preview" data-allocation-preview>Choose a product to see recommended lots.</div>
    </section>
  `);
  updateSalesRemoveButtons(container);
}

function applyProductChoice(line, product, inventoryChoices) {
  if (!product) {
    line.dataset.productId = "";
    line.querySelector("[data-available]").textContent = "Choose product";
    line.querySelector("[data-fefo]").textContent = "Choose product";
    line.querySelector("[data-allocation-preview]").textContent = "Choose a product to see recommended lots.";
    updateSalesLine(line, inventoryChoices);
    return;
  }
  line.dataset.productId = product.productId;
  line.dataset.productName = product.productName;
  line.querySelector('[data-line-field="unit_type"]').value = product.defaultSalesUnit;
  line.querySelector('[data-line-field="unit_weight_lbs"]').value = formatNumber(product.defaultUnitWeight);
  line.querySelector("[data-available]").textContent = `${formatNumber(product.availableLb)} LB across ${product.lotCount} lot${product.lotCount === 1 ? "" : "s"}`;
  updateSalesLine(line, inventoryChoices);
}

function applySalesUnit(line) {
  const unit = line.querySelector('[data-line-field="unit_type"]').value;
  const weightInput = line.querySelector('[data-line-field="unit_weight_lbs"]');
  if (unit === "LB") weightInput.value = "1";
}

function updateSalesLine(line, inventoryChoices = []) {
  const qty = numericLineValue(line, "qty_ordered");
  const unitPrice = numericLineValue(line, "unit_price");
  const recommendation = recommendLotsForLine(line, inventoryChoices);
  line.querySelector('[data-line-field="unit_cost"]').value = recommendation.unitCost.toFixed(4);
  line.querySelector("[data-total-weight]").textContent = `${formatNumber(recommendation.neededWeight)} LB`;
  line.querySelector("[data-fefo]").textContent = recommendation.status;
  line.querySelector("[data-allocation-preview]").innerHTML = recommendation.html;
  line.querySelector("[data-line-total]").textContent = money(qty * unitPrice);
  line.querySelector("[data-line-profit]").textContent = money(qty * (unitPrice - recommendation.unitCost));
  updateSalesTotals(document.getElementById("salesOrderForm"));
}

function recommendLotsForLine(line, inventoryChoices) {
  const productId = line.dataset.productId || "";
  const qty = numericLineValue(line, "qty_ordered");
  const unit = line.querySelector('[data-line-field="unit_type"]').value;
  const weight = numericLineValue(line, "unit_weight_lbs");
  const neededWeight = qty * weight;
  if (!productId) return { unitCost: 0, neededWeight: 0, status: "Choose product", html: "Choose a product to see recommended lots." };
  if (qty <= 0 || weight <= 0) return { unitCost: 0, neededWeight, status: "Enter quantity", html: "Enter a quantity and weight to calculate lot recommendations." };

  const candidates = inventoryChoices
    .filter((choice) => choice.productId === productId && choice.inventoryUnit === "LB")
    .sort((a, b) => compareSalesAllocationChoices(a, b, unit, weight));
  const allocations = [];
  let remainingWeight = neededWeight;
  let totalCost = 0;

  candidates.forEach((choice) => {
    if (remainingWeight <= 0.0001) return;
    const allocatedWeight = Math.min(remainingWeight, choice.availableInventoryQty);
    if (allocatedWeight <= 0) return;
    const allocatedUnits = allocatedWeight / weight;
    totalCost += allocatedWeight * choice.baseUnitCost;
    allocations.push({ choice, allocatedWeight, allocatedUnits });
    remainingWeight -= allocatedWeight;
  });

  if (!allocations.length) return { unitCost: 0, neededWeight, status: "No stock", html: "No available sellable lots for this product." };

  const averageUnitCost = qty > 0 ? totalCost / qty : 0;
  const short = remainingWeight > 0.0001;
  const exactMatches = allocations.filter(({ choice }) => isExactSalesPack(choice, unit, weight)).length;
  const html = `
    <div class="sales-allocation-summary ${short ? "is-short" : ""}">
      ${short
        ? `Short ${escapeHtml(formatNumber(remainingWeight))} LB. Available lots cover ${escapeHtml(formatNumber(neededWeight - remainingWeight))} of ${escapeHtml(formatNumber(neededWeight))} LB.`
        : `Recommended split covers ${escapeHtml(formatNumber(qty))} ${escapeHtml(unit)} (${escapeHtml(formatNumber(neededWeight))} LB). Exact pack matches are prioritized before fallback lots.`}
    </div>
    <div class="sales-allocation-list">
      ${allocations.map(({ choice, allocatedWeight, allocatedUnits }) => {
        const originalUnits = choice.unitWeight > 0 ? allocatedWeight / choice.unitWeight : 0;
        const matchLabel = isExactSalesPack(choice, unit, weight) ? "exact pack" : "fallback pack";
        return `<span>${escapeHtml(choice.lotId)} @ ${escapeHtml(choice.locationId)}: ${escapeHtml(formatNumber(allocatedUnits))} ${escapeHtml(unit)} / ${escapeHtml(formatNumber(allocatedWeight))} LB <small>(${escapeHtml(formatNumber(originalUnits))} ${escapeHtml(choice.salesUnit)} from lot · ${matchLabel})</small></span>`;
      }).join("")}
    </div>
  `;
  return { unitCost: averageUnitCost, neededWeight, status: short ? "Short stock" : `${allocations.length} lot${allocations.length === 1 ? "" : "s"}, ${exactMatches} exact`, html };
}

function collectSalesOrder(form, choiceMap) {
  if (!form.elements.customer_id.value) throw new Error("Select a customer.");
  const allocatedByChoice = new Map();
  const lines = Array.from(form.querySelectorAll(".sales-line-item")).flatMap((line, index) => {
    const productId = line.querySelector("[data-product-choice]").value;
    if (!productId) throw new Error(`Select a product on line ${index + 1}.`);
    const qty = numericLineValue(line, "qty_ordered");
    const unit = line.querySelector('[data-line-field="unit_type"]').value;
    const weight = numericLineValue(line, "unit_weight_lbs");
    const price = numericLineValue(line, "unit_price");
    if (qty <= 0) throw new Error(`Quantity must be greater than zero on line ${index + 1}.`);
    if (weight <= 0) throw new Error(`Unit weight must be greater than zero on line ${index + 1}.`);
    if (price < 0) throw new Error(`Unit price cannot be negative on line ${index + 1}.`);
    return allocateRecommendedLots(productId, qty, unit, weight, price, choiceMap, allocatedByChoice, index + 1);
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

function allocateRecommendedLots(productId, requestedQty, unit, weight, price, choiceMap, allocatedByChoice, lineNumber) {
  const candidates = Array.from(choiceMap.values())
    .filter((choice) => choice.productId === productId && choice.inventoryUnit === "LB")
    .sort((a, b) => compareSalesAllocationChoices(a, b, unit, weight));
  const allocations = [];
  let remainingWeight = requestedQty * weight;

  candidates.forEach((choice) => {
    if (remainingWeight <= 0.0001) return;
    const alreadyAllocated = allocatedByChoice.get(choice.key) || 0;
    const availableWeight = Math.max(0, choice.availableInventoryQty - alreadyAllocated);
    const allocatedWeight = Math.min(remainingWeight, availableWeight);
    if (allocatedWeight <= 0) return;
    const allocatedSalesQty = allocatedWeight / weight;
    allocatedByChoice.set(choice.key, alreadyAllocated + allocatedWeight);
    allocations.push({
      product_id: choice.productId,
      internal_lot_id: choice.lotId,
      location_id: choice.locationId,
      qty_ordered: Number(allocatedSalesQty.toFixed(4)),
      unit_type: unit,
      unit_weight_lbs: weight,
      unit_price: price,
      unit_cost: choice.baseUnitCost * weight,
      notes: isExactSalesPack(choice, unit, weight) ? "Exact pack match." : `Fallback pack: inventory is ${formatNumber(choice.unitWeight)} LB ${choice.salesUnit}.`
    });
    remainingWeight -= allocatedWeight;
  });

  if (remainingWeight > 0.0001) {
    throw new Error(`Line ${lineNumber} needs ${formatNumber(requestedQty * weight)} LB, but only ${formatNumber(requestedQty * weight - remainingWeight)} LB is available for this product.`);
  }
  return allocations;
}

function buildInventoryChoices(rows) {
  const today = startOfDay(new Date());
  return rows.map((row) => {
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
  );
}

function buildProductChoices(inventoryChoices) {
  const products = new Map();
  inventoryChoices.forEach((choice) => {
    if (choice.inventoryUnit !== "LB") return;
    const current = products.get(choice.productId) || { productId: choice.productId, productName: choice.productName, availableLb: 0, lotCount: 0, defaultSalesUnit: choice.salesUnit || "CASE", defaultUnitWeight: choice.unitWeight || 1 };
    current.availableLb += choice.availableInventoryQty;
    current.lotCount += 1;
    if (choice.unitWeight > current.defaultUnitWeight) {
      current.defaultSalesUnit = choice.salesUnit || current.defaultSalesUnit;
      current.defaultUnitWeight = choice.unitWeight || current.defaultUnitWeight;
    }
    products.set(choice.productId, current);
  });
  return Array.from(products.values()).map((product) => ({ ...product, availableLb: Number(product.availableLb.toFixed(4)) })).sort((a, b) => a.productName.localeCompare(b.productName));
}

function compareSalesAllocationChoices(a, b, requestedUnit, requestedWeight) {
  const exactA = isExactSalesPack(a, requestedUnit, requestedWeight) ? 0 : 1;
  const exactB = isExactSalesPack(b, requestedUnit, requestedWeight) ? 0 : 1;
  return exactA - exactB
    || a.expirationSort - b.expirationSort
    || b.availableInventoryQty - a.availableInventoryQty
    || a.receivedSort - b.receivedSort
    || a.lotId.localeCompare(b.lotId)
    || a.locationId.localeCompare(b.locationId);
}

function isExactSalesPack(choice, requestedUnit, requestedWeight) {
  return String(choice.salesUnit || "").toUpperCase() === String(requestedUnit || "").toUpperCase()
    && Math.abs(Number(choice.unitWeight || 0) - Number(requestedWeight || 0)) < 0.001;
}

function setupSalesOrderActions(ctx) {
  document.querySelectorAll("[data-sales-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { salesOrderId, salesAction } = button.dataset;
      if (["financePdf", "warehousePdf"].includes(salesAction)) {
        const documentWindow = window.open("", "_blank");
        if (!documentWindow) return notice("Pop-up blocked. Allow pop-ups to open Sales Order documents.");
        try {
          documentWindow.document.write("<p>Preparing Sales Order...</p>");
          const detail = await getSalesOrderDetail(salesOrderId);
          documentWindow.document.open();
          documentWindow.document.write(salesAction === "financePdf" ? printableSalesOrderFinance(detail) : printableSalesOrderWarehouse(detail));
          documentWindow.document.close();
        } catch (error) {
          documentWindow.close();
          notice(error.message);
        }
        return;
      }
      if (salesAction === "sendProduct") {
        window.location.hash = `sendProduct:${salesOrderId}`;
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
      <button class="btn secondary" data-sales-action="warehousePdf" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">Warehouse PDF</button>
      <button class="btn secondary" data-sales-action="financePdf" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">Finance PDF</button>
      ${!operator && orderStatus === "DRAFT" ? actionButton(order, "CONFIRM", "Mark Confirmed") : ""}
      ${["CONFIRMED", "PICKED", "PARTIALLY_PICKED"].includes(orderStatus) ? `<button class="btn" data-sales-action="sendProduct" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">Send Product</button>` : ""}
      ${!operator && orderStatus === "PICKED" ? actionButton(order, "SHIPPED", "Mark Shipped") : ""}
    </div>
  `;
}

function actionButton(order, action, label) {
  return `<button class="btn" data-sales-action="${action}" data-sales-order-id="${escapeHtml(order.sales_order_id)}" type="button">${label}</button>`;
}

export function printableSalesOrderFinance(detail) {
  if (!detail) throw new Error("Sales Order was not found.");
  return printableSalesOrderDocument(detail, { finance: true, title: "SALES ORDER - FINANCE" });
}

export function printableSalesOrderWarehouse(detail) {
  if (!detail) throw new Error("Sales Order was not found.");
  return printableSalesOrderDocument(detail, { finance: false, title: "SALES ORDER - WAREHOUSE" });
}

function printableSalesOrderDocument(detail, options) {
  const { order, lines } = detail;
  const finance = Boolean(options.finance);
  const customerName = order.customer?.supplier_name || order.customer_name || "";
  const billTo = [customerName, order.customer_email, order.customer_phone].filter(Boolean).join("\n");
  const shipTo = [customerName, order.shipping_address || order.customer?.address || ""].filter(Boolean).join("\n");
  const logoUrl = new URL("../logo_San_Jose.png", window.location.href).href;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(order.sales_order_id)} ${options.title}</title>
    <style>
      @page{size:letter;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17211b;margin:0;font-size:12px;background:white}.toolbar{padding:12px}.toolbar button{padding:9px 15px}.sheet{max-width:800px;margin:auto;padding:18px}.doc-header{display:grid;grid-template-columns:1fr auto;gap:18px;border-bottom:3px solid #17211b;padding-bottom:14px}.brand{display:flex;gap:12px;align-items:center}.brand img{width:78px;height:78px;object-fit:contain}.brand h1{font-size:23px;margin:0}.brand p{margin:4px 0 0;line-height:1.35}.doc-title{text-align:right}.doc-title h2{font-size:28px;margin:0}.doc-title strong{display:block;margin-top:7px}.box-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.box{border:1px solid #b9c8be;border-radius:8px;min-height:92px}.box h3{background:#eaf3ec;border-bottom:1px solid #b9c8be;margin:0;padding:8px 10px;font-size:12px}.box div{padding:10px;white-space:pre-line;line-height:1.4}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.meta div{border:1px solid #d8e1da;border-radius:8px;padding:8px}.meta span{color:#607064;display:block;font-size:10px;font-weight:700;text-transform:uppercase}.meta strong{display:block;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8e1da;padding:8px;text-align:left;vertical-align:top}th{background:#eaf3ec;font-size:11px;text-transform:uppercase}.number{text-align:right}.totals{margin:16px 0 0 auto;width:290px}.totals div{display:flex;justify-content:space-between;padding:7px 0}.grand{border-top:2px solid #17211b;font-size:15px;font-weight:800}.footer-note{margin-top:22px;color:#607064;font-size:11px}@media print{.toolbar{display:none}.sheet{max-width:none;padding:0}}@media(max-width:720px){.sheet{padding:12px}.doc-header,.box-grid{grid-template-columns:1fr}.doc-title{text-align:left}.meta{grid-template-columns:1fr 1fr}th,td{padding:6px;font-size:11px}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div><main class="sheet">
      <header class="doc-header"><div class="brand"><img src="${escapeHtml(logoUrl)}" alt="San Jose Produce"><div><h1>San Jose Produce &amp; Imports LLC</h1><p>6001 S International Pkwy Suite 50<br>McAllen, TX 78503</p></div></div><div class="doc-title"><h2>${escapeHtml(options.title)}</h2><strong>${escapeHtml(order.sales_order_id)}</strong><span>Folio ${escapeHtml(order.bl_folio || "")}</span></div></header>
      <section class="box-grid"><div class="box"><h3>Bill To</h3><div>${escapeHtml(billTo)}</div></div><div class="box"><h3>Ship To</h3><div>${escapeHtml(shipTo)}</div></div></section>
      <section class="meta"><div><span>Order Date</span><strong>${escapeHtml(formatDate(order.order_date))}</strong></div><div><span>Requested</span><strong>${escapeHtml(formatDate(order.ship_by_date))}</strong></div><div><span>Channel</span><strong>${escapeHtml(displayValue(order.channel))}</strong></div><div><span>Status</span><strong>${escapeHtml(order.status || "")}</strong></div></section>
      ${finance ? financeTable(order, lines) : warehouseTable(lines)}
      <p class="footer-note">${finance ? "Finance copy includes prices and totals for billing and QuickBooks support." : "Warehouse copy intentionally hides prices. Scan physical inventory in Send Product before deduction."}</p>
    </main></body></html>`;
}

function financeTable(order, lines) {
  return `<table><thead><tr><th>Line</th><th>Product</th><th>Description</th><th class="number">Qty</th><th class="number">Rate</th><th class="number">Amount</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong><br><small>${escapeHtml(line.product_id)}</small></td><td>${escapeHtml(formatNumber(line.unit_weight_lbs))} LB ${escapeHtml(line.unit_type)} · Lot ${escapeHtml(line.preferred_internal_lot_id || "")}</td><td class="number">${formatNumber(line.qty_ordered)} ${escapeHtml(line.unit_type)}</td><td class="number">${money(line.unit_price)}</td><td class="number">${money(line.line_total)}</td></tr>`).join("")}</tbody></table><section class="totals"><div><span>Subtotal</span><strong>${money(order.subtotal_amount)}</strong></div><div><span>Tax</span><strong>${money(order.tax_amount)}</strong></div><div><span>Shipping</span><strong>${money(order.shipping_amount)}</strong></div><div class="grand"><span>Total</span><strong>${money(order.total_amount)}</strong></div></section>`;
}

function warehouseTable(lines) {
  return `<table><thead><tr><th>Line</th><th>Product</th><th class="number">Qty</th><th>Unit</th><th>Lot</th><th>Space</th><th class="number">Pick Weight</th><th>Status</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(line.product?.product_name || line.product_id)}</strong><br><small>${escapeHtml(line.product_id)}</small></td><td class="number">${formatNumber(line.qty_ordered)}</td><td>${escapeHtml(line.unit_type)} / ${formatNumber(line.unit_weight_lbs)} LB</td><td>${escapeHtml(line.preferred_internal_lot_id || "")}</td><td>${escapeHtml(line.preferred_location_id || "")}</td><td class="number">${formatNumber(line.inventory_qty_required || 0)} ${escapeHtml(line.inventory_unit_type || "LB")}</td><td>${escapeHtml(line.line_status || "")}</td></tr>`).join("")}</tbody></table>`;
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

function updateSalesRemoveButtons(container) {
  const lines = container.querySelectorAll(".sales-line-item");
  lines.forEach((line) => { line.querySelector("[data-remove-sales-line]").disabled = lines.length === 1; });
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

function numericLineValue(line, field) { return Number(line.querySelector(`[data-line-field="${field}"]`)?.value || 0); }
function isActive(record) { return record.is_active === undefined || record.is_active === "" || record.is_active === true || String(record.is_active).toUpperCase() === "TRUE"; }
function isCustomer(record) { return String(record.party_type || "VENDOR").toUpperCase() === "CUSTOMER"; }
function displayValue(value) { return String(value || "").replaceAll("_", " "); }
function todayValue() { return new Date().toISOString().slice(0, 10); }
function formatDate(value) { return value ? String(value).slice(0, 10) : ""; }
function formatNumber(value) { return formatQuantity(value); }
function money(value) { return formatMoney(value); }
