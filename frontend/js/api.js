import { requirePermission } from "./permissions.js?v=orders1";
import { numberValue, today, uid } from "./utils.js?v=orders1";
import { GOOGLE_SCRIPT_WEB_APP_URL } from "./config.js?v=opening1";

const DB_KEY = "sjops.database.v1";
const APPS_CACHE_PREFIX = "sjops.apps.cache.";
const APPS_CACHE_TTL_MS = 45000;
const READ_ACTIONS = new Set([
  "getDashboard",
  "listProducts",
  "listUsers",
  "listSuppliers",
  "listLocations",
  "listPurchaseOrders",
  "getPurchaseOrderDetail",
  "listSalesOrders",
  "getSalesOrderDetail",
  "listAmazonOutboundActivity",
  "inventorySnapshot",
  "getOperationalReports"
]);

let dbCache;
const pendingAppsRequests = new Map();

function useAppsScript() {
  return Boolean(GOOGLE_SCRIPT_WEB_APP_URL && GOOGLE_SCRIPT_WEB_APP_URL.includes("/exec"));
}

async function callAppsScript(action, payload = {}) {
  const cacheKey = appsCacheKey(action, payload);
  if (READ_ACTIONS.has(action)) {
    const cached = readAppsCache(cacheKey);
    if (cached) return cached;
    if (pendingAppsRequests.has(cacheKey)) return pendingAppsRequests.get(cacheKey);
  }

  const request = new Promise((resolve, reject) => {
    const callback = `sjopsCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const url = new URL(GOOGLE_SCRIPT_WEB_APP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("payload", JSON.stringify(payload));
    url.searchParams.set("callback", callback);

    const cleanup = () => {
      delete window[callback];
      script.remove();
      pendingAppsRequests.delete(cacheKey);
    };

    window[callback] = (data) => {
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "Apps Script request failed."));
        return;
      }
      if (READ_ACTIONS.has(action)) {
        writeAppsCache(cacheKey, data.result);
      } else {
        clearAppsCache();
      }
      resolve(data.result);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach Apps Script. Check deployment access and version."));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });

  if (READ_ACTIONS.has(action)) {
    pendingAppsRequests.set(cacheKey, request);
  }
  return request;
}

function appsCacheKey(action, payload) {
  return `${APPS_CACHE_PREFIX}${action}:${JSON.stringify(payload || {})}`;
}

function readAppsCache(key) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!cached || Date.now() - cached.savedAt > APPS_CACHE_TTL_MS) return null;
    return cached.value;
  } catch (_error) {
    return null;
  }
}

function writeAppsCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch (_error) {
    // Browsers can disable storage; the app still works without cache.
  }
}

function clearAppsCache() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(APPS_CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch (_error) {
    // Cache clearing is best-effort.
  }
}

export function clearApiCache() {
  clearAppsCache();
}

export function warmOperationalCache() {
  if (!useAppsScript()) return;
  ["getDashboard", "listProducts", "listSuppliers", "listPurchaseOrders", "listSalesOrders", "inventorySnapshot"].forEach((action, index) => {
    window.setTimeout(() => {
      callAppsScript(action).catch(() => {});
    }, index * 350);
  });
}

async function legacyCallAppsScript(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callback = `sjopsCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const url = new URL(GOOGLE_SCRIPT_WEB_APP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("payload", JSON.stringify(payload));
    url.searchParams.set("callback", callback);

    const cleanup = () => {
      delete window[callback];
      script.remove();
    };

    window[callback] = (data) => {
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "Apps Script request failed."));
        return;
      }
      resolve(data.result);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach Apps Script. Check deployment access and version."));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function loadSeed() {
  const res = await fetch("../data/spreadsheetSeed.json");
  if (!res.ok) throw new Error("Could not load spreadsheet seed data.");
  return res.json();
}

async function db() {
  if (dbCache) return dbCache;
  const saved = localStorage.getItem(DB_KEY);
  dbCache = saved ? JSON.parse(saved) : await loadSeed();
  save();
  return dbCache;
}

function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(dbCache));
}

export async function resetToSpreadsheetSeed() {
  if (useAppsScript()) {
    throw new Error("Reset is only available in local prototype mode.");
  }
  dbCache = await loadSeed();
  save();
  return dbCache;
}

export async function getDashboard() {
  if (useAppsScript()) return callAppsScript("getDashboard");
  const data = await db();
  const snapshot = await inventorySnapshot();
  const leadBySupplier = buildLeadTimeStatsBySupplier(data.purchaseOrders);
  const planning = data.products.map((product) => buildProductPlanning(product, data, snapshot, leadBySupplier));
  return {
    productCount: data.products.length,
    supplierCount: data.suppliers.length,
    openPoCount: data.purchaseOrders.filter(isOpenPurchaseOrder).length,
    lotCount: data.lots.length,
    movementCount: data.inventoryMovements.length,
    pendingAmazonPackages: data.amazonPackages.filter((pkg) => !pkg.matched_amazon_order_id).length,
    ...buildDashboardMetrics(data, snapshot, planning)
  };
}

export async function listProducts() {
  if (useAppsScript()) return callAppsScript("listProducts");
  return (await db()).products;
}

export async function listLots() {
  if (useAppsScript()) return callAppsScript("listLots");
  return (await db()).lots;
}

export async function listUsers() {
  if (useAppsScript()) {
    try {
      return await callAppsScript("listUsers");
    } catch (error) {
      if (!String(error.message || "").includes("Unknown action")) throw error;
      return defaultUsers();
    }
  }
  return (await db()).users.filter((user) => user.is_active !== false);
}

export async function createUser(user, input) {
  if (useAppsScript()) {
    try {
      return await callAppsScript("createUser", { user, input });
    } catch (error) {
      if (String(error.message || "").includes("Unknown action")) {
        throw new Error("User creation is ready in the code, but the Google Apps Script must be redeployed first.");
      }
      throw error;
    }
  }
  if (user.role !== "ADMIN") throw new Error("Only an Admin can create users.");
  const data = await db();
  const fullName = String(input.full_name || "").trim();
  const email = String(input.email || "").trim();
  const role = String(input.role || "OPERATOR").toUpperCase();
  if (!fullName) throw new Error("Full name is required.");
  if (!email) throw new Error("Email is required.");
  if (!["ADMIN", "MANAGER", "OPERATOR"].includes(role)) throw new Error("Choose a valid role.");
  if (data.users.some((item) => String(item.email || "").toLowerCase() === email.toLowerCase())) {
    throw new Error("A user with that email already exists.");
  }
  const record = {
    user_id: uid("USR", data.users, "user_id"),
    full_name: fullName,
    email,
    role,
    device_assigned: input.device_assigned || "",
    is_active: true,
    created_at: new Date().toISOString()
  };
  data.users.push(record);
  save();
  return record;
}

function defaultUsers() {
  return [
    { user_id: "ADMIN", full_name: "Admin User", email: "", role: "ADMIN", is_active: true },
    { user_id: "MANAGER", full_name: "Manager User", email: "", role: "MANAGER", is_active: true },
    { user_id: "OPERATOR", full_name: "Warehouse Operator", email: "", role: "OPERATOR", is_active: true }
  ];
}

export async function createProduct(user, input) {
  if (useAppsScript()) return callAppsScript("createProduct", { user, input });
  requirePermission(user, "products:create");
  const data = await db();
  const productName = String(input.product_name || "").trim();
  const productCategory = String(input.product_category || "").trim();
  const perishabilityDays = numberValue(input.perishability_days);
  if (!productName) throw new Error("Product name is required.");
  if (!productCategory) throw new Error("Product category is required.");
  if (perishabilityDays < 0) throw new Error("Perishability days cannot be negative.");
  if (data.products.some((item) => String(item.product_name || "").trim().toLowerCase() === productName.toLowerCase())) {
    throw new Error("A product with this name already exists.");
  }
  const product = {
    product_id: input.product_id || uid("PROD", data.products, "product_id"),
    product_name: productName,
    product_category: productCategory,
    default_unit: "",
    base_unit: "LB",
    amount_per_purchase_unit: 0,
    units_per_purchase_unit: 0,
    can_break_case: "",
    case_weight_lbs: 0,
    perishability_days: perishabilityDays,
    amazon_sku: "",
    wholesale_sku: "",
    barcode_or_qr_value: input.product_id || "",
    min_stock_qty: 0,
    target_stock_qty: 0,
    velocity_class: "",
    storage_zone_preference: "",
    is_active: true,
    notes: ""
  };
  if (data.products.some((item) => item.product_id === product.product_id)) {
    throw new Error("Product ID already exists.");
  }
  if (!product.barcode_or_qr_value) product.barcode_or_qr_value = product.product_id;
  data.products.push(product);
  save();
  return product;
}

