import { warmOperationalCache } from "./api-smooth1.js?v=buttons2";
import { getSession, signIn, signOut } from "./auth.js?v=pin1";
import { renderNavigation, renderRoute, configureRouter, navigate } from "./router.js?v=mobilehome1";
import { allowedPages } from "./permissions.js?v=send1";
import { enableTableFilters, enableTableSorting } from "./utils.js?v=buttons1";
import * as dashboard from "../pages/dashboard.js?v=refine1";
import * as products from "../pages/products.js?v=qa1";
import * as suppliers from "../pages/suppliers.js?v=parties3";
import * as orders from "../pages/orders.js?v=orders1";
import * as purchaseOrders from "../pages/purchaseOrders.js?v=qa1";
import * as salesOrders from "../pages/salesOrders.js?v=send1";
import * as sendProduct from "../pages/sendProduct.js?v=send1";
import * as receiving from "../pages/receiving.js?v=refine1";
import * as openingInventory from "../pages/openingInventory.js?v=qa1";
import * as inventory from "../pages/inventory.js?v=qa1";
import * as scanner from "../pages/scannerTest.js?v=parties1";
import * as amazon from "../pages/amazon.js?v=refine1";
import * as reports from "../pages/reports.js?v=refine1";
import * as admin from "../pages/admin.js?v=pin1";
import * as mobileHome from "../pages/mobileHome.js?v=send1";

const view = document.getElementById("view");
const title = document.getElementById("pageTitle");
const subtitle = document.getElementById("pageSubtitle");
let user = getSession();
let renderToken = 0;
let inactivityTimer;
const INACTIVITY_LIMIT_MS = 5 * 60 * 1000;

const routes = {
  mobileHome,
  dashboard,
  products,
  suppliers,
  orders,
  purchaseOrders,
  salesOrders,
  sendProduct,
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
  const [pageId] = String(page || "").split(":");
  if (pageId === "mobileHome" && !usesWarehouseHome()) {
    navigate("dashboard");
    return;
  }
  const allowed = allowedPages(user);
  const allowedIds = allowed.map((item) => item.id);
  const safePage = allowedIds.includes(pageId) ? pageId : allowed[0]?.id || "dashboard";
  if (safePage !== pageId) {
    window.location.hash = safePage;
    return;
  }

  const label = allowed.find((item) => item.id === safePage)?.label || "Page";
  document.body.classList.toggle("mobile-home-mode", safePage === "mobileHome");
  renderNavigation(user);
  title.textContent = label;
  subtitle.textContent = "Loading...";
  view.classList.add("view-loading");
  view.innerHTML = loadingScreen(label);

  try {
    await routes[safePage].render(context());
    if (token !== renderToken) return;
    enableTableFilters(view);
    enableTableSorting(view);
    sortProductSelects(view);
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

function sortProductSelects(root = document) {
  root.querySelectorAll("select[data-product-search], select[data-product-choice]").forEach((select) => {
    const selectedValue = select.value;
    const options = Array.from(select.options);
    const placeholder = options.find((option) => option.value === "") || null;
    const productOptions = options
      .filter((option) => option !== placeholder)
      .sort((a, b) => a.textContent.trim().localeCompare(b.textContent.trim(), undefined, { numeric: true, sensitivity: "base" }));
    select.replaceChildren(...[placeholder, ...productOptions].filter(Boolean));
    select.value = selectedValue;
  });
}

document.getElementById("menuToggle").addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

function usesWarehouseHome() {
  return window.innerWidth <= 900
    || (window.innerWidth <= 1366 && window.matchMedia("(pointer: coarse)").matches);
}

function showApp() {
  document.body.classList.remove("login-mode");
  document.getElementById("loginScreen").hidden = true;
  document.getElementById("app").hidden = false;
  renderSessionIdentity();
  renderNavigation(user);
  renderRoute();
  resetInactivityTimer();
  window.setTimeout(warmOperationalCache, 1000);
}

function resetInactivityTimer() {
  window.clearTimeout(inactivityTimer);
  if (!user) return;
  inactivityTimer = window.setTimeout(() => performSignOut("Signed out after 5 minutes of inactivity."), INACTIVITY_LIMIT_MS);
}

function performSignOut(message = "") {
  window.clearTimeout(inactivityTimer);
  signOut();
  user = null;
  document.body.classList.add("login-mode");
  document.body.classList.remove("menu-open", "mobile-home-mode");
  document.getElementById("app").hidden = true;
  document.getElementById("loginScreen").hidden = false;
  document.getElementById("pinInput").value = "";
  document.getElementById("pinError").textContent = message;
  document.getElementById("pinInput").focus();
}

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

async function completeLogin() {
  try {
    document.getElementById("pinError").textContent = "";
    user = await signIn(document.getElementById("pinInput").value);
    if (usesWarehouseHome()) window.location.hash = "mobileHome";
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
document.getElementById("signOutButton").addEventListener("click", () => performSignOut());

configureRouter(routes, renderAppRoute);
if (user) {
  if (usesWarehouseHome() && !window.location.hash) window.location.hash = "mobileHome";
  showApp();
}
else {
  document.body.classList.add("login-mode");
  document.getElementById("pinInput").focus();
}
