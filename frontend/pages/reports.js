import { getOperationalReports } from "../js/api-smooth1.js?v=parties1";
import { enableTableFilters, escapeHtml, formatMoney, formatQuantity, status, table } from "../js/utils.js";

const REPORT_BLOCKS = [
  {
    id: "planning",
    title: "Inventory Planning Metrics",
    subtitle: "Usage, lead time, safety stock, reorder point, and target stock."
  },
  {
    id: "suppliers",
    title: "Supplier Analytics",
    subtitle: "Products bought, lead time, quality, quantity accuracy, and contact info."
  },
  {
    id: "recommendations",
    title: "Recommendations",
    subtitle: "Suggested reorder actions from the planning formulas."
  },
  {
    id: "snapshot",
    title: "Inventory Snapshot",
    subtitle: "Current stock by product, lot, and location."
  }
];

export async function render(ctx) {
  ctx.setTitle("Reports", "Select one report block to inspect the details");
  const reports = await getOperationalReports();
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Reports</h2>
            <p class="muted">Updated ${formatDate(reports.calculated_at)}</p>
          </div>
        </div>
        <div class="cards">
          ${REPORT_BLOCKS.map((block) => reportBlockButton(block, reports)).join("")}
        </div>
      </section>
      <section id="reportDetail" class="panel"></section>
    </div>
  `;

  const detail = document.getElementById("reportDetail");
  const showReport = (id) => {
    detail.innerHTML = reportDetail(id, reports);
    enableTableFilters(detail);
    document.querySelectorAll("[data-report-block]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.reportBlock === id);
    });
  };

  document.querySelectorAll("[data-report-block]").forEach((button) => {
    button.addEventListener("click", () => showReport(button.dataset.reportBlock));
  });
  showReport("planning");
}

function reportBlockButton(block, reports) {
  return `
    <button class="card report-block" data-report-block="${block.id}" type="button">
      <span>${escapeHtml(block.title)}</span>
      <strong>${reportCount(block.id, reports)}</strong>
      <small>${escapeHtml(block.subtitle)}</small>
    </button>
  `;
}

function reportCount(id, reports) {
  if (id === "planning") return reports.inventoryPlanning.length;
  if (id === "suppliers") return reports.supplierAnalytics.length;
  if (id === "recommendations") return reports.recommendations.length;
  return reports.inventorySnapshot.length;
}

function reportDetail(id, reports) {
  if (id === "suppliers") return supplierAnalytics(reports);
  if (id === "recommendations") return recommendations(reports);
  if (id === "snapshot") return inventorySnapshot(reports);
  return inventoryPlanning(reports);
}

function inventoryPlanning(reports) {
  return `
    <div class="panel-header">
      <div>
        <h2>Inventory Planning Metrics</h2>
        <p class="muted">Calculated from usage history, supplier lead time, current stock, and velocity class.</p>
      </div>
      <div class="actions">
        <span class="status warn">Reorder ${countStatus(reports.inventoryPlanning, "REORDER")}</span>
        <span class="status">Watch ${countStatus(reports.inventoryPlanning, "WATCH")}</span>
      </div>
    </div>
    ${table([
      { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
      { label: "Current", render: (row) => quantity(row.current_qty) },
      { label: "Avg Daily Usage", render: (row) => quantity(row.average_daily_usage) },
      { label: "Std Daily Usage", render: (row) => quantity(row.std_daily_usage) },
      { label: "Avg Lead", render: (row) => quantity(row.avg_lead_time_days) },
      { label: "Std Lead", render: (row) => quantity(row.std_lead_time_days) },
      { label: "Demand During Lead", render: (row) => quantity(row.demand_during_lead_time) },
      { label: "Safety Stock", render: (row) => quantity(row.safety_stock) },
      { label: "Reorder Point", render: (row) => quantity(row.reorder_point) },
      { label: "Target Stock", render: (row) => quantity(row.target_stock_level) },
      { label: "Status", render: (row) => status(row.status) }
    ], reports.inventoryPlanning)}
  `;
}

function supplierAnalytics(reports) {
  return `
    <div class="panel-header">
      <div>
        <h2>Supplier Analytics</h2>
        <p class="muted">Everything useful about each supplier in one place.</p>
      </div>
    </div>
    ${table([
      { label: "Supplier", render: supplierName },
      { label: "Contact", render: (row) => contact(row) },
      { label: "Products Bought", render: (row) => escapeHtml(row.products_bought || "No product history") },
      { label: "Orders", render: (row) => quantity(row.total_orders) },
      { label: "Completed", render: (row) => quantity(row.completed_orders) },
      { label: "Purchase Amount", render: (row) => money(row.total_purchase_amount) },
      { label: "Spend Share", render: (row) => percent(row.spend_share_percent) },
      { label: "Avg Lead", render: (row) => quantity(row.avg_lead_time_days) },
      { label: "Std Lead", render: (row) => quantity(row.std_lead_time_days) },
      { label: "Quality", render: (row) => percent(row.quality_percent) },
      { label: "Product Accuracy", render: (row) => percent(row.product_accuracy_percent) },
      { label: "Qty Accuracy", render: (row) => percent(row.quantity_accuracy_percent) }
    ], reports.supplierAnalytics)}
  `;
}

function recommendations(reports) {
  return `
    <div class="panel-header">
      <div>
        <h2>Recommendations</h2>
        <p class="muted">Suggested actions based on reorder point and target stock.</p>
      </div>
    </div>
    ${table([
      { label: "Action", key: "recommendation_type" },
      { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
      { label: "Recommended Qty", render: (row) => quantity(row.recommended_qty) },
      { label: "Reorder Point", render: (row) => quantity(row.reorder_point) },
      { label: "Target", render: (row) => quantity(row.target_stock_level) },
      { label: "Confidence", render: (row) => percent(Number(row.confidence_score || 0) * 100) },
      { label: "Reason", key: "reason_text" }
    ], reports.recommendations)}
  `;
}

function inventorySnapshot(reports) {
  return `
    <div class="panel-header">
      <div>
        <h2>Inventory Snapshot</h2>
        <p class="muted">Current stock by product, lot, and location with simple FIFO guidance.</p>
      </div>
    </div>
    ${table([
      { label: "Product", render: (row) => `${escapeHtml(row.product?.product_name || row.product_name || row.product_id)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Lot", render: (row) => escapeHtml(row.internal_lot_id || "") },
      { label: "Location", render: (row) => escapeHtml(row.location_id || "") },
      { label: "Qty", render: (row) => quantity(row.current_qty ?? row.qty ?? 0) },
      { label: "Unit", key: "unit_type" },
      { label: "Status", render: (row) => status(row.inventory_status || "AVAILABLE") },
      { label: "Days Since Received", render: (row) => quantity(row.days_since_received ?? "") },
      { label: "Recommended Action", render: (row) => escapeHtml(row.recommended_action || "") }
    ], reports.inventorySnapshot)}
  `;
}

function countStatus(rows, value) {
  return rows.filter((row) => row.status === value).length;
}

function supplierName(row) {
  return `${escapeHtml(row.supplier_name)}<br><small>${escapeHtml(row.supplier_id)}</small>`;
}

function contact(row) {
  const parts = [row.email, row.phone].filter(Boolean);
  return parts.length ? parts.map(escapeHtml).join("<br>") : "No contact";
}

function money(value) {
  return formatMoney(value);
}

function quantity(value) {
  if (value === "" || value === null || value === undefined) return "";
  return formatQuantity(value);
}

function percent(value) {
  return `${formatQuantity(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatDate(value) {
  if (!value) return "now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "now" : date.toLocaleString();
}
