import { getDashboard } from "../js/api-smooth1.js?v=orders1";
import { can } from "../js/permissions.js";
import { escapeHtml, formatMoney, formatQuantity, table } from "../js/utils.js";

export async function render(ctx) {
  const metrics = await getDashboard();
  if (!can(ctx.user, "admin:view")) {
    renderOperationalDashboard(ctx, metrics);
    return;
  }

  ctx.setTitle("Admin Dashboard", "Live inventory, purchasing, and warehouse exceptions");
  ctx.view.innerHTML = `
    <div class="dashboard-layout">
      <section class="dashboard-metrics" aria-label="Administrative quick metrics">
        ${metricCard("Total Inventory Value", money(metrics.totalInventoryValue), "Positive on-hand stock at current lot cost")}
        ${metricCard("Low Stock Products", number(metrics.lowStockCount), `${number(metrics.usageHistoryNeededCount)} still need usage history`, "attention")}
        ${metricCard("Expiring Within 30 Days", number(metrics.expiringLotCount), `${number(metrics.expiringProductCount)} products | ${money(metrics.expiringInventoryValue)} at risk`, "attention")}
        ${metricCard("Open Purchase Orders", number(metrics.openPoCount), `${money(metrics.openPoValue)} currently open`)}
        ${metricCard("Open Sales Orders", number(metrics.openSoCount), `${money(metrics.openSoValue)} currently open`)}
        ${placeholderCard("Accounts Payable", "Requires vendor invoices and payments")}
        ${placeholderCard("Accounts Receivable", "Requires customer invoices and payments")}
        ${metricCard("Weekly Sales", money(metrics.weeklySales), "Shipped Sales Orders from the last 7 days")}
        ${metrics.topProfitProduct
          ? metricCard("Top Product by Gross Profit", metrics.topProfitProduct.product_name, `${money(metrics.topProfitProduct.gross_profit)} profit | ${number(metrics.topProfitProduct.gross_margin_percent)}% margin`)
          : placeholderCard("Top Product by Gross Profit", "No shipped Sales Orders yet")}
        ${capacityCard(metrics)}
      </section>

      <section class="dashboard-exceptions">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Low Stock Exceptions</h2>
              <p class="muted">Demand-based reorder alerts with usage history.</p>
            </div>
          </div>
          ${table([
            { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
            { label: "On Hand", render: (row) => number(row.current_qty) },
            { label: "Daily Use", render: (row) => number(row.average_daily_usage) },
            { label: "Reorder Point", render: (row) => number(row.reorder_point) },
            { label: "Days Cover", render: (row) => `${number(row.days_of_supply)} days` },
            { label: "Order Qty", render: (row) => number(row.recommended_order_qty) }
          ], metrics.lowStockProducts || [])}
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Expiration Risk</h2>
              <p class="muted">Positive inventory expiring within the next 30 days.</p>
            </div>
          </div>
          ${table([
            { label: "Product", render: (row) => escapeHtml(row.product_name) },
            { label: "Lot", render: (row) => escapeHtml(row.internal_lot_id) },
            { label: "On Hand", render: (row) => `${number(row.current_qty)} ${escapeHtml(row.unit_type)}` },
            { label: "Location", render: (row) => escapeHtml(row.location_id) },
            { label: "Expires", render: (row) => escapeHtml(row.expiration_date) },
            { label: "Days", render: (row) => number(row.days_remaining) },
            { label: "Value at Risk", render: (row) => money(row.inventory_value) }
          ], metrics.expiringLots || [])}
        </div>
      </section>
    </div>
  `;
}

function renderOperationalDashboard(ctx, metrics) {
  ctx.setTitle("Dashboard", "Current operational totals");
  ctx.view.innerHTML = `
    <div class="cards">
      ${metricCard("Products", number(metrics.productCount), "Active product catalog")}
      ${metricCard("Customers & Vendors", number(metrics.supplierCount), "Business directory")}
      ${metricCard("Open POs", number(metrics.openPoCount), "Purchase orders requiring completion")}
      ${metricCard("Lots", number(metrics.lotCount), "Tracked inventory lots")}
    </div>
  `;
}

function metricCard(label, value, detail, tone = "") {
  return `
    <article class="dashboard-metric${tone ? ` dashboard-metric--${tone}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function placeholderCard(label, detail) {
  return `
    <article class="dashboard-metric dashboard-metric--placeholder">
      <span>${escapeHtml(label)}</span>
      <strong>--</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function capacityCard(metrics) {
  const percent = Math.max(0, Math.min(100, Number(metrics.warehouseCapacityPercent || 0)));
  return `
    <article class="dashboard-metric dashboard-metric--capacity">
      <span>Warehouse Capacity</span>
      <strong>${escapeHtml(`${number(percent)}%`)}</strong>
      <div class="capacity-bar" aria-label="Warehouse capacity ${escapeHtml(number(percent))} percent">
        <span style="width: ${percent}%"></span>
      </div>
      <small>${escapeHtml(`${number(metrics.warehouseOccupiedPositions)} of ${number(metrics.warehouseTotalPositions)} pallet positions occupied`)}</small>
    </article>
  `;
}

function money(value) {
  return formatMoney(value);
}

function number(value) {
  return formatQuantity(value, { maximumFractionDigits: 1 });
}
