import { getOperationalReports } from "../js/api-smooth1.js?v=parties1";
import { enableTableFilters, escapeHtml, formatMoney, formatQuantity, status, table } from "../js/utils.js";

const REPORT_BLOCKS = [
  {
    id: "planning",
    title: "Inventory Planning",
    subtitle: "Reorder point, target stock, and suggested order quantity.",
    metric: "Products needing attention"
  },
  {
    id: "suppliers",
    title: "Supplier Analytics",
    subtitle: "Vendor spend, order count, quality, and contact details.",
    metric: "Suppliers reviewed"
  },
  {
    id: "recommendations",
    title: "Recommendations",
    subtitle: "Simple reorder actions based on current stock.",
    metric: "Suggested actions"
  },
  {
    id: "snapshot",
    title: "Inventory Snapshot",
    subtitle: "Active lots currently in inventory by location.",
    metric: "Active lots"
  }
];

export async function render(ctx) {
  ensureReportStyles();
  ctx.setTitle("Reports", "Inventory planning, supplier analytics, and lot-level stock");
  const reports = await getOperationalReports();
  const initialReport = chooseInitialReport(reports);

  ctx.view.innerHTML = `
    <div class="reports-page">
      <section class="panel reports-overview">
        <div class="panel-header reports-header">
          <div>
            <h2>Reports</h2>
            <p class="muted">Updated ${formatDate(reports.calculated_at)}</p>
          </div>
          <div class="reports-health-pill">${healthSummary(reports)}</div>
        </div>

        <div class="formula-strip">
          <div><span>Current Qty</span><strong>Active lots on hand</strong></div>
          <div><span>Avg Usage</span><strong>90-day shipped sales ÷ 90</strong></div>
          <div><span>Reorder Point</span><strong>Lead-time demand + safety stock</strong></div>
          <div><span>Recommended Qty</span><strong>Target stock − current qty</strong></div>
        </div>

        <div class="report-summary-grid">
          ${REPORT_BLOCKS.map((block) => reportBlockButton(block, reports)).join("")}
        </div>
      </section>
      <section id="reportDetail" class="panel report-detail-panel"></section>
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
  showReport(initialReport);
}

function chooseInitialReport(reports) {
  if (reports.inventoryPlanning.length || reports.recommendations.length) return "planning";
  if (reports.supplierAnalytics.length) return "suppliers";
  return "snapshot";
}

function healthSummary(reports) {
  const reorder = countStatus(reports.inventoryPlanning, "REORDER");
  const watch = countStatus(reports.inventoryPlanning, "WATCH");
  if (reorder) return `${reorder} reorder alert${reorder === 1 ? "" : "s"}`;
  if (watch) return `${watch} watch item${watch === 1 ? "" : "s"}`;
  return "No reorder alerts";
}

function reportBlockButton(block, reports) {
  return `
    <button class="report-summary-card" data-report-block="${block.id}" type="button">
      <span class="report-card-label">${escapeHtml(block.metric)}</span>
      <strong>${reportCount(block.id, reports)}</strong>
      <h3>${escapeHtml(block.title)}</h3>
      <small>${escapeHtml(block.subtitle)}</small>
      <em>Open report</em>
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
  const rows = reports.inventoryPlanning || [];
  return `
    <div class="panel-header report-detail-heading">
      <div>
        <h2>Inventory Planning Metrics</h2>
        <p class="muted">Shows only products with reorder/watch rules or calculated usage.</p>
      </div>
      <div class="actions">
        <span class="status warn">Reorder ${countStatus(rows, "REORDER")}</span>
        <span class="status">Watch ${countStatus(rows, "WATCH")}</span>
      </div>
    </div>
    <div class="formula-note">
      <strong>How this works:</strong>
      Current Qty comes from active lots. Avg Daily Usage is shipped sales from the last 90 days divided by 90. Reorder Point is estimated lead-time demand plus safety stock. Recommended Qty is target stock minus current stock.
    </div>
    ${rows.length ? table([
      { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
      { label: "Current", render: (row) => quantity(row.current_qty) },
      { label: "Avg Daily Usage", render: (row) => quantity(row.average_daily_usage) },
      { label: "Avg Lead", render: (row) => quantity(row.avg_lead_time_days) },
      { label: "Demand During Lead", render: (row) => quantity(row.demand_during_lead_time) },
      { label: "Safety Stock", render: (row) => quantity(row.safety_stock) },
      { label: "Reorder Point", render: (row) => quantity(row.reorder_point) },
      { label: "Target Stock", render: (row) => quantity(row.target_stock_level) },
      { label: "Recommended Qty", render: (row) => quantity(row.recommended_order_qty) },
      { label: "Status", render: (row) => status(row.status) }
    ], rows) : emptyState("No reorder/watch items right now", "Products will show here once they have min stock, target stock, supplier history, or shipped sales usage.")}
  `;
}

