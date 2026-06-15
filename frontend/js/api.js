import { requirePermission } from "./permissions.js";
import { numberValue, today, uid } from "./utils.js";

const DB_KEY = "sjops.database.v1";
let dbCache;

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
  dbCache = await loadSeed();
  save();
  return dbCache;
}

export async function getDashboard() {
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
  return (await db()).products;
}

export async function createProduct(user, input) {
  requirePermission(user, "products:create");
  const data = await db();
  const product = {
    product_id: input.product_id || uid("PROD", data.products, "product_id"),
    product_name: input.product_name,
    product_category: input.product_category || "",
    default_unit: input.default_unit || "BOX",
    case_weight_lbs: numberValue(input.case_weight_lbs),
    amazon_sku: input.amazon_sku || "",
    wholesale_sku: input.wholesale_sku || "",
    barcode_or_qr_value: input.barcode_or_qr_value || input.product_id || "",
    min_stock_qty: numberValue(input.min_stock_qty),
    target_stock_qty: numberValue(input.target_stock_qty),
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
  return (await db()).suppliers;
}

export async function createSupplier(user, input) {
  requirePermission(user, "suppliers:create");
  const data = await db();
  const supplier = {
    supplier_id: input.supplier_id || uid("SUP", data.suppliers, "supplier_id"),
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: numberValue(input.lead_time_expected_days),
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
  return (await db()).locations;
}

export async function listPurchaseOrders() {
  const data = await db();
  return data.purchaseOrders.map((po) => ({
    ...po,
    supplier: data.suppliers.find((s) => s.supplier_id === po.supplier_id)
  }));
}

export async function getPurchaseOrderDetail(poId) {
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

export async function createPurchaseOrder(user, input) {
  requirePermission(user, "purchaseOrders:create");
  const data = await db();
  const qty = numberValue(input.qty_ordered, 1);
  const unitCost = numberValue(input.unit_cost);
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
    unit_type: input.unit_type || "BOX",
    unit_cost: unitCost,
    line_total: qty * unitCost
  };
  data.purchaseOrders.push(po);
  data.purchaseOrderLines.push(line);
  save();
  return po;
}

export async function purchaseOrderAction(user, poId, action) {
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
    qty_accepted: qtyReceived - qtyDamaged,
    unit_type: line.unit_type,
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
    original_qty: receiving.qty_accepted,
    current_qty_script: receiving.qty_accepted,
    unit_type: line.unit_type,
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
    qty_change: receiving.qty_accepted,
    unit_type: line.unit_type,
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

function recommendLocation(data, product) {
  return data.locations.find((location) => {
    if (!product) return location.current_status === "AVAILABLE";
    return location.current_status === "AVAILABLE"
      && (!location.allowed_categories || location.allowed_categories === product.product_category);
  }) || data.locations[0];
}

export async function inventorySnapshot() {
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

export async function lookupScan(scanValue) {
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