export async function createOpeningInventory(user, input) {
  if (useAppsScript()) return callAppsScript("createOpeningInventory", { user, input });
  requirePermission(user, "receiving:create");
  const data = await db();
  const name = String(input.product_name || "").trim();
  const qty = numberValue(input.qty);
  const weight = numberValue(input.purchase_unit_weight);
  const location = data.locations.find((item) => item.location_id === input.location_id);
  if (!name || qty <= 0 || weight <= 0 || !location) throw new Error("Complete product, quantity, weight, and inventory space.");
  if (String(location.current_status || "AVAILABLE").toUpperCase() !== "AVAILABLE") throw new Error("Choose an available inventory space.");
  let product = data.products.find((item) => item.product_name.toLowerCase() === name.toLowerCase());
  if (!product) {
    product = { product_id: uid("PROD", data.products, "product_id"), product_name: name, product_category: input.product_category || "General", base_unit: "LB", perishability_days: numberValue(input.perishability_days), barcode_or_qr_value: "", is_active: true };
    product.barcode_or_qr_value = product.product_id;
    data.products.push(product);
  }
  const lot = { internal_lot_id: uid("LOT", data.lots, "internal_lot_id"), product_id: product.product_id, supplier_lot_number: input.supplier_lot_number || "OPENING", original_qty: qty * weight, current_qty_script: qty * weight, unit_type: "LB", purchase_qty_received: qty, purchase_unit_type: input.purchase_unit, current_location_id: location.location_id, status: "ACTIVE", received_date: today(), qr_value: "", notes: "Opening inventory count." };
  lot.qr_value = lot.internal_lot_id;
  const movement = { movement_id: uid("MOV", data.inventoryMovements, "movement_id"), movement_type: "OPENING_INVENTORY", timestamp: new Date().toISOString(), user_id: user.user_id, product_id: product.product_id, internal_lot_id: lot.internal_lot_id, qty_change: lot.original_qty, unit_type: "LB", from_location_id: "OPENING_COUNT", to_location_id: location.location_id, scan_code: lot.internal_lot_id, device_id: "WEB", approval_status: "APPROVED", notes: input.notes || "" };
  location.current_status = "UNAVAILABLE";
  data.lots.push(lot); data.inventoryMovements.push(movement); save(); return { product, lot, movement };
}

export async function updateProductStatus(user, productId, isActive) {
  if (useAppsScript()) return callAppsScript("updateProductStatus", { user, productId, isActive });
  requirePermission(user, "products:edit");
  const data = await db();
  const product = data.products.find((item) => item.product_id === productId);
  if (!product) throw new Error("Product not found.");
  product.is_active = Boolean(isActive);
  product.updated_at = new Date().toISOString();
  save();
  return product;
}

export async function listSuppliers() {
  if (useAppsScript()) return callAppsScript("listSuppliers");
  const data = await db();
  return data.suppliers.map((supplier) => ({
    ...supplier,
    party_type: normalizePartyType(supplier.party_type),
    lead_time_expected_days: normalizePartyType(supplier.party_type) === "VENDOR"
      ? calculateSupplierLeadTime(supplier.supplier_id, data)
      : ""
  }));
}

export async function createSupplier(user, input) {
  if (useAppsScript()) return callAppsScript("createSupplier", { user, input });
  requirePermission(user, "suppliers:create");
  const data = await db();
  const partyType = normalizePartyType(input.party_type);
  const supplierId = input.supplier_id || uid(partyType === "CUSTOMER" ? "CUST" : "SUP", data.suppliers, "supplier_id");
  const supplier = {
    supplier_id: supplierId,
    party_type: partyType,
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: partyType === "VENDOR" ? calculateSupplierLeadTime(supplierId, data) : "",
    is_active: true,
    notes: input.notes || ""
  };
  if (!supplier.supplier_name) throw new Error("Business name is required.");
  if (data.suppliers.some((item) => item.supplier_id === supplier.supplier_id)) {
    throw new Error("Business record ID already exists.");
  }
  data.suppliers.push(supplier);
  save();
  return supplier;
}

export async function listLocations() {
  if (useAppsScript()) return callAppsScript("listLocations");
  return (await db()).locations;
}

export async function listPurchaseOrders() {
  if (useAppsScript()) return callAppsScript("listPurchaseOrders");
  const data = await db();
  return data.purchaseOrders.map((po) => ({
    ...po,
    supplier: data.suppliers.find((s) => s.supplier_id === po.supplier_id),
    line_count: data.purchaseOrderLines.filter((line) => line.po_id === po.po_id).length
  }));
}

export async function getPurchaseOrderDetail(poId) {
  if (useAppsScript()) return callAppsScript("getPurchaseOrderDetail", { poId });
  const data = await db();
  const po = data.purchaseOrders.find((item) => item.po_id === poId);
  if (!po) return null;
  const lines = data.purchaseOrderLines
    .filter((line) => line.po_id === poId)
    .map((line) => ({
      ...line,
      product: data.products.find((product) => product.product_id === line.product_id)
    }));
  return {
    po: {
      ...po,
      supplier: data.suppliers.find((supplier) => supplier.supplier_id === po.supplier_id)
    },
    lines
  };
}

export async function generatePurchaseOrderTemplate(poId) {
  if (useAppsScript()) return callAppsScript("generatePurchaseOrderTemplate", { poId });
  const detail = await getPurchaseOrderDetail(poId);
  if (!detail) throw new Error("Purchase order not found.");
  return buildPurchaseOrderTemplate(detail);
}

export async function createPurchaseOrder(user, input) {
  if (useAppsScript()) return callAppsScript("createPurchaseOrder", { user, input });
  requirePermission(user, "purchaseOrders:create");
  const data = await db();
  const supplier = data.suppliers.find((item) => item.supplier_id === input.supplier_id);
  if (!supplier || normalizePartyType(supplier.party_type) !== "VENDOR") {
    throw new Error("Select a valid vendor.");
  }
  const inputLines = Array.isArray(input.lines) ? input.lines : [input];
  if (!inputLines.length) throw new Error("Add at least one product.");
  const validatedLines = inputLines.map((item, index) => validatePurchaseOrderLine(item, index, data.products));
  const subtotal = round(validatedLines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0), 2);
  const taxEnabled = input.tax_enabled === true || String(input.tax_enabled).toUpperCase() === "TRUE";
  const taxRate = taxEnabled ? Math.max(0, numberValue(input.tax_rate_percent, 6.25) / 100) : 0;
  const taxAmount = round(subtotal * taxRate, 2);
  const orderDate = input.order_date || today();
  const expectedDeliveryDate = input.expected_delivery_date
    || addDays(orderDate, calculateSupplierLeadTime(input.supplier_id, data));
  const po = {
    po_id: uid("PO", data.purchaseOrders, "po_id"),
    po_status: "DRAFT",
    supplier_id: input.supplier_id,
    created_by: user.user_id,
    order_date: orderDate,
    expected_delivery_date: expectedDeliveryDate,
    actual_first_received_date: "",
    actual_completed_date: "",
    payment_terms: supplier.payment_terms || "Net 30",
    currency: supplier.default_currency || "USD",
    subtotal_amount: subtotal,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    shipping_amount: 0,
    ship_via: input.ship_via || "SUPPLIER_DELIVERY",
    total_amount: round(subtotal + taxAmount, 2),
    email_status: "NOT_SENT",
    printed_status: "NOT_PRINTED",
    supplier_confirmation_status: "PENDING",
    notes: input.notes || ""
  };
  const idRecords = [...data.purchaseOrderLines];
  const lines = validatedLines.map((item) => {
    const product = data.products.find((record) => record.product_id === item.product_id);
    const poLineId = uid("POL", idRecords, "po_line_id");
    idRecords.push({ po_line_id: poLineId });
    const line = {
      po_line_id: poLineId,
      po_id: po.po_id,
      supplier_id: input.supplier_id,
      product_id: item.product_id,
      line_status: "ORDERED",
      qty_ordered: item.qty_ordered,
      qty_received_total: 0,
      qty_remaining: item.qty_ordered,
      unit_type: item.unit_type,
      base_unit: "LB",
      units_per_purchase_unit: item.case_weight_lbs,
      expected_base_qty: round(item.qty_ordered * item.case_weight_lbs, 2),
      case_weight_lbs: item.case_weight_lbs,
      unit_cost: item.unit_cost,
      currency: po.currency,
      line_total: round(item.qty_ordered * item.unit_cost, 2),
      supplier_expected_lot_number: item.supplier_expected_lot_number,
      notes: ""
    };
    line.qr_value = purchaseOrderQrValue({
      poId: po.po_id,
      poLineId,
      productId: item.product_id,
      productName: product.product_name,
      qty: item.qty_ordered,
      supplierLotNumber: item.supplier_expected_lot_number
    });
    return line;
  });
  data.purchaseOrders.push(po);
  data.purchaseOrderLines.push(...lines);
  save();
  return { ...po, lines };
}

