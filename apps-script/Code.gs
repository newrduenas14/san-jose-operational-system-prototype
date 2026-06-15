const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";

const PERMISSIONS = {
  ADMIN: ["products:create", "suppliers:create", "purchaseOrders:create", "receiving:create", "scanner:lookup", "inventory:view"],
  MANAGER: ["products:create", "suppliers:create", "purchaseOrders:create", "receiving:create", "scanner:lookup", "inventory:view"],
  OPERATOR: ["receiving:create", "scanner:lookup", "inventory:view"]
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("San Jose Operations")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function listProducts() {
  return readTable_("PRODUCTS");
}

function createProduct(payload) {
  requirePermission_(payload.user, "products:create");
  const input = payload.input || {};
  if (!input.product_name) throw new Error("Product name is required.");
  const productId = input.product_id || nextId_("PRODUCTS", "product_id", "PROD");
  const record = {
    product_id: productId,
    product_name: input.product_name,
    product_category: input.product_category || "",
    default_unit: input.default_unit || "BOX",
    case_weight_lbs: Number(input.case_weight_lbs || 0),
    amazon_sku: input.amazon_sku || "",
    wholesale_sku: input.wholesale_sku || "",
    barcode_or_qr_value: input.barcode_or_qr_value || productId,
    min_stock_qty: Number(input.min_stock_qty || 0),
    target_stock_qty: Number(input.target_stock_qty || 0),
    velocity_class: input.velocity_class || "",
    storage_zone_preference: input.storage_zone_preference || "",
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    notes: input.notes || ""
  };
  appendRecord_("PRODUCTS", record);
  return record;
}

function listSuppliers() {
  return readTable_("SUPPLIERS");
}

function createSupplier(payload) {
  requirePermission_(payload.user, "suppliers:create");
  const input = payload.input || {};
  if (!input.supplier_name) throw new Error("Supplier name is required.");
  const supplierId = input.supplier_id || nextId_("SUPPLIERS", "supplier_id", "SUP");
  const record = {
    supplier_id: supplierId,
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: Number(input.lead_time_expected_days || 0),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    notes: input.notes || ""
  };
  appendRecord_("SUPPLIERS", record);
  return record;
}

function listPurchaseOrders() {
  const suppliers = readTable_("SUPPLIERS");
  return readTable_("PURCHASE_ORDERS").map((po) => ({
    ...po,
    supplier: suppliers.find((s) => s.supplier_id === po.supplier_id) || null
  }));
}

function getPurchaseOrderDetail(payload) {
  const poId = payload.poId || payload.po_id;
  const products = readTable_("PRODUCTS");
  const po = readTable_("PURCHASE_ORDERS").find((row) => row.po_id === poId);
  if (!po) return null;
  const lines = readTable_("PURCHASE_ORDER_LINES")
    .filter((line) => line.po_id === poId)
    .map((line) => ({ ...line, product: products.find((p) => p.product_id === line.product_id) || null }));
  return { po, lines };
}

function createPurchaseOrder(payload) {
  requirePermission_(payload.user, "purchaseOrders:create");
  const input = payload.input || {};
  const qty = Number(input.qty_ordered || 1);
  const unitCost = Number(input.unit_cost || 0);
  const poId = nextId_("PURCHASE_ORDERS", "po_id", "PO");
  const lineId = nextId_("PURCHASE_ORDER_LINES", "po_line_id", "POL");
  const po = {
    po_id: poId,
    po_status: "DRAFT",
    supplier_id: input.supplier_id,
    created_by: (payload.user && payload.user.user_id) || "UNKNOWN",
    order_date: new Date(),
    expected_delivery_date: input.expected_delivery_date || "",
    payment_terms: "Net 30",
    currency: "USD",
    subtotal_amount: qty * unitCost,
    tax_amount: 0,
    shipping_amount: 0,
    total_amount: qty * unitCost,
    email_status: "NOT_SENT",
    printed_status: "NOT_PRINTED",
    supplier_confirmation_status: "PENDING",
    notes: input.notes || ""
  };
  const line = {
    po_line_id: lineId,
    po_id: poId,
    supplier_id: input.supplier_id,
    product_id: input.product_id,
    line_status: "ORDERED",
    qty_ordered: qty,
    qty_received_total: 0,
    qty_remaining: qty,
    unit_type: input.unit_type || "BOX",
    unit_cost: unitCost,
    currency: "USD",
    line_total: qty * unitCost,
    notes: input.notes || ""
  };
  appendRecord_("PURCHASE_ORDERS", po);
  appendRecord_("PURCHASE_ORDER_LINES", line);
  return po;
}

function receiveProduct(payload) {
  requirePermission_(payload.user, "receiving:create");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const input = payload.input || {};
    const line = readTable_("PURCHASE_ORDER_LINES").find((row) => row.po_line_id === input.po_line_id);
    if (!line) throw new Error("Purchase order line not found.");
    const qtyReceived = Number(input.qty_received || 0);
    const qtyDamaged = Number(input.qty_damaged || 0);
    if (qtyReceived <= 0) throw new Error("Quantity received must be greater than zero.");
    const product = readTable_("PRODUCTS").find((row) => row.product_id === line.product_id);
    const location = recommendLocation_(product);
    const confirmedLocationId = input.confirmed_location_id || location.location_id;
    const internalLotId = input.internal_lot_id || nextId_("LOTS", "internal_lot_id", "LOT");
    const receivingId = nextId_("RECEIVING", "receiving_id", "RCV");
    const movementId = nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV");
    const acceptedQty = qtyReceived - qtyDamaged;
    const receiving = {
      receiving_id: receivingId,
      po_id: input.po_id,
      po_line_id: input.po_line_id,
      supplier_id: line.supplier_id,
      product_id: line.product_id,
      scan_code: input.scan_code || internalLotId,
      internal_lot_id: internalLotId,
      supplier_lot_number: input.supplier_lot_number || "",
      received_date: new Date(),
      received_by: (payload.user && payload.user.user_id) || "UNKNOWN",
      qty_received: qtyReceived,
      qty_damaged: qtyDamaged,
      qty_accepted: acceptedQty,
      unit_type: line.unit_type,
      quality_score: Number(input.quality_score || 5),
      product_accuracy_score: 5,
      over_under_status: "MATCH",
      recommended_location_id: location.location_id,
      confirmed_location_id: confirmedLocationId,
      requires_supervisor_approval: false,
      approval_status: "APPROVED",
      notes: input.notes || ""
    };
    const lot = {
      internal_lot_id: internalLotId,
      product_id: line.product_id,
      supplier_id: line.supplier_id,
      supplier_lot_number: input.supplier_lot_number || "",
      po_id: input.po_id,
      po_line_id: input.po_line_id,
      received_date: new Date(),
      original_qty: acceptedQty,
      current_qty_script: acceptedQty,
      unit_type: line.unit_type,
      unit_cost: Number(line.unit_cost || 0),
      currency: line.currency || "USD",
      current_location_id: confirmedLocationId,
      status: "ACTIVE",
      qr_value: internalLotId,
      created_at: new Date(),
      updated_at: new Date(),
      notes: "Created by Apps Script receiving flow."
    };
    const movement = {
      movement_id: movementId,
      movement_type: "RECEIVE",
      timestamp: new Date(),
      user_id: (payload.user && payload.user.user_id) || "UNKNOWN",
      product_id: line.product_id,
      internal_lot_id: internalLotId,
      qty_change: acceptedQty,
      unit_type: line.unit_type,
      from_location_id: "SUPPLIER",
      to_location_id: confirmedLocationId,
      related_po_id: input.po_id,
      related_receiving_id: receivingId,
      scan_code: input.scan_code || internalLotId,
      device_id: "WEB_APP",
      approval_status: "APPROVED",
      notes: input.notes || ""
    };
    appendRecord_("RECEIVING", receiving);
    appendRecord_("LOTS", lot);
    appendRecord_("INVENTORY_MOVEMENTS", movement);
    updatePoLineReceived_(input.po_line_id, qtyReceived);
    return { receiving, lot, movement };
  } finally {
    lock.releaseLock();
  }
}

