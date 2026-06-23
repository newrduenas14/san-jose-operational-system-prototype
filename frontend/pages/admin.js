import { createUser, listLocations, listUsers, resetToSpreadsheetSeed } from "../js/api-smooth1.js?v=users1";
import { escapeHtml, formToObject, notice, table } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Admin Center", "Manage your team and operational configuration");
  const [locations, users] = await Promise.all([listLocations(), listUsers()]);
  ctx.view.innerHTML = `
    <div class="admin-layout">
      <section class="panel admin-hero">
        <div>
          <span class="eyebrow">TEAM ACCESS</span>
          <h2>Set up the people who run the warehouse.</h2>
          <p class="muted">Add staff before live operations begin. Roles control which screens and actions each person can use.</p>
        </div>
        <div class="admin-hero-stat"><strong>${users.length}</strong><span>active users</span></div>
      </section>
      <div class="admin-workspace">
        <section class="panel">
          <div class="panel-header"><div><h2>Add a user</h2><p class="muted">Start with the name, work email, role, and optional scanner/tablet.</p></div></div>
          <form id="userForm" class="form-grid">
            <div class="field"><label>Full name</label><input name="full_name" required placeholder="Example: Maria Garcia"></div>
            <div class="field"><label>Work email</label><input name="email" type="email" required placeholder="maria@company.com"></div>
            <div class="field"><label>Role</label><select name="role"><option value="OPERATOR">Operator — receiving, inventory, Amazon</option><option value="MANAGER">Manager — operational controls and reports</option><option value="ADMIN">Admin — full access and team setup</option></select></div>
            <div class="field"><label>Assigned device</label><input name="device_assigned" placeholder="Optional: ZEBRA-001"></div>
            <div class="field full"><button class="btn" type="submit">Create user</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>Current team</h2><p class="muted">Choose one of these users from the top-right menu to test their access.</p></div></div>
          ${table([
            { label: "User", render: (row) => `<strong>${escapeHtml(row.full_name)}</strong><br><small>${escapeHtml(row.email || row.user_id)}</small>` },
            { label: "Role", render: (row) => `<span class="role-badge role-${escapeHtml(String(row.role || "").toLowerCase())}">${escapeHtml(row.role)}</span>` },
            { label: "Device", render: (row) => escapeHtml(row.device_assigned || "—") }
          ], users)}
        </section>
      </div>
      <section class="panel admin-secondary">
        <div>
          <h2>Prototype controls</h2>
          <p class="muted">Reset clears browser-only test data and restores the spreadsheet seed.</p>
        </div>
        <button id="resetData" class="btn danger" type="button">Reset local data</button>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Locations from spreadsheet</h2></div>
        ${table([
          { label: "Location", key: "location_id" },
          { label: "Type", key: "location_type" },
          { label: "Status", key: "current_status" },
          { label: "Allowed categories", key: "allowed_categories" },
          { label: "QR", key: "qr_value" }
        ], locations)}
      </section>
    </div>
  `;

  document.getElementById("userForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const newUser = await createUser(ctx.user, formToObject(event.currentTarget));
      notice(`${newUser.full_name} was added. Choose them from the top-right user menu.`);
      await render(ctx);
    } catch (error) {
      notice(error.message);
    }
  });
  document.getElementById("resetData").addEventListener("click", async () => {
    try {
      await resetToSpreadsheetSeed();
      notice("Local data reset to spreadsheet seed.");
    } catch (error) {
      notice(error.message);
    }
  });
}