function validatePurchaseOrderLine(item, index, products) {
  const product = products.find((record) => record.product_id === item.product_id);
  const lineNumber = index + 1;
  const qty = numberValue(item.qty_ordered);
  const unitCost = numberValue(item.unit_cost);
  const unitWeight = numberValue(item.case_weight_lbs || item.units_per_purchase_unit);
  const unitType = String(item.unit_type || "").trim().toUpperCase();
  if (!product) throw new Error(`Select a valid product on line ${lineNumber}.`);
  if (qty <= 0) throw new Error(`Quantity must be greater than zero on line ${lineNumber}.`);
  if (!unitType) throw new Error(`Purchase unit is required on line ${lineNumber}.`);
  if (unitWeight <= 0) throw new Error(`Unit weight must be greater than zero on line ${lineNumber}.`);
  if (unitCost < 0) throw new Error(`Unit cost cannot be negative on line ${lineNumber}.`);
  return {
    product_id: product.product_id,
    qty_ordered: qty,
    unit_type: unitType,
    case_weight_lbs: unitWeight,
    unit_cost: unitCost,
    supplier_expected_lot_number: String(item.supplier_expected_lot_number || "").trim()
  };
}

export async function purchaseOrderAction(user, poId, action) {
  if (useAppsScript()) return callAppsScript("purchaseOrderAction", { user, poId, action });
  requirePermission(user, "purchaseOrders:actions");
  const data = await db();
  const po = data.purchaseOrders.find((item) => item.po_id === poId);
  if (!po) throw new Error("PO not found.");
  if (action === "markSent") {
    po.email_status = "SENT";
    po.po_status = "SENT";
  }
  save();
  return po;
}

export async function listSalesOrders() {
  if (useAppsScript()) return callAppsScript("listSalesOrders");
  const data = await db();
  const salesOrders = data.salesOrders || [];
  const salesOrderLines = data.salesOrderLines || [];
  return salesOrders.map((order) => {
    const lines = salesOrderLines.filter((line) => line.sales_order_id === order.sales_order_id);
    return {
      ...order,
      customer: data.suppliers.find((party) => party.supplier_id === order.customer_id) || null,
      line_count: lines.length,
      product_names: unique(lines.map((line) => data.products.find((product) => product.product_id === line.product_id)?.product_name || line.product_id)).join(", ")
    };
  }).sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || "")));
}

export async function getSalesOrderDetail(salesOrderId) {
  if (useAppsScript()) return callAppsScript("getSalesOrderDetail", { salesOrderId });
  const data = await db();
  const order = (data.salesOrders || []).find((item) => item.sales_order_id === salesOrderId);
  if (!order) return null;
  const lines = (data.salesOrderLines || [])
    .filter((line) => line.sales_order_id === salesOrderId)
    .map((line) => ({
      ...line,
      product: data.products.find((product) => product.product_id === line.product_id) || null,
      lot: data.lots.find((lot) => lot.internal_lot_id === line.preferred_internal_lot_id) || null,
      location: data.locations.find((location) => location.location_id === line.preferred_location_id) || null
    }));
  return {
    order: {
      ...order,
      customer: data.suppliers.find((party) => party.supplier_id === order.customer_id) || null
    },
    lines,
    pickTasks: (data.pickTasks || []).filter((task) => task.sales_order_id === salesOrderId)
  };
}

export async function createSalesOrder(user, input) {
  if (useAppsScript()) return callAppsScript("createSalesOrder", { user, input });
  requirePermission(user, "salesOrders:create");
  const data = await db();
  data.salesOrders ||= [];
  data.salesOrderLines ||= [];
  data.pickTasks ||= [];

  const customer = data.suppliers.find((party) => party.supplier_id === input.customer_id);
  if (!customer || normalizePartyType(customer.party_type) !== "CUSTOMER") {
    throw new Error("Select a valid customer.");
  }
  const shippingAddress = String(input.shipping_address || customer.address || "").trim();
  if (!shippingAddress) throw new Error("Ship To Address is required.");
  const inputLines = Array.isArray(input.lines) ? input.lines : [];
  if (!inputLines.length) throw new Error("Add at least one inventory item.");
  const snapshot = await inventorySnapshot();
  const allocatedByInventory = new Map();
  const validatedLines = inputLines.map((line, index) =>
    validateSalesOrderLine(line, index, data, snapshot, allocatedByInventory, input.requested_delivery_date)
  );
  const subtotal = round(validatedLines.reduce((sum, line) => sum + line.line_total, 0), 2);
  const estimatedGrossProfit = round(validatedLines.reduce((sum, line) => sum + line.estimated_gross_profit, 0), 2);
  const taxEnabled = input.tax_enabled === true || String(input.tax_enabled).toUpperCase() === "TRUE";
  const taxRate = taxEnabled ? Math.max(0, numberValue(input.tax_rate_percent, 6.25) / 100) : 0;
  const taxAmount = round(subtotal * taxRate, 2);
  const salesOrderId = uid("SO", data.salesOrders, "sales_order_id");
  const blFolio = nextBlFolio(data.salesOrders);
  const order = {
    sales_order_id: salesOrderId,
    bl_folio: blFolio,
    channel: String(input.sales_channel || "OTHER").toUpperCase(),
    order_source: "MANUAL",
    customer_id: customer.supplier_id,
    customer_name: customer.supplier_name,
    customer_email: customer.email || "",
    customer_phone: customer.phone || "",
    order_date: input.order_date || today(),
    ship_by_date: input.requested_delivery_date || "",
    ship_method: String(input.ship_method || "OTHER").toUpperCase(),
    shipping_address: shippingAddress,
    payment_terms: input.payment_terms || customer.payment_terms || "Net 30",
    status: "DRAFT",
    currency: customer.default_currency || "USD",
    subtotal_amount: subtotal,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    shipping_amount: 0,
    total_amount: round(subtotal + taxAmount, 2),
    estimated_gross_profit: estimatedGrossProfit,
    estimated_gross_margin_percent: subtotal > 0 ? round(estimatedGrossProfit / subtotal * 100, 2) : 0,
    invoice_status: "NOT_INVOICED",
    created_by: user.user_id || user.role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: input.notes || ""
  };
  const lineIds = [...data.salesOrderLines];
  const lines = validatedLines.map((line) => {
    const salesOrderLineId = uid("SOL", lineIds, "sales_order_line_id");
    lineIds.push({ sales_order_line_id: salesOrderLineId });
    return {
      sales_order_line_id: salesOrderLineId,
      sales_order_id: salesOrderId,
      channel: order.channel,
      product_id: line.product_id,
      qty_ordered: line.qty_ordered,
      qty_picked: 0,
      qty_remaining: line.qty_ordered,
      unit_type: line.unit_type,
      unit_weight_lbs: line.unit_weight_lbs,
      inventory_qty_required: line.inventory_qty_required,
      inventory_unit_type: line.inventory_unit_type,
      unit_price: line.unit_price,
      unit_cost: line.unit_cost,
      currency: order.currency,
      line_total: line.line_total,
      estimated_gross_profit: line.estimated_gross_profit,
      preferred_internal_lot_id: line.internal_lot_id,
      preferred_location_id: line.location_id,
      expiration_date: line.expiration_date,
      fefo_status: line.fefo_status,
      line_status: "DRAFT",
      notes: line.notes
    };
  });
  data.salesOrders.push(order);
  data.salesOrderLines.push(...lines);
  save();
  return { ...order, lines };
}

function nextBlFolio(salesOrders) {
  return salesOrders.reduce((max, order) => Math.max(max, Number(order.bl_folio) || 0), 2719) + 1;
}

