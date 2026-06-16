import { allowedPages } from "./permissions.js";

let currentPage = "dashboard";
let routes = {};
let onRoute;

export function configureRouter(routeMap, routeCallback) {
  routes = routeMap;
  onRoute = routeCallback;
  window.addEventListener("hashchange", renderRoute);
}

export function currentRoute() {
  return currentPage;
}

export function navigate(page) {
  const nextHash = `#${page}`;
  if (window.location.hash === nextHash) {
    renderRoute();
    return;
  }
  window.location.hash = page;
}

export function renderNavigation(user) {
  const nav = document.getElementById("nav");
  nav.innerHTML = allowedPages(user).map((page) => `
    <button type="button" data-route="${page.id}" class="${page.id === currentPage ? "active" : ""}">
      ${page.label}
    </button>
  `).join("");
  nav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      document.body.classList.remove("menu-open");
      navigate(button.dataset.route);
    });
  });
}

export async function renderRoute() {
  const requested = window.location.hash.replace("#", "") || "dashboard";
  currentPage = routes[requested] ? requested : "dashboard";
  await onRoute(currentPage);
}