function lookupScan(payload) {
  requirePermission_(payload.user || { role: "OPERATOR" }, "scanner:lookup");
  const value = String(payload.scanValue || "").trim();
  if (!value) return null;
  const product = readTable_("PRODUCTS").find((row) => [row.product_id, row.barcode_or_qr_value, row.amazon_sku, row.wholesale_sku].includes(value));
  if (product) return { type: "PRODUCT", record: product };
  const location = readTable_("LOCATIONS").find((row) => [row.location_id, row.qr_value].includes(value));
  if (location) return { type: "LOCATION", record: location };
  const lot = readTable_("LOTS").find((row) => [row.internal_lot_id, row.qr_value, row.supplier_lot_number].includes(value));
  if (lot) return { type: "LOT", record: lot };
  return null;
}

function inventorySnapshot(payload) {
  requirePermission_(payload.user, "inventory:view");
  const grouped = {};
  readTable_("INVENTORY_MOVEMENTS").forEach((movement) => {
    const locationId = movement.to_location_id || movement.from_location_id || "";
    const key = [movement.product_id, movement.internal_lot_id, locationId].join("|");
    if (!grouped[key]) grouped[key] = { product_id: movement.product_id, internal_lot_id: movement.internal_lot_id, location_id: locationId, qty: 0, unit_type: movement.unit_type };
    grouped[key].qty += Number(movement.qty_change || 0);
  });
  return Object.keys(grouped).map((key) => grouped[key]);
}