export async function salesOrderAction(user, salesOrderId, action) {
  if (useAppsScript()) return callAppsScript("salesOrderAction", { user, salesOrderId, action });
  requirePermission(user, "salesOrders:actions");
  const data = await db();
  data.pickTasks ||= [];
  const order = (data.salesOrders || []).find((item) => item.sales_order_id === salesOrderId);
  if (!order) throw new Error("Sales order not found.");
  const lines = (data.salesOrderLines || []).filter((line) => line.sales_order_id === salesOrderId);
  const normalizedAction = String(action || "").toUpperCase();
  enforceSalesOrderActionRole(user, normalizedAction);

  if (normalizedAction === "CONFIRM") {
    if (order.status !== "DRAFT") throw new Error("Only draft Sales Orders can be confirmed.");
    const snapshot = await inventorySnapshot();
    const requestedByInventory = new Map();
    lines.forEach((line, index) => validateExistingSalesAllocation(line, index, snapshot, requestedByInventory));
    const taskIds = [...data.pickTasks];
    lines.forEach((line) => {
      const taskId = uid("PICK", taskIds, "pick_task_id");
      taskIds.push({ pick_task_id: taskId });
      data.pickTasks.push({
        pick_task_id: taskId,
        sales_order_id: salesOrderId,
        sales_order_line_id: line.sales_order_line_id,
        channel: order.channel,
        task_date: today(),
        priority: "NORMAL",
        product_id: line.product_id,
        recommended_internal_lot_id: line.preferred_internal_lot_id,
        recommended_location_id: line.preferred_location_id,
        qty_to_pick: line.qty_ordered,
        qty_to_pick_base: line.inventory_qty_required,
        qty_picked: 0,
        unit_type: line.unit_type,
        assigned_to: "",
        pick_status: "OPEN",
        reservation_status: "RESERVED",
        notes: line.fefo_status === "RECOMMENDED" ? "FEFO allocation." : "Manual lot allocation."
      });
      line.line_status = "CONFIRMED";
    });
    order.status = "CONFIRMED";
    order.confirmed_at = new Date().toISOString();
  } else if (normalizedAction === "PICKED") {
    if (order.status !== "CONFIRMED") throw new Error("Only confirmed Sales Orders can be marked picked.");
    lines.forEach((line) => {
      line.line_status = "PICKED";
      line.qty_picked = line.qty_ordered;
      line.qty_remaining = 0;
    });
    data.pickTasks.filter((task) => task.sales_order_id === salesOrderId).forEach((task) => {
      task.pick_status = "PICKED";
      task.qty_picked = task.qty_to_pick;
      task.picked_at = new Date().toISOString();
    });
    order.status = "PICKED";
    order.picked_at = new Date().toISOString();
  } else if (normalizedAction === "SHIPPED") {
    if (order.status !== "PICKED") throw new Error("Only picked Sales Orders can be marked shipped.");
    data.pickTasks.filter((task) => task.sales_order_id === salesOrderId).forEach((task) => {
      task.pick_status = "SHIPPED";
    });
    order.status = "SHIPPED";
    order.shipped_at = new Date().toISOString();
  } else {
    throw new Error("Unknown Sales Order action.");
  }
  order.updated_at = new Date().toISOString();
  save();
  return { ...order, lines, pickTasks: data.pickTasks.filter((task) => task.sales_order_id === salesOrderId) };
}

function validateSalesOrderLine(input, index, data, snapshot, allocatedByInventory, requestedDeliveryDate) {
  const lineNumber = index + 1;
  const product = data.products.find((item) => item.product_id === input.product_id);
  const lot = data.lots.find((item) => item.internal_lot_id === input.internal_lot_id);
  const inventoryRow = snapshot.find((row) =>
    row.product_id === input.product_id
    && row.internal_lot_id === input.internal_lot_id
    && row.location_id === input.location_id
  );
  if (!product || !lot || !inventoryRow) throw new Error(`Select valid inventory on line ${lineNumber}.`);
  if (!["ACTIVE", "AVAILABLE"].includes(String(lot.status || "ACTIVE").toUpperCase())) {
    throw new Error(`The selected lot is not sellable on line ${lineNumber}.`);
  }

  const expiration = effectiveExpirationDate(lot, product);
  const todayDate = startOfDay(new Date());
  if (expiration && expiration < todayDate) throw new Error(`The selected lot is expired on line ${lineNumber}.`);
  const requestedDate = startOfDay(requestedDeliveryDate);
  if (expiration && requestedDate && expiration < requestedDate) {
    throw new Error(`The selected lot expires before the requested delivery date on line ${lineNumber}.`);
  }

  const qtyOrdered = numberValue(input.qty_ordered);
  const salesUnit = String(input.unit_type || "").trim().toUpperCase();
  const unitWeight = numberValue(input.unit_weight_lbs, salesUnit === "LB" ? 1 : 0);
  const unitPrice = numberValue(input.unit_price);
  const inventoryUnit = String(inventoryRow.unit_type || lot.unit_type || "").toUpperCase();
  if (qtyOrdered <= 0) throw new Error(`Quantity sold must be greater than zero on line ${lineNumber}.`);
  if (!salesUnit) throw new Error(`Sales unit is required on line ${lineNumber}.`);
  if (unitWeight <= 0) throw new Error(`Unit weight must be greater than zero on line ${lineNumber}.`);
  if (unitPrice < 0) throw new Error(`Unit price cannot be negative on line ${lineNumber}.`);
  if (inventoryUnit !== salesUnit && inventoryUnit !== "LB") {
    throw new Error(`The selected inventory cannot be converted from ${inventoryUnit} to ${salesUnit} on line ${lineNumber}.`);
  }

  const inventoryQtyRequired = round(inventoryUnit === salesUnit ? qtyOrdered : qtyOrdered * unitWeight, 2);
  const inventoryKey = salesInventoryKey(input.product_id, input.internal_lot_id, input.location_id);
  const alreadyAllocated = allocatedByInventory.get(inventoryKey) || 0;
  const availableQty = numberValue(inventoryRow.available_qty, inventoryRow.qty);
  if (alreadyAllocated + inventoryQtyRequired > availableQty + 0.0001) {
    throw new Error(`Line ${lineNumber} exceeds the available quantity for this lot and location.`);
  }
  allocatedByInventory.set(inventoryKey, alreadyAllocated + inventoryQtyRequired);

  const inventoryUnitCost = dashboardUnitCost(lot, data.purchaseOrderLines);
  const unitCost = round(inventoryUnitCost * inventoryQtyRequired / qtyOrdered, 4);
  const lineTotal = round(qtyOrdered * unitPrice, 2);
  const estimatedGrossProfit = round(qtyOrdered * (unitPrice - unitCost), 2);
  return {
    product_id: product.product_id,
    internal_lot_id: lot.internal_lot_id,
    location_id: input.location_id,
    qty_ordered: qtyOrdered,
    unit_type: salesUnit,
    unit_weight_lbs: unitWeight,
    inventory_qty_required: inventoryQtyRequired,
    inventory_unit_type: inventoryUnit,
    unit_price: unitPrice,
    unit_cost: unitCost,
    line_total: lineTotal,
    estimated_gross_profit: estimatedGrossProfit,
    expiration_date: expiration ? dateKey(expiration) : "",
    fefo_status: isFefoChoice(inventoryRow, snapshot, data, unitWeight) ? "RECOMMENDED" : "OVERRIDE",
    notes: String(input.notes || "")
  };
}

function validateExistingSalesAllocation(line, index, snapshot, requestedByInventory) {
  const inventoryRow = snapshot.find((row) =>
    row.product_id === line.product_id
    && row.internal_lot_id === line.preferred_internal_lot_id
    && row.location_id === line.preferred_location_id
  );
  if (!inventoryRow) throw new Error(`Inventory allocation is missing on line ${index + 1}.`);
  const key = salesInventoryKey(line.product_id, line.preferred_internal_lot_id, line.preferred_location_id);
  const requested = numberValue(line.inventory_qty_required, line.qty_ordered);
  const combined = (requestedByInventory.get(key) || 0) + requested;
  if (combined > numberValue(inventoryRow.available_qty, inventoryRow.qty) + 0.0001) {
    throw new Error(`Inventory is no longer available for line ${index + 1}. Choose another lot or quantity.`);
  }
  requestedByInventory.set(key, combined);
}

function isFefoChoice(selectedRow, snapshot, data, unitWeight) {
  const selectedLot = data.lots.find((lot) => lot.internal_lot_id === selectedRow.internal_lot_id) || {};
  const selectedProduct = data.products.find((product) => product.product_id === selectedRow.product_id) || {};
  const selectedExpiration = effectiveExpirationDate(selectedLot, selectedProduct);
  const candidates = snapshot.filter((row) => {
    if (row.product_id !== selectedRow.product_id || numberValue(row.available_qty, row.qty) <= 0) return false;
    const lot = data.lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    if (!["ACTIVE", "AVAILABLE"].includes(String(lot.status || "ACTIVE").toUpperCase())) return false;
    return Math.abs(salesLotUnitWeight(lot) - unitWeight) < 0.001;
  });
  const earliest = candidates.map((row) => {
    const lot = data.lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    return effectiveExpirationDate(lot, selectedProduct);
  }).filter(Boolean).sort((a, b) => a - b)[0];
  return !earliest || (selectedExpiration && selectedExpiration.getTime() === earliest.getTime());
}

