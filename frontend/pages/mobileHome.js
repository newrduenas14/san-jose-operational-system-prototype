import { allowedPages } from "../js/permissions.js?v=mobilehome1";
import { navigate } from "../js/router.js?v=mobilehome1";

const GROUPS = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    pages: [
      ["dashboard", "Dashboard"],
      ["reports", "Reports"]
    ]
  },
  {
    id: "orders",
    label: "Orders",
    icon: "orders",
    pages: [
      ["purchaseOrders", "Purchase Orders"],
      ["salesOrders", "Sales Orders"]
    ]
  },
  {
    id: "receiving",
    label: "Receiving",
    icon: "receiving",
    pages: [
      ["receiving", "Receive Product"],
      ["openingInventory", "Opening Inventory"]
    ]
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "inventory",
    pages: [
      ["inventory", "Inventory Lookup"],
      ["scanner", "Scanner"],
      ["products", "Products"]
    ]
  },
  {
    id: "shipping",
    label: "Shipping",
    icon: "shipping",
    pages: [["amazon", "Amazon Outbound"]]
  },
  {
    id: "people",
    label: "People & Setup",
    icon: "people",
    pages: [
      ["suppliers", "Customers & Vendors"],
      ["admin", "Users & Locations"]
    ]
  }
];

export async function render(ctx) {
  const allowed = new Set(allowedPages(ctx.user).map((page) => page.id));
  const groups = GROUPS
    .map((group) => ({ ...group, pages: group.pages.filter(([id]) => allowed.has(id)) }))
    .filter((group) => group.pages.length);

  ctx.setTitle("Warehouse Home", "Choose a work area");
  ctx.view.innerHTML = `
    <section class="warehouse-home" aria-label="Warehouse home">
      <header class="warehouse-home-header">
        <div class="warehouse-home-brand">
          <img src="../logo_San_Jose.png" alt="San Jose">
          <div><span>San Jose Operations</span><strong>${escapeHtml(firstName(ctx.user.full_name))}</strong></div>
        </div>
        <button class="warehouse-sign-out" type="button" data-home-sign-out>Sign out</button>
      </header>
      <div class="warehouse-home-grid">
        ${groups.map((group) => `
          <button class="warehouse-home-tile" type="button" data-home-group="${group.id}" aria-expanded="false">
            <span class="warehouse-home-icon">${icon(group.icon)}</span>
            <strong>${group.label}</strong>
            <small>${group.pages.length} ${group.pages.length === 1 ? "action" : "actions"}</small>
          </button>
        `).join("")}
      </div>
      <section class="warehouse-action-panel" data-home-actions hidden aria-live="polite"></section>
    </section>
  `;

  const panel = ctx.view.querySelector("[data-home-actions]");
  ctx.view.querySelectorAll("[data-home-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = groups.find((item) => item.id === button.dataset.homeGroup);
      ctx.view.querySelectorAll("[data-home-group]").forEach((tile) => {
        const active = tile === button && tile.getAttribute("aria-expanded") !== "true";
        tile.classList.toggle("active", active);
        tile.setAttribute("aria-expanded", String(active));
      });

      if (!button.classList.contains("active")) {
        panel.hidden = true;
        panel.innerHTML = "";
        return;
      }

      panel.hidden = false;
      panel.innerHTML = `
        <div class="warehouse-action-heading">
          <span>${group.label}</span>
          <button type="button" data-close-home-actions aria-label="Close ${group.label}">&times;</button>
        </div>
        <div class="warehouse-action-list">
          ${group.pages.map(([id, label]) => `<button type="button" data-home-route="${id}"><span>${label}</span><b aria-hidden="true">&#8594;</b></button>`).join("")}
        </div>
      `;
      panel.querySelector("[data-close-home-actions]").addEventListener("click", () => button.click());
      panel.querySelectorAll("[data-home-route]").forEach((action) => {
        action.addEventListener("click", () => navigate(action.dataset.homeRoute));
      });
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  ctx.view.querySelector("[data-home-sign-out]").addEventListener("click", () => {
    document.getElementById("signOutButton").click();
  });
}

function firstName(value) {
  return String(value || "Team member").trim().split(/\s+/)[0];
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function icon(name) {
  const paths = {
    overview: '<path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"></path><path d="M12 12 16 8"></path><path d="M7.5 16.5h9"></path>',
    orders: '<path d="M9 5h6"></path><path d="M9 3h6v4H9z"></path><path d="M7 5H5v16h14V5h-2"></path><path d="M8 12h8M8 16h6"></path>',
    receiving: '<path d="M4 9 12 4l8 5-8 5-8-5Z"></path><path d="M4 9v6l8 5 8-5V9"></path><path d="M12 8v8"></path><path d="m9 13 3 3 3-3"></path>',
    inventory: '<path d="M3 21V8l9-5 9 5v13"></path><path d="M7 21v-8h10v8"></path><path d="M7 17h10M12 13v8"></path>',
    shipping: '<path d="M3 6h11v11H3z"></path><path d="M14 10h4l3 3v4h-7z"></path><circle cx="7" cy="19" r="2"></circle><circle cx="18" cy="19" r="2"></circle>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]}</svg>`;
}
