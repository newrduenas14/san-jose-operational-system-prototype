import { requirePermission } from "./permissions.js";
import { numberValue, today, uid } from "./utils.js";
import { GOOGLE_SCRIPT_WEB_APP_URL } from "./config.js?v=smooth1";

const DB_KEY = "sjops.database.v1";
const APPS_CACHE_PREFIX = "sjops.apps.cache.";
const APPS_CACHE_TTL_MS = 45000;
const READ_ACTIONS = new Set([
  "getDashboard",
  "listProducts",
  "listSuppliers",
  "listLocations",
  "listPurchaseOrders",
  "getPurchaseOrderDetail",
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
  ["getDashboard", "listProducts", "listSuppliers", "listPurchaseOrders", "inventorySnapshot"].forEach((action, index) => {
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
  return {
    productCount: data.products.length,
    supplierCount: data.suppliers.length,
    openPoCount: data.purchaseOrders.filter((po) => po.po_status !== "COMPLETE").length,
    lotCount: data.lots.length,
    movementCount: data.inventoryMovements.length,
    pendingAmazonPackages: data.amazonPackages.filter((pkg) => !pkg.matched_amazon_order_id).length
  };
}

export async function listProducts() {
  if (useAppsScript()) return callAppsScript("listProducts");
  return (await db()).products;
}

export async function createProduct(user, input) {
  if (useAppsScript()) return callAppsScript("createProduct", { user, input });
  requirePermission(user, "products:create");
  const data = await db();
  const stock = calculateStockLevels(input, data);
  const product = {
    product_id: input.product_id || uid("PROD", data.products, "product_id"),
    product_name: input.product_name,
    product_category: input.product_category || "",
    default_unit: input.default_unit || "BOX",
    base_unit: input.base_unit || input.default_unit || "BOX",
    units_per_purchase_unit: numberValue(input.units_per_purchase_unit, input.case_weight_lbs || 1),
    can_break_case: input.can_break_case || "FALSE",
    case_weight_lbs: numberValue(input.case_weight_lbs),
    amazon_sku: input.amazon_sku || "",
    wholesale_sku: input.wholesale_sku || "",
    barcode_or_qr_value: input.barcode_or_qr_value || input.product_id || "",
    min_stock_qty: stock.min_stock_qty,
    target_stock_qty: stock.target_stock_qty,
    velocity_class: input.velocity_class || "",
    storage_zone_preference: input.storage_zone_preference || "",
    is_active: true,
    notes: input.notes || ""
  };
  if (!product.product_name) throw new Error("Product name is required.");
  if (data.products.some((item) => item.product_id === product.product_id)) {
    throw new Error("Product ID already exists.");
  }
  if (!product.barcode_or_qr_value) product.barcode_or_qr_value = product.product_id;
  data.products.push(product);
  save();
  return product;
}

export async function listSuppliers() {
  if (useAppsScript()) return callAppsScript("listSuppliers");
  const data = await db();
  return data.suppliers.map((supplier) => ({
    ...supplier,
    lead_time_expected_days: calculateSupplierLeadTime(supplier.supplier_id, data)
  }));
}

export async function createSupplier(user, input) {
  if (useAppsScript()) return callAppsScript("createSupplier", { user, input });
  requirePermission(user, "suppliers:create");
  const data = await db();
  const supplierId = input.supplier_id || uid("SUP", data.suppliers, "supplier_id");
  const supplier = {
    supplier_id: supplierId,
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: calculateSupplierLeadTime(supplierId, data),
    is_active: true,
    notes: input.notes || ""
  };
  if (!supplier.supplier_name) throw new Error("Supplier name is required.");
  if (data.suppliers.some((item) => item.supplier_id === supplier.supplier_id)) {
    throw new Error("Supplier ID already exists.");
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
    supplier: data.suppliers.find((s) => s.supplier_id === po.supplier_id)
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
  return { po, lines };
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
  const qty = numberValue(input.qty_ordered, 1);
  const unitCost = numberValue(input.unit_cost);
  const product = data.products.find((item) => item.product_id === input.product_id) || {};
  const unitsPerPurchaseUnit = numberValue(input.units_per_purchase_unit, product.units_per_purchase_unit || product.case_weight_lbs || 1);
  const baseUnit = input.base_unit || product.base_unit || input.unit_type || product.default_unit || "EACH";
  const po = {
    po_id: uid("PO", data.purchaseOrders, "po_id"),
    po_status: "DRAFT",
    supplier_id: input.supplier_id,
    created_by: user.user_id,
    order_date: today(),
    expected_delivery_date: input.expected_delivery_date || "",
    payment_terms: "Net 30",
    currency: "USD",
    subtotal_amount: qty * unitCost,
    total_amount: qty * unitCost,
    email_status: "NOT_SENT",
    printed_status: "NOT_PRINTED",
    supplier_confirmation_status: "PENDING",
    notes: input.notes || ""
  };
  const line = {
    po_line_id: uid("POL", data.purchaseOrderLines, "po_line_id"),
    po_id: po.po_id,
    supplier_id: input.supplier_id,
    product_id: input.product_id,
    line_status: "ORDERED",
    qty_ordered: qty,
    qty_received_total: 0,
    qty_remaining: qty,
    unit_type: input.unit_type || product.default_unit || "BOX",
    base_unit: baseUnit,
    units_per_purchase_unit: unitsPerPurchaseUnit,
    expected_base_qty: qty * unitsPerPurchaseUnit,
    case_weight_lbs: numberValue(input.case_weight_lbs, product.case_weight_lbs || 0),
    unit_cost: unitCost,
    line_total: qty * unitCost,
    supplier_expected_lot_number: input.supplier_expected_lot_number || "",
    qr_value: purchaseOrderQrValue(input.product_id, qty, input.supplier_expected_lot_number)
  };
  data.purchaseOrders.push(po);
  data.purchaseOrderLines.push(line);
  save();
  return po;
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

export async function receiveProduct(user, input) {
  if (useAppsScript()) return callAppsScript("receiveProduct", { user, input });
  requirePermission(user, "receiving:create");
  const data = await db();
  const detail = await getPurchaseOrderDetail(input.po_id);
  if (!detail) throw new Error("Purchase order not found.");
  const line = data.purchaseOrderLines.find((item) => item.po_line_id === input.po_line_id);
  if (!line) throw new Error("Purchase order line not found.");
  const qtyReceived = numberValue(input.qty_received);
  const qtyDamaged = numberValue(input.qty_damaged);
  if (qtyReceived <= 0) throw new Error("Quantity received must be greater than zero.");
  const product = data.products.find((item) => item.product_id === line.product_id);
  const unitsPerPurchaseUnit = numberValue(line.units_per_purchase_unit, product?.units_per_purchase_unit || product?.case_weight_lbs || 1);
  const baseUnit = line.base_unit || product?.base_unit || line.unit_type;
  const acceptedPurchaseQty = qtyReceived - qtyDamaged;
  const acceptedBaseQty = numberValue(input.actual_base_qty, acceptedPurchaseQty * unitsPerPurchaseUnit);
  const location = recommendLocation(data, product);
  if (input.confirmed_location_id && input.confirmed_location_id !== location.location_id) {
    const exists = data.locations.some((loc) => loc.location_id === input.confirmed_location_id);
    if (!exists) throw new Error("Confirmed location scan was not found.");
  }
  const internalLotId = input.internal_lot_id || uid("LOT", data.lots, "internal_lot_id");
  const confirmedLocation = input.confirmed_location_id || location.location_id;
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
    recommended_location_id: location.location_id,
    confirmed_location_id: confirmedLocation,
    approval_status: "APPROVED",
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
    status: "ACTIVE",
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
    approval_status: "APPROVED"
  };
  line.qty_received_total += qtyReceived;
  line.qty_remaining = Math.max(0, line.qty_ordered - line.qty_received_total);
  if (line.qty_remaining === 0) line.line_status = "RECEIVED";
  const po = data.purchaseOrders.find((item) => item.po_id === input.po_id);
  po.po_status = line.qty_remaining === 0 ? "COMPLETE" : "PARTIALLY_RECEIVED";
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

export function purchaseOrderQrValue(productId, qty, supplierLotNumber = "") {
  return [productId, `QTY:${numberValue(qty, 0)}`, `SUPLOT:${supplierLotNumber || "PENDING"}`].join("|");
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
    .filter((po) => po.supplier_id === supplierId && po.order_date && po.actual_completed_date)
    .map((po) => daysBetween(po.order_date, po.actual_completed_date))
    .filter((days) => Number.isFinite(days) && days >= 0);
  if (!completed.length) return 5;
  return Math.round(completed.reduce((sum, days) => sum + days, 0) / completed.length);
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
      qr_value: purchaseOrderQrValue(line.product_id, line.qty_ordered, line.supplier_expected_lot_number)
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
    const location = movement.to_location_id || movement.from_location_id || "";
    const key = `${movement.product_id}|${movement.internal_lot_id}|${location}`;
    const current = byKey.get(key) || {
      product_id: movement.product_id,
      internal_lot_id: movement.internal_lot_id,
      location_id: location,
      qty: 0,
      unit_type: movement.unit_type
    };
    current.qty += numberValue(movement.qty_change);
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).map((row) => ({
    ...row,
    product: data.products.find((item) => item.product_id === row.product_id),
    lot: data.lots.find((item) => item.internal_lot_id === row.internal_lot_id)
  }));
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
  return data.suppliers.map((supplier) => {
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

function std(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = average(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (clean.length - 1));
}

function unique(values) {
  return Array.from(new Set(values));
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