function salesLotUnitWeight(lot) {
  const originalQty = numberValue(lot.original_qty);
  const purchaseQty = numberValue(lot.purchase_qty_received);
  return originalQty > 0 && purchaseQty > 0 ? round(originalQty / purchaseQty, 4) : 1;
}

function salesInventoryKey(productId, lotId, locationId) {
  return `${productId}|${lotId}|${locationId}`;
}

function enforceSalesOrderActionRole(user, action) {
  const role = String(user.role || "OPERATOR").toUpperCase();
  if (role === "OPERATOR" && action !== "PICKED") {
    throw new Error("Operators can only mark confirmed Sales Orders as picked.");
  }
}

export async function receiveProduct(user, input) {
  if (useAppsScript()) return callAppsScript("receiveProduct", { user, input });
  requirePermission(user, "receiving:create");
  const data = await db();
  const detail = await getPurchaseOrderDetail(input.po_id);
  if (!detail) throw new Error("Purchase order not found.");
  const line = data.purchaseOrderLines.find((item) => item.po_line_id === input.po_line_id);
  if (!line) throw new Error("Purchase order line not found.");
  if (line.po_id !== input.po_id) throw new Error("The selected product does not belong to this purchase order.");
  const qtyReceived = numberValue(input.qty_received);
  const qtyDamaged = numberValue(input.qty_damaged);
  if (qtyReceived <= 0) throw new Error("Quantity received must be greater than zero.");
  if (qtyDamaged < 0 || qtyDamaged > qtyReceived) throw new Error("Damaged quantity cannot exceed quantity received.");
  const qualityStatus = String(input.quality_status || "PASS").toUpperCase();
  if (!["PASS", "HOLD", "REJECTED"].includes(qualityStatus)) throw new Error("Select a valid quality status.");
  if (qualityStatus === "REJECTED" && qtyDamaged !== qtyReceived) {
    throw new Error("A rejected delivery must have the full received quantity marked as damaged/rejected.");
  }
  const product = data.products.find((item) => item.product_id === line.product_id);
  const unitsPerPurchaseUnit = numberValue(line.units_per_purchase_unit, product?.units_per_purchase_unit || product?.case_weight_lbs || 1);
  const baseUnit = line.base_unit || product?.base_unit || line.unit_type;
  const acceptedPurchaseQty = qtyReceived - qtyDamaged;
  const acceptedBaseQty = numberValue(input.actual_base_qty, acceptedPurchaseQty * unitsPerPurchaseUnit);
  const confirmedLocationRecord = data.locations.find((loc) => [loc.location_id, loc.qr_value].includes(input.confirmed_location_id));
  if (!confirmedLocationRecord) throw new Error("Select or scan a valid warehouse location.");
  const internalLotId = input.internal_lot_id || uid("LOT", data.lots, "internal_lot_id");
  const confirmedLocation = confirmedLocationRecord.location_id;
  const remainingBefore = numberValue(line.qty_remaining, numberValue(line.qty_ordered) - numberValue(line.qty_received_total));
  const quantityStatus = acceptedPurchaseQty > remainingBefore ? "OVER" : acceptedPurchaseQty < remainingBefore ? "PARTIAL" : "MATCH";
  const approvalStatus = qualityStatus === "PASS" ? "APPROVED" : qualityStatus;
  const receiving = {
    receiving_id: uid("RCV", data.receiving, "receiving_id"),
    po_id: input.po_id,
    po_line_id: line.po_line_id,
    supplier_id: line.supplier_id,
    product_id: line.product_id,
    scan_code: input.scan_code || internalLotId,
    internal_lot_id: internalLotId,
    supplier_lot_number: input.supplier_lot_number || "",
    received_date: today(),
    received_by: user.user_id,
    qty_received: qtyReceived,
    qty_damaged: qtyDamaged,
    qty_accepted: acceptedPurchaseQty,
    unit_type: line.unit_type,
    base_unit: baseUnit,
    units_per_purchase_unit: unitsPerPurchaseUnit,
    qty_accepted_base: acceptedBaseQty,
    pallet_count: numberValue(input.pallet_count),
    quality_score: numberValue(input.quality_score, 5),
    quality_status: qualityStatus,
    over_under_status: quantityStatus,
    recommended_location_id: "",
    confirmed_location_id: confirmedLocation,
    requires_supervisor_approval: qualityStatus !== "PASS" || quantityStatus === "OVER",
    approval_status: approvalStatus,
    notes: input.notes || ""
  };
  const lot = {
    internal_lot_id: internalLotId,
    product_id: line.product_id,
    supplier_id: line.supplier_id,
    supplier_lot_number: receiving.supplier_lot_number,
    po_id: input.po_id,
    po_line_id: line.po_line_id,
    received_date: today(),
    original_qty: acceptedBaseQty,
    current_qty_script: acceptedBaseQty,
    unit_type: baseUnit,
    purchase_qty_received: qtyReceived,
    purchase_unit_type: line.unit_type,
    pallet_count: receiving.pallet_count,
    unit_cost: line.unit_cost,
    current_location_id: confirmedLocation,
    status: qualityStatus === "PASS" ? "ACTIVE" : qualityStatus,
    expiration_date: calculatedExpirationDate(product, today()),
    qr_value: internalLotId,
    notes: "Created by prototype receiving flow."
  };
  const movement = {
    movement_id: uid("MOV", data.inventoryMovements, "movement_id"),
    movement_type: "RECEIVE",
    timestamp: new Date().toISOString(),
    user_id: user.user_id,
    product_id: line.product_id,
    internal_lot_id: internalLotId,
    qty_change: acceptedBaseQty,
    unit_type: baseUnit,
    from_location_id: "SUPPLIER",
    to_location_id: confirmedLocation,
    related_po_id: input.po_id,
    related_receiving_id: receiving.receiving_id,
    scan_code: receiving.scan_code,
    device_id: "WEB-PROTOTYPE",
    approval_status: approvalStatus
  };
  line.qty_received_total = numberValue(line.qty_received_total) + acceptedPurchaseQty;
  line.qty_remaining = Math.max(0, numberValue(line.qty_ordered) - line.qty_received_total);
  if (line.qty_remaining === 0) line.line_status = "RECEIVED";
  const po = data.purchaseOrders.find((item) => item.po_id === input.po_id);
  if (!po.actual_first_received_date) po.actual_first_received_date = today();
  const poLines = data.purchaseOrderLines.filter((item) => item.po_id === input.po_id);
  const allReceived = poLines.length > 0 && poLines.every((item) => numberValue(item.qty_remaining) === 0);
  po.po_status = allReceived ? "COMPLETE" : "PARTIALLY_RECEIVED";
  if (allReceived) po.actual_completed_date = today();
  data.receiving.push(receiving);
  data.lots.push(lot);
  data.inventoryMovements.push(movement);
  save();
  return { receiving, lot, movement };
}

export async function recordInventoryMovement(user, input) {
  if (useAppsScript()) return callAppsScript("recordInventoryMovement", { user, input });
  requirePermission(user, "inventory:adjust");
  const data = await db();
  const lot = data.lots.find((item) => item.internal_lot_id === input.internal_lot_id || item.qr_value === input.internal_lot_id || item.supplier_lot_number === input.internal_lot_id);
  if (!lot) throw new Error("Lot was not found.");
  const qty = numberValue(input.qty);
  if (qty <= 0) throw new Error("Quantity must be greater than zero.");
  const type = String(input.movement_type || "SALE").toUpperCase();
  const direction = type === "ADJUST_IN" ? 1 : -1;
  const qtyChange = qty * direction;
  const movement = {
    movement_id: uid("MOV", data.inventoryMovements, "movement_id"),
    movement_type: type,
    timestamp: new Date().toISOString(),
    user_id: user.user_id,
    product_id: lot.product_id,
    internal_lot_id: lot.internal_lot_id,
    qty_change: qtyChange,
    unit_type: input.unit_type || lot.unit_type,
    from_location_id: lot.current_location_id,
    to_location_id: type === "ADJUST_IN" ? lot.current_location_id : "OUTBOUND",
    related_po_id: lot.po_id || "",
    related_receiving_id: "",
    scan_code: input.internal_lot_id,
    device_id: "WEB-PROTOTYPE",
    approval_status: "APPROVED",
    notes: input.notes || ""
  };
  lot.current_qty_script = numberValue(lot.current_qty_script) + qtyChange;
  data.inventoryMovements.push(movement);
  save();
  return movement;
}

