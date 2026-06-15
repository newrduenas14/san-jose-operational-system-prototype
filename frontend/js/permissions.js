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
    "purchaseOrders:view", "purchaseOrders:create", "purchaseOrders:actions",
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
    "purchaseOrders:view", "purchaseOrders:create", "purchaseOrders:actions",
    "receiving:view", "receiving:create",
    "inventory:view",
    "scanner:test",
    "amazon:view",
    "reports:view"
  ],
  OPERATOR: [
    "dashboard:view",
    "receiving:view", "receiving:create",
    "inventory:view",
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
    { id: "dashboard", label: "Dashboard", permission: "dashboard:view" },
    { id: "products", label: "Products", permission: "products:view" },
    { id: "suppliers", label: "Suppliers", permission: "suppliers:view" },
    { id: "purchaseOrders", label: "Purchase Orders", permission: "purchaseOrders:view" },
    { id: "receiving", label: "Receive Product", permission: "receiving:view" },
    { id: "inventory", label: "Inventory Lookup", permission: "inventory:view" },
    { id: "scanner", label: "Scanner Test", permission: "scanner:test" },
    { id: "amazon", label: "Amazon Match", permission: "amazon:view" },
    { id: "reports", label: "Reports", permission: "reports:view" },
    { id: "admin", label: "Admin", permission: "admin:view" }
  ];

  return pages.filter((page) => can(user, page.permission));
}
