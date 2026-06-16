import { getSession, roleOptions, setRole } from "./auth.js";
import { renderNavigation, renderRoute, configureRouter, currentRoute } from "./router.js";
import { allowedPages } from "./permissions.js";
import * as dashboard from "../pages/dashboard.js?v=opsfix1";
import * as products from "../pages/products.js?v=opsfix1";
import * as suppliers from "../pages/suppliers.js?v=opsfix1";
import * as purchaseOrders from "../pages/purchaseOrders.js?v=opsfix1";
import * as receiving from "../pages/receiving.js?v=opsfix1";
import * as inventory from "../pages/inventory.js?v=opsfix1";
import * as scanner from "../pages/scannerTest.js?v=opsfix1";
import * as amazon from "../pages/amazon.js?v=opsfix1";
import * as reports from "../pages/reports.js?v=opsfix1";
import * as admin from "../pages/admin.js?v=opsfix1";

const view = document.getElementById("view");
const title = document.getElementById("pageTitle");
const subtitle = document.getElementById("pageSubtitle");
const roleSelect = document.getElementById("roleSelect");
let user = getSession();

const routes = {
  dashboard,
  products,
  suppliers,
  purchaseOrders,
  receiving,
  inventory,
  scanner,
  amazon,
  reports,
  admin
};

function context() {
  return {
    user,
    view,
    setTitle(nextTitle, nextSubtitle) {
      title.textContent = nextTitle;
      subtitle.textContent = nextSubtitle;
    }
  };
}

function renderRoleSelect() {
  roleSelect.innerHTML = roleOptions().map((role) => `
    <option value="${role}" ${role === user.role ? "selected" : ""}>${role}</option>
  `).join("");
}

async function renderAppRoute(page) {
  const allowed = allowedPages(user);
  const allowedIds = allowed.map((item) => item.id);
  const safePage = allowedIds.includes(page) ? page : allowed[0]?.id || "dashboard";
  if (safePage !== page) {
    window.location.hash = safePage;
    return;
  }
  renderNavigation(user);
  try {
    await routes[safePage].render(context());
  } catch (error) {
    const label = allowed.find((item) => item.id === safePage)?.label || "Page";
    title.textContent = label;
    subtitle.textContent = "Connection issue";
    view.innerHTML = `
      <section class="panel">
        <div class="panel-header"><h2>Could not load this screen</h2></div>
        <p class="muted">${error.message}</p>
        <p class="muted">If you just updated Apps Script, deploy a new Web App version and refresh this page.</p>
      </section>
    `;
  }
  renderNavigation(user);
}

roleSelect.addEventListener("change", async () => {
  user = setRole(roleSelect.value);
  renderRoleSelect();
  renderNavigation(user);
  await renderRoute();
});

document.getElementById("menuToggle").addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

configureRouter(routes, renderAppRoute);
renderRoleSelect();
renderNavigation(user);
renderRoute();