function supplierAnalytics(reports) {
  const rows = reports.supplierAnalytics || [];
  return `
    <div class="panel-header report-detail-heading">
      <div>
        <h2>Supplier Analytics</h2>
        <p class="muted">Vendor performance and buying history from purchase orders and receiving.</p>
      </div>
    </div>
    ${rows.length ? table([
      { label: "Supplier", render: supplierName },
      { label: "Contact", render: (row) => contact(row) },
      { label: "Products Bought", render: (row) => escapeHtml(row.products_bought || "No product history") },
      { label: "Orders", render: (row) => quantity(row.total_orders) },
      { label: "Completed", render: (row) => quantity(row.completed_orders) },
      { label: "Purchase Amount", render: (row) => money(row.total_purchase_amount) },
      { label: "Spend Share", render: (row) => percent(row.spend_share_percent) },
      { label: "Avg Lead", render: (row) => quantity(row.avg_lead_time_days) },
      { label: "Quality", render: (row) => percent(row.quality_percent) },
      { label: "Product Accuracy", render: (row) => percent(row.product_accuracy_percent) },
      { label: "Qty Accuracy", render: (row) => percent(row.quantity_accuracy_percent) }
    ], rows) : emptyState("No supplier analytics yet", "Create purchase orders and receiving records to build supplier performance history.")}
  `;
}

function recommendations(reports) {
  const rows = reports.recommendations || [];
  return `
    <div class="panel-header report-detail-heading">
      <div>
        <h2>Recommendations</h2>
        <p class="muted">Suggested purchase actions generated from planning metrics.</p>
      </div>
    </div>
    ${rows.length ? table([
      { label: "Action", key: "recommendation_type" },
      { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
      { label: "Recommended Qty", render: (row) => quantity(row.recommended_qty) },
      { label: "Reorder Point", render: (row) => quantity(row.reorder_point) },
      { label: "Target", render: (row) => quantity(row.target_stock_level) },
      { label: "Confidence", render: (row) => percent(Number(row.confidence_score || 0) * 100) },
      { label: "Reason", key: "reason_text" }
    ], rows) : emptyState("No recommendations right now", "The system will recommend reorder actions when current stock drops below reorder or target levels.")}
  `;
}

function inventorySnapshot(reports) {
  const rows = reports.inventorySnapshot || [];
  return `
    <div class="panel-header report-detail-heading">
      <div>
        <h2>Inventory Snapshot</h2>
        <p class="muted">Active lots currently available by product, lot, and location.</p>
      </div>
      <span class="status ok">${rows.length} active lots</span>
    </div>
    ${rows.length ? table([
      { label: "Product", render: (row) => `${escapeHtml(row.product?.product_name || row.product_name || row.product_id)}<br><small>${escapeHtml(row.product_id)}</small>` },
      { label: "Lot", render: (row) => escapeHtml(row.internal_lot_id || "") },
      { label: "Location", render: (row) => escapeHtml(row.location_id || "") },
      { label: "Qty", render: (row) => quantity(row.current_qty ?? row.qty ?? 0) },
      { label: "Unit", key: "unit_type" },
      { label: "Status", render: (row) => status(row.inventory_status || "AVAILABLE") },
      { label: "Days Since Received", render: (row) => quantity(row.days_since_received ?? "") },
      { label: "Recommended Action", render: (row) => escapeHtml(row.recommended_action || "Use normally") }
    ], rows) : emptyState("No active lots found", "Receive product or add opening inventory to build the stock snapshot.")}
  `;
}

