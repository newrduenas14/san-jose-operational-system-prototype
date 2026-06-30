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

        <div class="formula-strip" aria-label="Inventory planning formula summary">
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
        <p class="muted">Shows products with reorder/watch rules, supplier timing, or calculated usage.</p>
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
  const existing = document.getElementById("reportsPageStyles");
  const style = existing || document.createElement("style");
  style.id = "reportsPageStyles";
  style.textContent = `
    .reports-page { display: grid; gap: 16px; }
    .reports-overview { overflow: hidden; padding: 18px; }
    .reports-header { align-items: flex-start; margin-bottom: 12px; }
    .reports-health-pill { background: #eef7f1; border: 1px solid #cfe3d6; border-radius: 999px; color: #17613f; font-size: 12px; font-weight: 850; padding: 7px 11px; white-space: nowrap; }
    .formula-strip { background: #edf3ef; border: 1px solid var(--line); border-radius: 12px; display: grid; gap: 1px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px; overflow: hidden; }
    .formula-strip div { background: #ffffff; min-height: 70px; padding: 12px 14px; }
    .formula-strip span { color: #667568; display: block; font-size: 11px; font-weight: 850; letter-spacing: .04em; text-transform: uppercase; }
    .formula-strip strong { color: #17211b; display: block; font-size: 13px; line-height: 1.32; margin-top: 6px; }
    .report-summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .report-summary-card,
    .card.report-block,
    button.report-block { background: #226b3d !important; border: 1px solid #1f5f37 !important; border-radius: 12px !important; box-shadow: 0 6px 18px rgba(23,33,27,.08) !important; color: #ffffff !important; min-height: 148px; padding: 15px; text-align: left; transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
    .report-summary-card:hover,
    .card.report-block:hover,
    button.report-block:hover { background: #267446 !important; border-color: #1b5231 !important; box-shadow: 0 10px 24px rgba(23,33,27,.12) !important; transform: translateY(-1px); }
    .report-summary-card.selected,
    .card.report-block.selected,
    button.report-block.selected { background: #226b3d !important; border-color: #ffffff !important; box-shadow: inset 0 0 0 2px rgba(255,255,255,.75), 0 10px 24px rgba(23,33,27,.12) !important; color: #ffffff !important; }
    .report-summary-card *,
    .card.report-block *,
    button.report-block * { color: #ffffff !important; }
    .report-summary-card strong,
    .card.report-block strong,
    button.report-block strong { color: #ffffff !important; display: block; font-size: 34px; letter-spacing: -.04em; line-height: 1; margin: 8px 0 11px; }
    .report-summary-card h3,
    .card.report-block span,
    button.report-block span { color: #ffffff !important; font-size: 16px; font-weight: 850; line-height: 1.2; margin: 0 0 6px; }
    .report-summary-card small,
    .card.report-block small,
    button.report-block small,
    .report-card-label,
    .report-summary-card em { color: rgba(255,255,255,.88) !important; }
    .report-summary-card small,
    .card.report-block small,
    button.report-block small { display: block; font-size: 12px; line-height: 1.38; min-height: 33px; }
    .report-summary-card em { display: block; font-size: 12px; font-style: normal; font-weight: 850; margin-top: 12px; }
    .report-card-label { display: block; font-size: 11px; font-weight: 850; letter-spacing: .04em; text-transform: uppercase; }
    .report-detail-panel { min-height: 260px; padding: 18px; }
    .report-detail-heading p { margin: 4px 0 0; }
    .formula-note { background: #f8fbf9; border: 1px solid #d8e1da; border-radius: 10px; color: #607064; font-size: 13px; line-height: 1.45; margin-bottom: 14px; padding: 12px 13px; }
    .formula-note strong { color: #17211b; }
    .report-empty-state { align-items: center; background: #f8fbf9; border: 1px dashed #b9cabe; border-radius: 12px; color: #607064; display: grid; justify-items: center; min-height: 190px; padding: 24px; text-align: center; }
    .report-empty-state strong { color: #17211b; font-size: 18px; }
    .report-empty-state p { max-width: 520px; margin: 8px 0 0; }
    .report-detail-panel .table-tools { align-items: center; background: #ffffff; border: 1px solid #d8e1da; border-radius: 12px; margin: 0 0 12px; padding: 10px; }
    .report-detail-panel .table-filter { min-width: min(320px, 100%); }
    .report-detail-panel table { font-size: 13px; }
    .report-detail-panel th { letter-spacing: .04em; }
    @media (max-width: 1200px) { .report-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .formula-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 700px) {
      .reports-overview, .report-detail-panel { padding: 14px; }
      .reports-header { gap: 8px; }
      .reports-health-pill { white-space: normal; width: fit-content; }
      .report-summary-grid, .formula-strip { grid-template-columns: 1fr; }
      .formula-strip div { min-height: auto; padding: 11px 12px; }
      .report-summary-card { min-height: 122px; padding: 14px; }
      .report-summary-card strong { font-size: 30px; }
      .report-detail-panel .table-tools { align-items: stretch; display: grid; justify-content: stretch; }
      .report-detail-panel .table-tools label { align-items: stretch; display: grid; width: 100%; }
      .report-detail-panel .table-filter { min-width: 0; width: 100%; }
    }
  `;
  if (!existing) document.head.appendChild(style);
}
