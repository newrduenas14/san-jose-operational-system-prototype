import { warmOperationalCache } from "./api-smooth1.js?v=inventoryvalue1";
import { getSession, signIn, signOut } from "./auth.js?v=login1";
import { renderNavigation, renderRoute, configureRouter } from "./router.js?v=orders1";
import { allowedPages } from "./permissions.js?v=orders1";
import { enableTableFilters } from "./utils.js?v=filters1";
import * as dashboard from "../pages/dashboard.js?v=refine1";
import * as products from "../pages/products.js?v=refine1";
import * as suppliers from "../pages/suppliers.js?v=parties1";
import * as orders from "../pages/orders.js?v=orders1";
import * as purchaseOrders from "../pages/purchaseOrders.js?v=refine1";
import * as salesOrders from "../pages/salesOrders.js?v=refine1";
import * as receiving from "../pages/receiving.js?v=refine1";
import * as openingInventory from "../pages/openingInventory.js?v=open4";
import * as inventory from "../pages/inventory.js?v=refine1";
import * as scanner from "../pages/scannerTest.js?v=parties1";
import * as amazon from "../pages/amazon.js?v=refine1";
import * as reports from "../pages/reports.js?v=refine1";
import * as admin from "../pages/admin.js?v=team1";

const view = document.getElementById("view");
const title = document.getElementById("pageTitle");
const subtitle = document.getElementById("pageSubtitle");
let user = getSession();
let renderToken = 0;

const routes = {
  dashboard,
  products,
  suppliers,
  orders,
  purchaseOrders,
  salesOrders,
  receiving,
  openingInventory,
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

function renderSessionIdentity() {
  document.getElementById("userAvatar").textContent = String(user.full_name || "A").trim().charAt(0).toUpperCase();
  document.getElementById("currentUserName").textContent = `${user.full_name} · ${user.role}`;
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
    enableTableFilters(view);
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

document.getElementById("menuToggle").addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

function showApp() {
  document.body.classList.remove("login-mode");
  document.getElementById("loginScreen").hidden = true;
  document.getElementById("app").hidden = false;
  renderSessionIdentity();
  renderNavigation(user);
  renderRoute();
  window.setTimeout(warmOperationalCache, 1000);
}

let selectedLoginRole = "";
document.querySelectorAll("[data-login-role]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedLoginRole = button.dataset.loginRole;
    document.getElementById("loginScreen").classList.add("unlocking");
    document.getElementById("loginChoices").hidden = true;
    document.getElementById("pinForm").hidden = false;
    document.getElementById("pinRoleLabel").textContent = `${selectedLoginRole} ACCESS`;
    document.getElementById("pinError").textContent = "";
    document.getElementById("pinInput").focus();
  });
});
document.getElementById("backToRoles").addEventListener("click", () => {
  document.getElementById("loginScreen").classList.remove("unlocking");
  document.getElementById("pinForm").hidden = true;
  document.getElementById("loginChoices").hidden = false;
});
function completeLogin() {
  try {
    user = signIn(selectedLoginRole, document.getElementById("pinInput").value);
    showApp();
  } catch (error) {
    document.getElementById("pinError").textContent = error.message;
    document.getElementById("pinInput").select();
  }
}
window.sjopsCompleteLogin = completeLogin;
document.getElementById("pinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  completeLogin();
});
document.getElementById("signOutButton").addEventListener("click", () => {
  signOut();
  user = null;
  document.getElementById("app").hidden = true;
  document.getElementById("loginScreen").hidden = false;
  document.getElementById("loginScreen").classList.remove("unlocking");
  document.getElementById("pinForm").hidden = true;
  document.getElementById("loginChoices").hidden = false;
});

configureRouter(routes, renderAppRoute);
if (user) showApp();
else document.body.classList.add("login-mode");
