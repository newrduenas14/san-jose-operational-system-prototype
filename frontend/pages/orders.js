import { can } from "../js/permissions.js?v=orders1";

export async function render(ctx) {
  ctx.setTitle("Orders", "Purchasing and customer fulfillment");
  ctx.view.innerHTML = `
    <section class="order-module-grid">
      ${can(ctx.user, "purchaseOrders:view") ? orderModule("purchaseOrders", "Purchase Orders", "Buy inventory from vendors and generate receiving QR labels.") : ""}
      ${can(ctx.user, "salesOrders:view") ? orderModule("salesOrders", "Sales Orders", "Sell available inventory and create FEFO warehouse pick lists.") : ""}
    </section>
  `;

  document.querySelectorAll("[data-order-route]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = button.dataset.orderRoute;
    });
  });
}

function orderModule(route, title, description) {
  return `
    <article class="panel order-module">
      <div>
        <h2>${title}</h2>
        <p class="muted">${description}</p>
      </div>
      <button class="btn" data-order-route="${route}" type="button">Open ${title}</button>
    </article>
  `;
}
