import { getOperationalReports } from "../js/api.js?v=opsreports1";
import { escapeHtml, status, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Reports", "Supplier analytics, inventory planning, and reorder recommendations");
  const reports = await getOperationalReports();
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Inventory Planning Metrics</h2>
            <p class="muted">Calculated in Apps Script from usage, lead time, stock, and velocity class.</p>
          </div>
          <span class="status ok">Updated ${formatDate(reports.calculated_at)}</span>
        </div>
        <div class="cards">
          <div class="card"><span>Reorder Items</span><strong>${countStatus(reports.inventoryPlanning, "REORDER")}</strong></div>
          <div class="card"><span>Watch Items</span><strong>${countStatus(reports.inventoryPlanning, "WATCH")}</strong></div>
          <div class="card"><span>Supplier Rows</span><strong>${reports.supplierAnalytics.length}</strong></div>
          <div class="card"><span>Recommendations</span><strong>${reports.recommendations.length}</strong></div>
        </div>
        ${table([
          { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
          { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
          { label: "Current", key: "current_qty" },
          { label: "Avg Daily Usage", key: "average_daily_usage" },
          { label: "Std Daily Usage", key: "std_daily_usage" },
          { label: "Avg Lead", key: "avg_lead_time_days" },
          { label: "Std Lead", key: "std_lead_time_days" },
          { label: "Demand During Lead", key: "demand_during_lead_time" },
          { label: "Safety Stock", key: "safety_stock" },
          { label: "Reorder Point", key: "reorder_point" },
          { label: "Target Stock", key: "target_stock_level" },
          { label: "Status", render: (row) => status(row.status) }
        ], reports.inventoryPlanning)}
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Supplier Analytics</h2>
            <p class="muted">Lead time, purchase amount, bought products, quality, and quantity accuracy.</p>
          </div>
        </div>
        ${table([
          { label: "Supplier", render: supplierName },
          { label: "Contact", render: (row) => contact(row) },
          { label: "Products Bought", render: (row) => escapeHtml(row.products_bought || "No product history") },
          { label: "Orders", key: "total_orders" },
          { label: "Completed", key: "completed_orders" },
          { label: "Purchase Amount", render: (row) => money(row.total_purchase_amount) },
          { label: "Spend Share", render: (row) => percent(row.spend_share_percent) },
          { label: "Avg Lead", key: "avg_lead_time_days" },
          { label: "Std Lead", key: "std_lead_time_days" },
          { label: "Quality", render: (row) => percent(row.quality_percent) },
          { label: "Product Accuracy", render: (row) => percent(row.product_accuracy_percent) },
          { label: "Qty Accuracy", render: (row) => percent(row.quantity_accuracy_percent) }
        ], reports.supplierAnalytics)}
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Recommendations</h2>
            <p class="muted">Suggested reorder actions from reorder point and target stock formulas.</p>
          </div>
        </div>
        ${table([
          { label: "Action", key: "recommendation_type" },
          { label: "Product", render: (row) => `${escapeHtml(row.product_name)}<br><small>${escapeHtml(row.product_id)}</small>` },
          { label: "Supplier", render: (row) => escapeHtml(row.supplier_name || row.supplier_id || "No supplier history") },
          { label: "Recommended Qty", key: "recommended_qty" },
          { label: "Reorder Point", key: "reorder_point" },
          { label: "Target", key: "target_stock_level" },
          { label: "Confidence", render: (row) => percent(Number(row.confidence_score || 0) * 100) },
          { label: "Reason", key: "reason_text" }
        ], reports.recommendations)}
      </section>

      <section class="panel">
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
          { label: "Qty", render: (row) => escapeHtml(row.current_qty ?? row.qty ?? 0) },
          { label: "Unit", key: "unit_type" },
          { label: "Status", render: (row) => status(row.inventory_status || "AVAILABLE") },
          { label: "Days Since Received", render: (row) => escapeHtml(row.days_since_received ?? "") },
          { label: "Recommended Action", render: (row) => escapeHtml(row.recommended_action || "") }
        ], reports.inventorySnapshot)}
      </section>
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
  return `$${Number(value || 0).toFixed(2)}`;
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "now" : date.toLocaleString();
}