export async function recordAmazonOutbound(user, input) {
  if (useAppsScript()) {
    try {
      return await callAppsScript("recordAmazonOutbound", { user, input });
    } catch (error) {
      if (!String(error.message || "").includes("Unknown action")) throw error;
      const reference = String(input.amazon_reference || "").trim();
      return callAppsScript("recordInventoryMovement", {
        user,
        input: {
          ...input,
          movement_type: "AMAZON_OUT",
          notes: [reference && `Amazon reference: ${reference}`, input.notes].filter(Boolean).join(" | ")
        }
      });
    }
  }
  requirePermission(user, "inventory:adjust");
  const data = await db();
  const lotKey = String(input.internal_lot_id || "").trim();
  const lot = data.lots.find((item) => [item.internal_lot_id, item.qr_value, item.supplier_lot_number].includes(lotKey));
  if (!lot) throw new Error("Scan or enter a valid internal lot.");
  const qty = numberValue(input.qty);
  if (qty <= 0) throw new Error("Quantity must be greater than zero.");
  const available = (await inventorySnapshot())
    .filter((row) => row.internal_lot_id === lot.internal_lot_id && row.location_id === lot.current_location_id)
    .reduce((total, row) => total + numberValue(row.available_qty), 0);
  if (qty > available + 0.0001) throw new Error(`Only ${available} ${lot.unit_type} is available from this lot.`);

  const reference = String(input.amazon_reference || "").trim();
  const movement = {
    movement_id: uid("MOV", data.inventoryMovements, "movement_id"),
    movement_type: "AMAZON_OUT",
    timestamp: new Date().toISOString(),
    user_id: user.user_id,
    product_id: lot.product_id,
    internal_lot_id: lot.internal_lot_id,
    qty_change: -qty,
    unit_type: input.unit_type || lot.unit_type,
    from_location_id: lot.current_location_id,
    to_location_id: "AMAZON_OUTBOUND",
    related_po_id: lot.po_id || "",
    related_receiving_id: "",
    related_amazon_order_id: reference,
    scan_code: lotKey,
    device_id: "WEB-PROTOTYPE",
    approval_status: "APPROVED",
    notes: input.notes || ""
  };
  lot.current_qty_script = numberValue(lot.current_qty_script) - qty;
  data.inventoryMovements.push(movement);
  save();
  return movement;
}

export async function listAmazonOutboundActivity() {
  if (useAppsScript()) {
    try {
      return await callAppsScript("listAmazonOutboundActivity");
    } catch (error) {
      if (String(error.message || "").includes("Unknown action")) return [];
      throw error;
    }
  }
  const data = await db();
  return data.inventoryMovements
    .filter((movement) => movement.movement_type === "AMAZON_OUT")
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 25)
    .map((movement) => ({
      ...movement,
      product: data.products.find((product) => product.product_id === movement.product_id) || null,
      lot: data.lots.find((lot) => lot.internal_lot_id === movement.internal_lot_id) || null
    }));
}

export function purchaseOrderQrValue({ poId, poLineId, productId, productName, qty, supplierLotNumber = "" }) {
  return JSON.stringify({
    v: 1,
    type: "PO_LINE",
    po_id: poId,
    po_line_id: poLineId,
    product_id: productId,
    product_name: productName,
    qty: numberValue(qty),
    supplier_lot_number: supplierLotNumber || "PENDING"
  });
}

function calculateStockLevels(input, data) {
  const velocity = String(input.velocity_class || "").toUpperCase();
  const category = String(input.product_category || "").toUpperCase();
  const existingMovements = data.inventoryMovements
    .filter((movement) => movement.product_id === input.product_id)
    .map((movement) => Math.abs(numberValue(movement.qty_change)));
  const averageMovement = existingMovements.length
    ? existingMovements.reduce((sum, qty) => sum + qty, 0) / existingMovements.length
    : 0;
  const baseTarget = averageMovement > 0
    ? Math.ceil(averageMovement * 4)
    : velocity === "FAST"
      ? 100
      : category.includes("PACK")
        ? 50
        : 25;
  return {
    min_stock_qty: Math.max(1, Math.ceil(baseTarget * 0.25)),
    target_stock_qty: Math.max(5, baseTarget)
  };
}

function calculateSupplierLeadTime(supplierId, data) {
  const completed = data.purchaseOrders
    .filter((po) => po.supplier_id === supplierId && po.order_date && (po.actual_first_received_date || po.actual_completed_date))
    .sort((a, b) => new Date(b.order_date) - new Date(a.order_date))
    .slice(0, 10)
    .map((po) => daysBetween(po.order_date, po.actual_first_received_date || po.actual_completed_date))
    .filter((days) => Number.isFinite(days) && days >= 0);
  if (!completed.length) return 5;
  return Math.round(median(completed));
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Math.max(0, Math.round(numberValue(days, 5))));
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return NaN;
  return (endDate - startDate) / 86400000;
}

function buildPurchaseOrderTemplate({ po, lines }) {
  return {
    po,
    lines: lines.map((line) => ({
      ...line,
      qr_value: line.qr_value || purchaseOrderQrValue({
        poId: line.po_id,
        poLineId: line.po_line_id,
        productId: line.product_id,
        productName: line.product?.product_name || line.product_id,
        qty: line.qty_ordered,
        supplierLotNumber: line.supplier_expected_lot_number
      })
    }))
  };
}

function recommendLocation(data, product) {
  return data.locations.find((location) => {
    if (!product) return location.current_status === "AVAILABLE";
    return location.current_status === "AVAILABLE"
      && (!location.allowed_categories || location.allowed_categories === product.product_category);
  }) || data.locations[0];
}

export async function inventorySnapshot() {
  if (useAppsScript()) return callAppsScript("inventorySnapshot");
  const data = await db();
  const byKey = new Map();
  for (const movement of data.inventoryMovements) {
    const qtyChange = numberValue(movement.qty_change);
    const location = qtyChange < 0
      ? movement.from_location_id || movement.to_location_id || ""
      : movement.to_location_id || movement.from_location_id || "";
    const key = `${movement.product_id}|${movement.internal_lot_id}|${location}`;
    const current = byKey.get(key) || {
      product_id: movement.product_id,
      internal_lot_id: movement.internal_lot_id,
      location_id: location,
      qty: 0,
      unit_type: movement.unit_type
    };
    current.qty += qtyChange;
    byKey.set(key, current);
  }
  const reservedByInventory = buildReservedInventory(data);
  return Array.from(byKey.values()).map((row) => {
    const key = salesInventoryKey(row.product_id, row.internal_lot_id, row.location_id);
    const reservedQty = reservedByInventory.get(key) || 0;
    return {
      ...row,
      reserved_qty: round(reservedQty, 2),
      available_qty: round(Math.max(0, row.qty - reservedQty), 2),
      product: data.products.find((item) => item.product_id === row.product_id),
      lot: data.lots.find((item) => item.internal_lot_id === row.internal_lot_id)
    };
  });
}

function buildReservedInventory(data) {
  const reserved = new Map();
  (data.pickTasks || []).forEach((task) => {
    const reservationStatus = String(task.reservation_status || "RESERVED").toUpperCase();
    const pickStatus = String(task.pick_status || "OPEN").toUpperCase();
    if (reservationStatus === "RELEASED" || ["CANCELLED", "RELEASED"].includes(pickStatus)) return;
    const line = (data.salesOrderLines || []).find((item) => item.sales_order_line_id === task.sales_order_line_id) || {};
    const lotId = task.recommended_internal_lot_id || line.preferred_internal_lot_id;
    const locationId = task.recommended_location_id || line.preferred_location_id;
    const productId = task.product_id || line.product_id;
    if (!productId || !lotId || !locationId) return;
    const qty = numberValue(task.qty_to_pick_base, line.inventory_qty_required || task.qty_to_pick);
    const key = salesInventoryKey(productId, lotId, locationId);
    reserved.set(key, (reserved.get(key) || 0) + qty);
  });
  return reserved;
}

export async function getOperationalReports() {
  if (useAppsScript()) return callAppsScript("getOperationalReports");
  const data = await db();
  const snapshot = await inventorySnapshot();
  const leadBySupplier = buildLeadTimeStatsBySupplier(data.purchaseOrders);
  const planning = data.products.map((product) => buildProductPlanning(product, data, snapshot, leadBySupplier));
  return {
    calculated_at: new Date().toISOString(),
    supplierAnalytics: buildSupplierAnalytics(data, leadBySupplier),
    inventoryPlanning: planning,
    inventorySnapshot: snapshot.map((row) => ({
      ...row,
      current_qty: row.qty,
      inventory_status: row.qty > 0 ? "AVAILABLE" : "EMPTY",
      recommended_action: row.qty > 0 ? "Use FIFO before newer lots." : "No stock at this location."
    })),
    recommendations: planning
      .filter((row) => row.status !== "OK" || row.recommended_order_qty > 0)
      .map((row) => ({
        recommendation_type: row.status === "REORDER" ? "REORDER_NOW" : "BUILD_TO_TARGET",
        product_id: row.product_id,
        product_name: row.product_name,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        recommended_qty: row.recommended_order_qty,
        reorder_point: row.reorder_point,
        target_stock_level: row.target_stock_level,
        confidence_score: row.usage_days > 0 ? 0.75 : 0.35,
        reason_text: row.status === "REORDER" ? "Current stock is at or below reorder point." : "Current stock is below target stock level."
      }))
  };
}