function emptyState(title, body) {
  return `
    <div class="report-empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
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

function ensureReportStyles() {
  if (document.getElementById("reportsPageStyles")) return;
  const style = document.createElement("style");
  style.id = "reportsPageStyles";
  style.textContent = `
    .reports-page { display: grid; gap: 14px; }
    .reports-overview { overflow: hidden; }
    .reports-header { align-items: flex-start; }
    .reports-health-pill { background: #e9f4ed; border: 1px solid #cfe3d6; border-radius: 999px; color: #17613f; font-size: 12px; font-weight: 850; padding: 7px 11px; white-space: nowrap; }
    .formula-strip { background: #f8fbf9; border: 1px solid var(--line); border-radius: 12px; display: grid; gap: 1px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px; overflow: hidden; }
    .formula-strip div { background: white; min-height: 74px; padding: 12px; }
    .formula-strip span { color: var(--muted); display: block; font-size: 11px; font-weight: 850; text-transform: uppercase; }
    .formula-strip strong { color: var(--ink); display: block; font-size: 13px; line-height: 1.3; margin-top: 5px; }
    .report-summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .report-summary-card { background: white; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 6px 18px rgba(23,33,27,.05); color: var(--ink); min-height: 156px; padding: 15px; text-align: left; transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
    .report-summary-card:hover { border-color: #a9c7b4; box-shadow: 0 10px 24px rgba(23,33,27,.09); transform: translateY(-1px); }
    .report-summary-card.selected { background: linear-gradient(180deg, #ffffff 0%, #f3faf5 100%); border-color: var(--primary); box-shadow: inset 0 4px 0 var(--primary), 0 10px 24px rgba(23,33,27,.09); }
    .report-summary-card strong { color: var(--primary); display: block; font-size: 34px; letter-spacing: -.04em; line-height: 1; margin: 8px 0 10px; }
    .report-summary-card h3 { font-size: 15px; margin: 0 0 5px; }
    .report-summary-card small { color: var(--muted); display: block; font-size: 12px; line-height: 1.35; min-height: 33px; }
    .report-summary-card em { color: var(--primary); display: block; font-size: 12px; font-style: normal; font-weight: 850; margin-top: 12px; }
    .report-card-label { color: var(--muted); display: block; font-size: 11px; font-weight: 850; text-transform: uppercase; }
    .report-detail-panel { min-height: 260px; }
    .report-detail-heading p { margin: 4px 0 0; }
    .formula-note { background: #f8fbf9; border: 1px solid var(--line); border-radius: 10px; color: var(--muted); font-size: 13px; line-height: 1.45; margin-bottom: 14px; padding: 12px 13px; }
    .formula-note strong { color: var(--ink); }
    .report-empty-state { align-items: center; background: #f8fbf9; border: 1px dashed #b9cabe; border-radius: 12px; color: var(--muted); display: grid; justify-items: center; min-height: 190px; padding: 24px; text-align: center; }
    .report-empty-state strong { color: var(--ink); font-size: 18px; }
    .report-empty-state p { max-width: 520px; margin: 8px 0 0; }
    @media (max-width: 1100px) { .report-summary-grid, .formula-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 700px) { .report-summary-grid, .formula-strip { grid-template-columns: 1fr; } .reports-health-pill { white-space: normal; } }
  `;
  document.head.appendChild(style);
}
