import { getDashboard, resetToSpreadsheetSeed } from "../js/api.js?v=phonefix1";
import { can } from "../js/permissions.js";
import { notice } from "../js/utils.js";

export async function render(ctx) {
  const metrics = await getDashboard();
  ctx.setTitle("Dashboard", "Counts from the spreadsheet seed plus your local additions");
  ctx.view.innerHTML = `
    <div class="grid">
      <div class="cards">
        <div class="card"><span>Products</span><strong>${metrics.productCount}</strong></div>
        <div class="card"><span>Suppliers</span><strong>${metrics.supplierCount}</strong></div>
        <div class="card"><span>Open POs</span><strong>${metrics.openPoCount}</strong></div>
        <div class="card"><span>Lots</span><strong>${metrics.lotCount}</strong></div>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Prototype Database</h2>
            <p class="muted">The app starts from the Excel workbook data, then stores changes in this browser.</p>
          </div>
          ${can(ctx.user, "admin:view") ? `<button id="resetData" class="btn secondary" type="button">Reset to spreadsheet seed</button>` : ""}
        </div>
        <div class="cards">
          <div class="card"><span>Inventory Movements</span><strong>${metrics.movementCount}</strong></div>
          <div class="card"><span>Amazon Packages Pending</span><strong>${metrics.pendingAmazonPackages}</strong></div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("resetData")?.addEventListener("click", async () => {
    await resetToSpreadsheetSeed();
    notice("Local prototype data was reset to the spreadsheet seed.");
    await render(ctx);
  });
}
