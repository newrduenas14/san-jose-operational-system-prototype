export async function render(ctx) {
  ctx.setTitle("Reports", "Placeholders for future Apps Script calculations");
  ctx.view.innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Future Script Outputs</h2></div>
      <p class="muted">Reports will be calculated in Google Apps Script and written to output tabs before the frontend reads them.</p>
      <div class="cards">
        <div class="card"><span>Supplier Analytics</span><strong>Later</strong></div>
        <div class="card"><span>Inventory Snapshot</span><strong>Later</strong></div>
        <div class="card"><span>Recommendations</span><strong>Later</strong></div>
        <div class="card"><span>Dashboard Metrics</span><strong>Later</strong></div>
      </div>
    </section>
  `;
}
