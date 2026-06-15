import { listLocations, resetToSpreadsheetSeed } from "../js/api.js?v=phonefix1";
import { notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Admin", "Configuration and workbook seed inspection");
  const locations = await listLocations();
  ctx.view.innerHTML = `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <h2>Local Prototype Controls</h2>
          <button id="resetData" class="btn danger" type="button">Reset Local Data</button>
        </div>
        <p class="muted">Reset clears anything added in this browser and reloads the spreadsheet seed JSON.</p>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Locations from Spreadsheet</h2></div>
        ${table([
          { label: "Location", key: "location_id" },
          { label: "Type", key: "location_type" },
          { label: "Status", key: "current_status" },
          { label: "Allowed Categories", key: "allowed_categories" },
          { label: "QR", key: "qr_value" }
        ], locations)}
      </section>
    </div>
  `;

  document.getElementById("resetData").addEventListener("click", async () => {
    await resetToSpreadsheetSeed();
    notice("Local data reset to spreadsheet seed.");
  });
}