function buildSupplierAnalytics(data, leadBySupplier) {
  const totalSpend = data.purchaseOrders.reduce((sum, po) => sum + numberValue(po.total_amount || po.subtotal_amount), 0);
  return data.suppliers.filter((supplier) => normalizePartyType(supplier.party_type) === "VENDOR").map((supplier) => {
    const supplierOrders = data.purchaseOrders.filter((po) => po.supplier_id === supplier.supplier_id);
    const supplierLines = data.purchaseOrderLines.filter((line) => line.supplier_id === supplier.supplier_id);
    const supplierReceiving = data.receiving.filter((row) => row.supplier_id === supplier.supplier_id);
    const productIds = unique(supplierLines.map((line) => line.product_id).filter(Boolean));
    const qualityScores = supplierReceiving.map((row) => numberValue(row.quality_score)).filter((score) => score > 0);
    const productAccuracyScores = supplierReceiving.map((row) => numberValue(row.product_accuracy_score)).filter((score) => score > 0);
    const quantityAccuracyValues = supplierLines.map((line) => {
      const ordered = numberValue(line.qty_ordered);
      const received = numberValue(line.qty_received_total);
      return ordered > 0 ? Math.max(0, 1 - Math.abs(ordered - received) / ordered) * 100 : null;
    }).filter((value) => value !== null);
    const spend = supplierOrders.reduce((sum, po) => sum + numberValue(po.total_amount || po.subtotal_amount), 0);
    const lead = leadBySupplier[supplier.supplier_id] || fallbackLead();
    return {
      supplier_id: supplier.supplier_id,
      supplier_name: supplier.supplier_name,
      email: supplier.email || "",
      phone: supplier.phone || "",
      products_bought: productIds.map((productId) => data.products.find((product) => product.product_id === productId)?.product_name || productId).join(", "),
      product_count: productIds.length,
      total_orders: supplierOrders.length,
      completed_orders: supplierOrders.filter((po) => po.actual_completed_date || po.actual_first_received_date || po.po_status === "COMPLETE").length,
      total_purchase_amount: round(spend, 2),
      spend_share_percent: totalSpend > 0 ? round(spend / totalSpend * 100, 1) : 0,
      avg_lead_time_days: lead.average,
      std_lead_time_days: lead.stdDev,
      lead_time_samples: lead.count,
      avg_quality_score: round(average(qualityScores), 2),
      quality_percent: qualityScores.length ? round(average(qualityScores) / 5 * 100, 1) : 0,
      product_accuracy_percent: productAccuracyScores.length ? round(average(productAccuracyScores) / 5 * 100, 1) : 0,
      quantity_accuracy_percent: quantityAccuracyValues.length ? round(average(quantityAccuracyValues), 1) : 0,
      receiving_count: supplierReceiving.length
    };
  });
}

function buildProductPlanning(product, data, snapshot, leadBySupplier) {
  const usage = buildDailyUsageStats(product.product_id, data.inventoryMovements);
  const supplierId = chooseSupplierForProduct(product.product_id, data.purchaseOrderLines);
  const supplier = data.suppliers.find((item) => item.supplier_id === supplierId) || {};
  const lead = leadBySupplier[supplierId] || fallbackLead();
  const currentQty = snapshot
    .filter((row) => row.product_id === product.product_id)
    .reduce((sum, row) => sum + numberValue(row.qty), 0);
  const demandDuringLeadTime = usage.averageDailyUsage * lead.average;
  const safetyStock = 1.65 * Math.sqrt(
    (lead.average * Math.pow(usage.stdDailyUsage, 2))
    + (Math.pow(usage.averageDailyUsage, 2) * Math.pow(lead.stdDev, 2))
  );
  const reorderPoint = demandDuringLeadTime + safetyStock;
  const targetStock = Math.max(reorderPoint, usage.averageDailyUsage * velocityDays(product.velocity_class));
  return {
    product_id: product.product_id,
    product_name: product.product_name,
    velocity_class: product.velocity_class || "MEDIUM",
    supplier_id: supplierId,
    supplier_name: supplier.supplier_name || "",
    current_qty: round(currentQty, 2),
    average_daily_usage: round(usage.averageDailyUsage, 2),
    std_daily_usage: round(usage.stdDailyUsage, 2),
    usage_days: usage.days,
    avg_lead_time_days: lead.average,
    std_lead_time_days: lead.stdDev,
    demand_during_lead_time: round(demandDuringLeadTime, 2),
    safety_stock: round(safetyStock, 2),
    reorder_point: Math.ceil(reorderPoint),
    target_stock_level: Math.ceil(targetStock),
    recommended_order_qty: Math.max(0, Math.ceil(targetStock - currentQty)),
    status: currentQty <= reorderPoint ? "REORDER" : currentQty < targetStock ? "WATCH" : "OK",
    notes: usage.samples ? "Calculated from movement history." : "No usage history yet; using zero demand fallback."
  };
}

function buildDashboardMetrics(data, snapshot, planning) {
  const positiveStock = snapshot.filter((row) => numberValue(row.qty) > 0);
  const qtyByLot = new Map();
  positiveStock.forEach((row) => {
    qtyByLot.set(row.internal_lot_id, (qtyByLot.get(row.internal_lot_id) || 0) + numberValue(row.qty));
  });

  const totalInventoryValue = positiveStock.reduce((sum, row) => {
    const lot = row.lot || data.lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    return sum + dashboardInventoryValue(lot, numberValue(row.qty), data.purchaseOrderLines);
  }, 0);

  const lowStockProducts = planning
    .filter((row) => row.average_daily_usage > 0 && row.status === "REORDER")
    .map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      current_qty: row.current_qty,
      average_daily_usage: row.average_daily_usage,
      reorder_point: row.reorder_point,
      recommended_order_qty: row.recommended_order_qty,
      days_of_supply: row.average_daily_usage > 0 ? round(row.current_qty / row.average_daily_usage, 1) : 0
    }))
    .sort((a, b) => a.days_of_supply - b.days_of_supply);

  const todayDate = startOfDay(new Date());
  const expirationLimit = new Date(todayDate.getTime() + 30 * 86400000);
  const expiringLots = data.lots.map((lot) => {
    const product = data.products.find((item) => item.product_id === lot.product_id) || {};
    const expirationDate = effectiveExpirationDate(lot, product);
    const currentQty = qtyByLot.get(lot.internal_lot_id) || 0;
    if (!expirationDate || currentQty <= 0 || expirationDate < todayDate || expirationDate > expirationLimit) return null;
    return {
      internal_lot_id: lot.internal_lot_id,
      product_id: lot.product_id,
      product_name: product.product_name || lot.product_id,
      current_qty: round(currentQty, 2),
      unit_type: lot.unit_type || "",
      location_id: lot.current_location_id || "",
      expiration_date: dateKey(expirationDate),
      days_remaining: Math.ceil((expirationDate.getTime() - todayDate.getTime()) / 86400000),
      inventory_value: round(dashboardInventoryValue(lot, currentQty, data.purchaseOrderLines), 2)
    };
  }).filter(Boolean).sort((a, b) => a.days_remaining - b.days_remaining);

  const activeLocations = data.locations.filter((location) => isActiveRecord(location));
  const locationIds = new Set(activeLocations.map((location) => location.location_id));
  const occupiedLocations = new Set(
    positiveStock.map((row) => row.location_id).filter((locationId) => locationIds.has(locationId))
  );
  const openOrders = data.purchaseOrders.filter(isOpenPurchaseOrder);
  const salesOrders = data.salesOrders || [];
  const salesOrderLines = data.salesOrderLines || [];
  const openSalesOrders = salesOrders.filter((order) => !["SHIPPED", "CANCELLED", "CLOSED"].includes(String(order.status || "").toUpperCase()));
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const shippedThisWeek = salesOrders.filter((order) => {
    if (String(order.status || "").toUpperCase() !== "SHIPPED") return false;
    const shippedDate = new Date(order.shipped_at || order.updated_at || order.order_date || 0);
    return !Number.isNaN(shippedDate.getTime()) && shippedDate >= weekStart;
  });
  const shippedIds = new Set(shippedThisWeek.map((order) => order.sales_order_id));
  const profitByProduct = {};
  salesOrderLines.filter((line) => shippedIds.has(line.sales_order_id)).forEach((line) => {
    const current = profitByProduct[line.product_id] || { revenue: 0, profit: 0 };
    current.revenue += numberValue(line.line_total);
    current.profit += numberValue(line.estimated_gross_profit);
    profitByProduct[line.product_id] = current;
  });
  const topProfitProduct = Object.entries(profitByProduct).map(([productId, totals]) => ({
    product_id: productId,
    product_name: data.products.find((product) => product.product_id === productId)?.product_name || productId,
    gross_profit: round(totals.profit, 2),
    gross_margin_percent: totals.revenue > 0 ? round(totals.profit / totals.revenue * 100, 1) : 0
  })).sort((a, b) => b.gross_profit - a.gross_profit)[0] || null;

  return {
    totalInventoryValue: round(totalInventoryValue, 2),
    lowStockCount: lowStockProducts.length,
    lowStockProducts,
    usageHistoryNeededCount: planning.filter((row) => row.usage_days === 0).length,
    expiringLotCount: expiringLots.length,
    expiringProductCount: unique(expiringLots.map((row) => row.product_id)).length,
    expiringInventoryValue: round(expiringLots.reduce((sum, row) => sum + row.inventory_value, 0), 2),
    expiringLots,
    openPoValue: round(openOrders.reduce((sum, po) => sum + numberValue(po.total_amount || po.subtotal_amount), 0), 2),
    openSoCount: openSalesOrders.length,
    openSoValue: round(openSalesOrders.reduce((sum, order) => sum + numberValue(order.total_amount), 0), 2),
    weeklySales: round(shippedThisWeek.reduce((sum, order) => sum + numberValue(order.total_amount), 0), 2),
    topProfitProduct,
    warehouseOccupiedPositions: occupiedLocations.size,
    warehouseTotalPositions: activeLocations.length,
    warehouseCapacityPercent: activeLocations.length ? round(occupiedLocations.size / activeLocations.length * 100, 1) : 0
  };
}

