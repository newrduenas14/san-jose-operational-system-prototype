import { warmOperationalCache } from "./api-smooth1.js?v=po-builder1";
import { getSession, roleOptions, setRole } from "./auth.js";
import { renderNavigation, renderRoute, configureRouter } from "./router.js?v=smooth1";
import { allowedPages } from "./permissions.js";
import * as dashboard from "../pages/dashboard.js?v=smooth1";
import * as products from "../pages/products.js?v=productmaster1";
import * as suppliers from "../pages/suppliers.js?v=supplierterms1";
import * as purchaseOrders from "../pages/purchaseOrders.js?v=po-labels2";
import * as receiving from "../pages/receiving.js?v=po-builder1";
import * as inventory from "../pages/inventory.js?v=lotbase2";
import * as scanner from "../pages/scannerTest.js?v=smooth1";
import * as amazon from "../pages/amazon.js?v=smooth1";
import * as reports from "../pages/reports.js?v=smooth1";
import * as admin from "../pages/admin.js?v=smooth1";

const view = document.getElementById("view");
const title = document.getElementById("pageTitle");
const subtitle = document.getElementById("pageSubtitle");
const roleSelect = document.getElementById("roleSelect");
let user = getSession();
let renderToken = 0;

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
  const token = ++renderToken;
  const allowed = allowedPages(user);
  const allowedIds = allowed.map((item) => item.id);
  const safePage = allowedIds.includes(page) ? page : allowed[0]?.id || "dashboard";
  if (safePage !== page) {
    window.location.hash = safePage;
    return;
  }

  const label = allowed.find((item) => item.id === safePage)?.label || "Page";
  renderNavigation(user);
  title.textContent = label;
  subtitle.textContent = "Loading...";
  view.classList.add("view-loading");
  view.innerHTML = loadingScreen(label);

  try {
    await routes[safePage].render(context());
    if (token !== renderToken) return;
    view.classList.remove("view-loading");
  } catch (error) {
    if (token !== renderToken) return;
    title.textContent = label;
    subtitle.textContent = "Connection issue";
    view.classList.remove("view-loading");
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

function loadingScreen(label) {
  return `
    <section class="panel loading-panel">
      <div>
        <h2>${label}</h2>
        <p class="muted">Getting the latest spreadsheet data...</p>
      </div>
      <div class="loading-lines" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </section>
  `;
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
window.setTimeout(warmOperationalCache, 1000);