function spreadsheet_() {
  if (SPREADSHEET_ID === "PASTE_YOUR_SPREADSHEET_ID_HERE") throw new Error("Set SPREADSHEET_ID in Code.gs first.");
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function tableMeta_(sheetName) {
  const sheet = spreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Missing sheet: " + sheetName);
  const values = sheet.getDataRange().getValues();
  const headerIndex = values.findIndex((row) => row.some((cell) => String(cell || "").trim().endsWith("_id")));
  if (headerIndex < 0) throw new Error("Could not find header row for " + sheetName);
  const headers = values[headerIndex].map((cell) => String(cell || "").trim()).filter(Boolean);
  return { sheet, values, headerRow: headerIndex + 1, headers };
}

function readTable_(sheetName) {
  const meta = tableMeta_(sheetName);
  return meta.values.slice(meta.headerRow).filter((row) => row.some((cell) => cell !== "")).map((row) => {
    const record = {};
    meta.headers.forEach((header, index) => record[header] = row[index]);
    return record;
  });
}

function appendRecord_(sheetName, record) {
  const meta = tableMeta_(sheetName);
  meta.sheet.appendRow(meta.headers.map((header) => record[header] ?? ""));
}

function nextId_(sheetName, idColumn, prefix) {
  const maxNumber = readTable_(sheetName).reduce((max, row) => {
    const match = String(row[idColumn] || "").match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(6, "0")}`;
}

function requirePermission_(user, permission) {
  const role = (user && user.role) || "OPERATOR";
  if (!PERMISSIONS[role] || !PERMISSIONS[role].includes(permission)) throw new Error("Permission denied: " + permission);
}

function recommendLocation_(product) {
  const locations = readTable_("LOCATIONS");
  return locations.find((location) => location.current_status === "AVAILABLE" && (!product || !location.allowed_categories || location.allowed_categories === product.product_category)) || locations[0];
}

function updatePoLineReceived_(poLineId, qtyReceived) {
  const meta = tableMeta_("PURCHASE_ORDER_LINES");
  const idIndex = meta.headers.indexOf("po_line_id");
  const receivedIndex = meta.headers.indexOf("qty_received_total");
  const remainingIndex = meta.headers.indexOf("qty_remaining");
  const orderedIndex = meta.headers.indexOf("qty_ordered");
  const statusIndex = meta.headers.indexOf("line_status");
  for (let row = meta.headerRow + 1; row <= meta.sheet.getLastRow(); row++) {
    if (meta.sheet.getRange(row, idIndex + 1).getValue() === poLineId) {
      const ordered = Number(meta.sheet.getRange(row, orderedIndex + 1).getValue() || 0);
      const currentReceived = Number(meta.sheet.getRange(row, receivedIndex + 1).getValue() || 0);
      const newReceived = currentReceived + Number(qtyReceived || 0);
      const remaining = Math.max(0, ordered - newReceived);
      meta.sheet.getRange(row, receivedIndex + 1).setValue(newReceived);
      meta.sheet.getRange(row, remainingIndex + 1).setValue(remaining);
      meta.sheet.getRange(row, statusIndex + 1).setValue(remaining === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED");
      return;
    }
  }
}
