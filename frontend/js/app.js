import { getSession, roleOptions, setRole } from "./auth.js";
import { renderNavigation, renderRoute, configureRouter, currentRoute } from "./router.js";
import { allowedPages } from "./permissions.js";
import * as dashboard from "../pages/dashboard.js";
import * as products from "../pages/products.js";
import * as suppliers from "../pages/suppliers.js";
import * as purchaseOrders from "../pages/purchaseOrders.js";
import * as receiving from "../pages/receiving.js";
import * as inventory from "../pages/inventory.js";
import * as scanner from "../pages/scannerTest.js";
import * as amazon from "../pages/amazon.js";
import * as reports from "../pages/reports.js";
import * as admin from "../pages/admin.js";

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
  await routes[safePage].render(context());
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