function isOpenPurchaseOrder(po) {
  return !["COMPLETE", "CANCELLED", "CLOSED"].includes(String(po.po_status || "").toUpperCase());
}

function dashboardInventoryValue(lot, currentQty, purchaseOrderLines) {
  const cost = numberValue(lot.unit_cost);
  const line = purchaseOrderLines.find((item) => item.po_line_id === lot.po_line_id) || {};
  const purchaseUnit = String(lot.purchase_unit_type || line.unit_type || "").toUpperCase();
  const inventoryUnit = String(lot.unit_type || line.base_unit || "").toUpperCase();
  const lotUnitsPerPurchaseUnit = numberValue(lot.purchase_qty_received) > 0
    ? numberValue(lot.original_qty) / numberValue(lot.purchase_qty_received)
    : 0;
  const unitsPerPurchaseUnit = numberValue(line.units_per_purchase_unit, lotUnitsPerPurchaseUnit || 1);
  if (purchaseUnit && inventoryUnit && purchaseUnit !== inventoryUnit && unitsPerPurchaseUnit > 0) {
    return (numberValue(currentQty) / unitsPerPurchaseUnit) * cost;
  }
  return numberValue(currentQty) * cost;
}

function isActiveRecord(record) {
  return record.is_active === undefined
    || record.is_active === ""
    || record.is_active === true
    || String(record.is_active).toUpperCase() === "TRUE";
}

function effectiveExpirationDate(lot, product) {
  const explicit = startOfDay(lot.expiration_date);
  if (explicit) return explicit;
  const calculated = calculatedExpirationDate(product, lot.received_date);
  return calculated ? startOfDay(calculated) : null;
}

function calculatedExpirationDate(product, receivedDate) {
  const perishabilityDays = numberValue(product?.perishability_days);
  const received = startOfDay(receivedDate);
  if (perishabilityDays <= 0 || !received) return "";
  return dateKey(new Date(received.getTime() + perishabilityDays * 86400000));
}

function startOfDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildDailyUsageStats(productId, movements) {
  const byDate = {};
  const usageMovements = movements.filter((movement) => {
    if (movement.product_id !== productId) return false;
    const qty = numberValue(movement.qty_change);
    const type = String(movement.movement_type || "").toUpperCase();
    return qty < 0 || ["SALE", "SHIP", "PICK", "PACK", "USE", "ADJUST_OUT"].includes(type);
  });
  for (const movement of usageMovements) {
    const key = dateKey(movement.timestamp);
    if (key) byDate[key] = (byDate[key] || 0) + Math.abs(numberValue(movement.qty_change));
  }
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return { averageDailyUsage: 0, stdDailyUsage: 0, days: 0, samples: 0 };
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const totalDays = Math.max(1, Math.floor(daysBetween(start, end)) + 1);
  const values = [];
  for (let i = 0; i < totalDays; i += 1) {
    values.push(byDate[dateKey(new Date(start.getTime() + i * 86400000))] || 0);
  }
  return { averageDailyUsage: average(values), stdDailyUsage: std(values), days: totalDays, samples: usageMovements.length };
}

function buildLeadTimeStatsBySupplier(purchaseOrders) {
  const grouped = {};
  for (const po of purchaseOrders) {
    const receivedDate = po.actual_first_received_date || po.actual_completed_date;
    if (!po.supplier_id || !po.order_date || !receivedDate) continue;
    const days = daysBetween(po.order_date, receivedDate);
    if (!Number.isFinite(days) || days < 0) continue;
    if (!grouped[po.supplier_id]) grouped[po.supplier_id] = [];
    grouped[po.supplier_id].push(days);
  }
  return Object.fromEntries(Object.entries(grouped).map(([supplierId, values]) => [supplierId, {
    average: round(average(values), 2),
    stdDev: round(std(values), 2),
    count: values.length
  }]));
}

function chooseSupplierForProduct(productId, lines) {
  const counts = {};
  for (const line of lines.filter((item) => item.product_id === productId && item.supplier_id)) {
    counts[line.supplier_id] = (counts[line.supplier_id] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
}

function fallbackLead() {
  return { average: 5, stdDev: 0, count: 0 };
}

function velocityDays(velocityClass) {
  const value = String(velocityClass || "").toUpperCase();
  if (value === "FAST") return 10;
  if (value === "SLOW") return 60;
  return 40;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function std(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = average(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (clean.length - 1));
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizePartyType(value) {
  return String(value || "VENDOR").trim().toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
}

function round(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.round(numberValue(value) * factor) / factor;
}

function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export async function lookupScan(scanValue) {
  if (useAppsScript()) return callAppsScript("lookupScan", { scanValue });
  const data = await db();
  const value = String(scanValue || "").trim();
  if (!value) return null;
  const product = data.products.find((item) => [item.product_id, item.barcode_or_qr_value, item.amazon_sku, item.wholesale_sku].includes(value));
  if (product) return { type: "PRODUCT", record: product };
  const supplier = data.suppliers.find((item) => item.supplier_id === value);
  if (supplier) return { type: "SUPPLIER", record: supplier };
  const location = data.locations.find((item) => [item.location_id, item.qr_value].includes(value));
  if (location) return { type: "LOCATION", record: location };
  const lot = data.lots.find((item) => [item.internal_lot_id, item.qr_value, item.supplier_lot_number].includes(value));
  if (lot) return { type: "LOT", record: lot };
  const pkg = data.amazonPackages.find((item) => [item.package_id, item.package_qr_value].includes(value));
  if (pkg) return { type: "AMAZON_PACKAGE", record: pkg };
  return null;
}

export async function matchAmazonPackageScan(scanValue) {
  if (useAppsScript()) return callAppsScript("matchAmazonPackageScan", { scanValue });
  const data = await db();
  const pkg = data.amazonPackages.find((item) => [item.package_id, item.package_qr_value].includes(scanValue));
  if (!pkg) return { match_status: "NOT_FOUND", message: "Package scan was not found." };
  const match = {
    scan_match_id: uid("AMZSCAN", data.amazonScanMatches, "scan_match_id"),
    scanned_at: new Date().toISOString(),
    scanned_by: "WEB-PROTOTYPE",
    package_id: pkg.package_id,
    amazon_sku: pkg.amazon_sku,
    product_id: pkg.product_id,
    match_status: "PACKAGE_FOUND",
    match_confidence: 0.75,
    notes: "Prototype match: package exists, future Amazon order line link pending."
  };
  data.amazonScanMatches.push(match);
  save();
  return match;
}
