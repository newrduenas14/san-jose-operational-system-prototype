export const ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  OPERATOR: "OPERATOR"
};

const permissions = {
  ADMIN: [
    "dashboard:view",
    "products:view", "products:create", "products:edit",
    "suppliers:view", "suppliers:create", "suppliers:edit",
    "orders:view",
    "purchaseOrders:view", "purchaseOrders:create", "purchaseOrders:actions",
    "salesOrders:view", "salesOrders:create", "salesOrders:actions",
    "sendProduct:view", "sendProduct:create",
    "receiving:view", "receiving:create",
    "inventory:view", "inventory:adjust",
    "scanner:test",
    "amazon:view",
    "admin:view",
    "reports:view"
  ],
  MANAGER: [
    "dashboard:view",
    "products:view", "products:create", "products:edit",
    "suppliers:view", "suppliers:create", "suppliers:edit",
    "orders:view",
    "purchaseOrders:view", "purchaseOrders:create", "purchaseOrders:actions",
    "salesOrders:view", "salesOrders:create", "salesOrders:actions",
    "sendProduct:view", "sendProduct:create",
    "receiving:view", "receiving:create",
    "inventory:view", "inventory:adjust",
    "scanner:test",
    "amazon:view",
    "reports:view"
  ],
  OPERATOR: [
    "dashboard:view",
    "orders:view", "salesOrders:view", "salesOrders:actions",
    "sendProduct:view", "sendProduct:create",
    "receiving:view", "receiving:create",
    "inventory:view", "inventory:adjust",
    "scanner:test",
    "amazon:view"
  ]
};

export function can(user, permission) {
  if (!user) return false;
  return permissions[user.role]?.includes(permission) || false;
}

export function requirePermission(user, permission) {
  if (!can(user, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

export function allowedPages(user) {
  const pages = [
    { id: "mobileHome", label: "Warehouse Home", permission: "dashboard:view", hidden: true },
    { id: "dashboard", label: "Dashboard", permission: "dashboard:view" },
    { id: "products", label: "Products", permission: "products:view" },
    { id: "suppliers", label: "Customers & Vendors", permission: "suppliers:view" },
    { id: "orders", label: "Orders", permission: "orders:view" },
    { id: "purchaseOrders", label: "Purchase Orders", permission: "purchaseOrders:view", hidden: true },
    { id: "salesOrders", label: "Sales Orders", permission: "salesOrders:view", hidden: true },
    { id: "sendProduct", label: "Send Product", permission: "sendProduct:view" },
    { id: "receiving", label: "Receive Product", permission: "receiving:view" },
    { id: "openingInventory", label: "Opening Inventory", permission: "receiving:view" },
    { id: "inventory", label: "Inventory Lookup", permission: "inventory:view" },
    { id: "scanner", label: "Scanner Test", permission: "scanner:test" },
    { id: "amazon", label: "Amazon Outbound", permission: "amazon:view" },
    { id: "reports", label: "Reports", permission: "reports:view" },
    { id: "admin", label: "Admin", permission: "admin:view" }
  ];

  return pages.filter((page) => can(user, page.permission));
}
