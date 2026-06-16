const SPREADSHEET_ID = "1XYaMXKGR5EG8VS38PPiHFNbtmwX5Ae6N33jLE72nxKE";

const ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  OPERATOR: "OPERATOR"
};

const PERMISSIONS = {
  ADMIN: [
    "products:create",
    "suppliers:create",
    "purchaseOrders:create",
    "purchaseOrders:actions",
    "receiving:create",
    "inventory:view",
    "scanner:lookup"
  ],
  MANAGER: [
    "products:create",
    "suppliers:create",
    "purchaseOrders:create",
    "purchaseOrders:actions",
    "receiving:create",
    "inventory:view",
    "scanner:lookup"
  ],
  OPERATOR: [
    "receiving:create",
    "inventory:view",
    "scanner:lookup"
  ]
};

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return handleApiRequest_(e.parameter.action, e.parameter.payload, e.parameter.callback);
  }
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("San Jose Operations")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const request = JSON.parse(e.postData.contents || "{}");
  return handleApiRequest_(request.action, JSON.stringify(request.payload || {}), null);
}

function handleApiRequest_(action, payloadText, callback) {
  try {
    const payload = payloadText ? JSON.parse(payloadText) : {};
    const routes = {
      getDashboard,
      listProducts,
      createProduct,
      listSuppliers,
      createSupplier,
      listLocations,
      listPurchaseOrders,
      getPurchaseOrderDetail,
      generatePurchaseOrderTemplate,
      createPurchaseOrder,
      purchaseOrderAction,
      receiveProduct,
      inventorySnapshot,
      getOperationalReports,
      lookupScan,
      matchAmazonPackageScan
    };
    if (!routes[action]) throw new Error("Unknown action: " + action);
    return json_({ ok: true, result: routes[action](payload) }, callback);
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) }, callback);
  }
}

function json_(value, callback) {
  const body = callback
    ? `${callback}(${JSON.stringify(value)});`
    : JSON.stringify(value);
  return ContentService
    .createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function getDashboard() {
  return {
    productCount: readTable_("PRODUCTS").length,
    supplierCount: readTable_("SUPPLIERS").length,
    openPoCount: readTable_("PURCHASE_ORDERS").filter((po) => po.po_status !== "COMPLETE").length,
    lotCount: readTable_("LOTS").length,
    movementCount: readTable_("INVENTORY_MOVEMENTS").length,
    pendingAmazonPackages: readTable_("AMAZON_PACKAGES").filter((pkg) => !pkg.matched_amazon_order_id).length
  };
}

function listProducts() {
  return readTable_("PRODUCTS");
}

function createProduct(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "products:create");

  const input = payload.input || {};
  if (!input.product_name) throw new Error("Product name is required.");

  const products = readTable_("PRODUCTS");
  const productId = input.product_id || nextId_("PRODUCTS", "product_id", "PROD");
  const stock = calculateStockLevels_(input);
  if (products.some((row) => row.product_id === productId)) {
    throw new Error("Product ID already exists.");
  }

  const record = {
    product_id: productId,
    product_name: input.product_name,
    product_category: input.product_category || "",
    default_unit: input.default_unit || "BOX",
    case_weight_lbs: Number(input.case_weight_lbs || 0),
    amazon_sku: input.amazon_sku || "",
    wholesale_sku: input.wholesale_sku || "",
    barcode_or_qr_value: input.barcode_or_qr_value || productId,
    min_stock_qty: stock.min_stock_qty,
    target_stock_qty: stock.target_stock_qty,
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
  return readTable_("SUPPLIERS").map((supplier) => ({
    ...supplier,
    lead_time_expected_days: calculateSupplierLeadTime_(supplier.supplier_id)
  }));
}

function listLocations() {
  return readTable_("LOCATIONS");
}

function createSupplier(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "suppliers:create");

  const input = payload.input || {};
  if (!input.supplier_name) throw new Error("Supplier name is required.");

  const suppliers = readTable_("SUPPLIERS");
  const supplierId = input.supplier_id || nextId_("SUPPLIERS", "supplier_id", "SUP");
  if (suppliers.some((row) => row.supplier_id === supplierId)) {
    throw new Error("Supplier ID already exists.");
  }

  const record = {
    supplier_id: supplierId,
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: calculateSupplierLeadTime_(supplierId),
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
    supplier: suppliers.find((supplier) => supplier.supplier_id === po.supplier_id) || null
  }));
}

function getPurchaseOrderDetail(payload) {
  payload = payload || {};
  const poId = payload.poId || payload.po_id;
  const products = readTable_("PRODUCTS");
  const po = readTable_("PURCHASE_ORDERS").find((row) => row.po_id === poId);
  if (!po) return null;

  const lines = readTable_("PURCHASE_ORDER_LINES")
    .filter((line) => line.po_id === poId)
    .map((line) => ({
      ...line,
      product: products.find((product) => product.product_id === line.product_id) || null
    }));

  return { po, lines };
}

function generatePurchaseOrderTemplate(payload) {
  const detail = getPurchaseOrderDetail(payload);
  if (!detail) throw new Error("Purchase order not found.");
  return {
    po: detail.po,
    lines: detail.lines.map((line) => ({
      ...line,
      qr_value: purchaseOrderQrValue_(line.product_id, line.qty_ordered, line.supplier_expected_lot_number)
    }))
  };
}

function createPurchaseOrder(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "purchaseOrders:create");

  const input = payload.input || {};
  if (!input.supplier_id) throw new Error("Supplier is required.");
  if (!input.product_id) throw new Error("Product is required.");

  const qty = Number(input.qty_ordered || 1);
  const unitCost = Number(input.unit_cost || 0);
  const poId = nextId_("PURCHASE_ORDERS", "po_id", "PO");
  const poLineId = nextId_("PURCHASE_ORDER_LINES", "po_line_id", "POL");

  const po = {
    po_id: poId,
    po_status: "DRAFT",
    supplier_id: input.supplier_id,
    created_by: user.user_id || user.role || "UNKNOWN",
    order_date: new Date(),
    expected_delivery_date: input.expected_delivery_date || "",
    actual_first_received_date: "",
    actual_completed_date: "",
    payment_terms: "Net 30",
    currency: "USD",
    subtotal_amount: qty * unitCost,
    tax_amount: 0,
    shipping_amount: 0,
    total_amount: qty * unitCost,
    recommendation_id: "",
    po_doc_url: "",
    po_pdf_url: "",
    email_status: "NOT_SENT",
    email_sent_at: "",
    printed_status: "NOT_PRINTED",
    printed_at: "",
    supplier_confirmation_status: "PENDING",
    supplier_confirmed_delivery_date: "",
    notes: input.notes || ""
  };

  const line = {
    po_line_id: poLineId,
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
    supplier_expected_lot_number: input.supplier_expected_lot_number || "",
    notes: input.notes || ""
  };

  appendRecord_("PURCHASE_ORDERS", po);
  appendRecord_("PURCHASE_ORDER_LINES", line);
  return po;
}

function purchaseOrderAction(payload) {
  const user = payload.user || {};
  requirePermission_(user, "purchaseOrders:actions");
  const poId = payload.poId;
  const action = payload.action;
  if (action !== "markSent") return { po_id: poId, action };

  const meta = tableMeta_("PURCHASE_ORDERS");
  const idIndex = meta.headers.indexOf("po_id");
  const statusIndex = meta.headers.indexOf("po_status");
  const emailStatusIndex = meta.headers.indexOf("email_status");
  for (let row = meta.headerRow + 1; row <= meta.sheet.getLastRow(); row++) {
    if (meta.sheet.getRange(row, idIndex + 1).getValue() === poId) {
      meta.sheet.getRange(row, statusIndex + 1).setValue("SENT");
      if (emailStatusIndex >= 0) meta.sheet.getRange(row, emailStatusIndex + 1).setValue("SENT");
      return { po_id: poId, po_status: "SENT", email_status: "SENT" };
    }
  }
  throw new Error("PO not found.");
}

function receiveProduct(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "receiving:create");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const input = payload.input || {};
    if (!input.po_id) throw new Error("Purchase order is required.");
    if (!input.po_line_id) throw new Error("Purchase order line is required.");

    const lines = readTable_("PURCHASE_ORDER_LINES");
    const line = lines.find((row) => row.po_line_id === input.po_line_id);
    if (!line) throw new Error("Purchase order line not found.");

    const qtyReceived = Number(input.qty_received || 0);
    const qtyDamaged = Number(input.qty_damaged || 0);
    if (qtyReceived <= 0) throw new Error("Quantity received must be greater than zero.");

    const product = readTable_("PRODUCTS").find((row) => row.product_id === line.product_id);
    const recommendedLocation = recommendLocation_(product);
    const confirmedLocationId = input.confirmed_location_id || recommendedLocation.location_id;
    if (!readTable_("LOCATIONS").some((row) => row.location_id === confirmedLocationId || row.qr_value === confirmedLocationId)) {
      throw new Error("Confirmed location was not found.");
    }

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
      received_by: user.user_id || user.role || "UNKNOWN",
      qty_received: qtyReceived,
      qty_damaged: qtyDamaged,
      qty_accepted: acceptedQty,
      unit_type: line.unit_type,
      quality_score: Number(input.quality_score || 5),
      product_accuracy_score: 5,
      over_under_status: "MATCH",
      recommended_location_id: recommendedLocation.location_id,
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
      expiration_date: "",
      qr_value: internalLotId,
      label_printed_status: "NOT_PRINTED",
      label_printed_at: "",
      created_at: new Date(),
      updated_at: new Date(),
      notes: "Created from Apps Script receiving flow."
    };

    const movement = {
      movement_id: movementId,
      movement_type: "RECEIVE",
      timestamp: new Date(),
      user_id: user.user_id || user.role || "UNKNOWN",
      product_id: line.product_id,
      internal_lot_id: internalLotId,
      package_id: "",
      qty_change: acceptedQty,
      unit_type: line.unit_type,
      from_location_id: "SUPPLIER",
      to_location_id: confirmedLocationId,
      related_po_id: input.po_id,
      related_receiving_id: receivingId,
      related_sales_order_id: "",
      related_pick_task_id: "",
      related_amazon_order_id: "",
      scan_code: input.scan_code || internalLotId,
      device_id: "WEB_APP",
      approval_status: "APPROVED",
      notes: input.notes || ""
    };

    appendRecord_("RECEIVING", receiving);
    appendRecord_("LOTS", lot);
    appendRecord_("INVENTORY_MOVEMENTS", movement);
    updatePoLineReceived_(input.po_line_id, qtyReceived);
    updatePoStatus_(input.po_id);

    return { receiving, lot, movement };
  } finally {
    lock.releaseLock();
  }
}

function lookupScan(payload) {
  payload = payload || {};
  const value = String(payload.scanValue || "").trim();
  if (!value) return null;

  const poQr = parsePurchaseOrderQr_(value);
  if (poQr) return { type: "PURCHASE_ORDER_QR", record: poQr };

  const product = readTable_("PRODUCTS").find((row) =>
    [row.product_id, row.barcode_or_qr_value, row.amazon_sku, row.wholesale_sku].includes(value)
  );
  if (product) return { type: "PRODUCT", record: product };

  const location = readTable_("LOCATIONS").find((row) =>
    [row.location_id, row.qr_value].includes(value)
  );
  if (location) return { type: "LOCATION", record: location };

  const lot = readTable_("LOTS").find((row) =>
    [row.internal_lot_id, row.qr_value, row.supplier_lot_number].includes(value)
  );
  if (lot) return { type: "LOT", record: lot };

  const pkg = readTable_("AMAZON_PACKAGES").find((row) =>
    [row.package_id, row.package_qr_value].includes(value)
  );
  if (pkg) return { type: "AMAZON_PACKAGE", record: pkg };

  return null;
}

function matchAmazonPackageScan(payload) {
  const scanValue = String(payload.scanValue || "").trim();
  const pkg = readTable_("AMAZON_PACKAGES").find((row) =>
    [row.package_id, row.package_qr_value].includes(scanValue)
  );
  if (!pkg) return { match_status: "NOT_FOUND", message: "Package scan was not found." };

  const record = {
    scan_match_id: nextId_("AMAZON_SCAN_MATCHES", "scan_match_id", "AMZSCAN"),
    scanned_at: new Date(),
    scanned_by: "GITHUB_PAGES",
    device_id: "WEB_APP",
    package_id: pkg.package_id,
    amazon_order_id: pkg.matched_amazon_order_id || "",
    amazon_order_item_id: pkg.matched_amazon_order_item_id || "",
    amazon_sku: pkg.amazon_sku,
    product_id: pkg.product_id,
    match_status: "PACKAGE_FOUND",
    match_confidence: 0.75,
    exception_code: "",
    related_pick_task_id: "",
    related_movement_id: "",
    notes: "Matched by GitHub Pages prototype."
  };
  appendRecord_("AMAZON_SCAN_MATCHES", record);
  return record;
}

function inventorySnapshot() {
  const movements = readTable_("INVENTORY_MOVEMENTS");
  const products = readTable_("PRODUCTS");
  const lots = readTable_("LOTS");
  const grouped = {};

  movements.forEach((movement) => {
    const locationId = movement.to_location_id || movement.from_location_id || "";
    const key = [movement.product_id, movement.internal_lot_id, locationId].join("|");
    if (!grouped[key]) {
      grouped[key] = {
        product_id: movement.product_id,
        internal_lot_id: movement.internal_lot_id,
        location_id: locationId,
        qty: 0,
        unit_type: movement.unit_type
      };
    }
    grouped[key].qty += Number(movement.qty_change || 0);
  });

  return Object.keys(grouped).map((key) => ({
    ...grouped[key],
    product: products.find((row) => row.product_id === grouped[key].product_id) || null,
    lot: lots.find((row) => row.internal_lot_id === grouped[key].internal_lot_id) || null
  }));
}

function getOperationalReports() {
  const products = readTable_("PRODUCTS");
  const suppliers = readTable_("SUPPLIERS");
  const purchaseOrders = readTable_("PURCHASE_ORDERS");
  const purchaseOrderLines = readTable_("PURCHASE_ORDER_LINES");
  const receiving = readTable_("RECEIVING");
  const lots = readTable_("LOTS");
  const movements = readTable_("INVENTORY_MOVEMENTS");
  const snapshots = buildInventorySnapshot_(products, lots, movements);
  const leadTimeBySupplier = buildLeadTimeStatsBySupplier_(purchaseOrders);
  const planningByProduct = products.map((product) =>
    buildProductPlanning_(product, suppliers, purchaseOrders, purchaseOrderLines, movements, snapshots, leadTimeBySupplier)
  );

  return {
    calculated_at: new Date(),
    supplierAnalytics: buildSupplierAnalytics_(suppliers, products, purchaseOrders, purchaseOrderLines, receiving, leadTimeBySupplier),
    inventoryPlanning: planningByProduct,
    inventorySnapshot: snapshots,
    recommendations: buildRecommendations_(planningByProduct)
  };
}

function testCreateProduct() {
  return createProduct({
    user: { user_id: "ADMIN", role: "ADMIN" },
    input: {
      product_name: "TEST PRODUCT FROM APPS SCRIPT",
      product_category: "Packaging",
      default_unit: "BOX",
      barcode_or_qr_value: "TEST-PRODUCT-QR",
      notes: "Created from testCreateProduct."
    }
  });
}

function testCreateSupplier() {
  return createSupplier({
    user: { user_id: "ADMIN", role: "ADMIN" },
    input: {
      supplier_name: "Test Supplier From Apps Script",
      contact_name: "Test Contact",
      email: "test@example.com",
      phone: "555-000-0000",
      notes: "Created from testCreateSupplier."
    }
  });
}

function testLookupScan() {
  return lookupScan({
    user: { user_id: "ADMIN", role: "ADMIN" },
    scanValue: "PROD-001"
  });
}

function spreadsheet_() {
  if (SPREADSHEET_ID === "PASTE_YOUR_SPREADSHEET_ID_HERE") {
    throw new Error("Set SPREADSHEET_ID in Code.gs first.");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(sheetName) {
  const sheet = spreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Missing sheet: " + sheetName);
  return sheet;
}

function tableMeta_(sheetName) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const headerIndex = values.findIndex((row) =>
    row.some((cell) => String(cell || "").trim().endsWith("_id"))
  );
  if (headerIndex < 0) throw new Error("Could not find header row for " + sheetName);
  const headers = values[headerIndex].map((cell) => String(cell || "").trim()).filter(Boolean);
  return { sheet, values, headerRow: headerIndex + 1, headers };
}

function readTable_(sheetName) {
  const meta = tableMeta_(sheetName);
  return meta.values.slice(meta.headerRow)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const record = {};
      meta.headers.forEach((header, index) => {
        record[header] = row[index];
      });
      return record;
    });
}

function appendRecord_(sheetName, record) {
  const meta = tableMeta_(sheetName);
  meta.sheet.appendRow(meta.headers.map((header) => record[header] ?? ""));
}

function nextId_(sheetName, idColumn, prefix) {
  const rows = readTable_(sheetName);
  const maxNumber = rows.reduce((max, row) => {
    const match = String(row[idColumn] || "").match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(6, "0")}`;
}

function requirePermission_(user, permission) {
  const role = user.role || "OPERATOR";
  if (!PERMISSIONS[role] || !PERMISSIONS[role].includes(permission)) {
    throw new Error("Permission denied: " + permission);
  }
}

function recommendLocation_(product) {
  const locations = readTable_("LOCATIONS");
  return locations.find((location) =>
    location.current_status === "AVAILABLE"
    && (!product || !location.allowed_categories || location.allowed_categories === product.product_category)
  ) || locations[0];
}

function updatePoLineReceived_(poLineId, qtyReceived) {
  const meta = tableMeta_("PURCHASE_ORDER_LINES");
  const idIndex = meta.headers.indexOf("po_line_id");
  const receivedIndex = meta.headers.indexOf("qty_received_total");
  const remainingIndex = meta.headers.indexOf("qty_remaining");
  const orderedIndex = meta.headers.indexOf("qty_ordered");
  const statusIndex = meta.headers.indexOf("line_status");

  for (let r = meta.headerRow + 1; r <= meta.sheet.getLastRow(); r++) {
    if (meta.sheet.getRange(r, idIndex + 1).getValue() === poLineId) {
      const ordered = Number(meta.sheet.getRange(r, orderedIndex + 1).getValue() || 0);
      const currentReceived = Number(meta.sheet.getRange(r, receivedIndex + 1).getValue() || 0);
      const newReceived = currentReceived + Number(qtyReceived || 0);
      const remaining = Math.max(0, ordered - newReceived);
      meta.sheet.getRange(r, receivedIndex + 1).setValue(newReceived);
      meta.sheet.getRange(r, remainingIndex + 1).setValue(remaining);
      meta.sheet.getRange(r, statusIndex + 1).setValue(remaining === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED");
      return;
    }
  }
}

function updatePoStatus_(poId) {
  const lines = readTable_("PURCHASE_ORDER_LINES").filter((line) => line.po_id === poId);
  const allReceived = lines.length > 0 && lines.every((line) => Number(line.qty_remaining || 0) === 0);
  const status = allReceived ? "COMPLETE" : "PARTIALLY_RECEIVED";

  const meta = tableMeta_("PURCHASE_ORDERS");
  const idIndex = meta.headers.indexOf("po_id");
  const statusIndex = meta.headers.indexOf("po_status");
  for (let r = meta.headerRow + 1; r <= meta.sheet.getLastRow(); r++) {
    if (meta.sheet.getRange(r, idIndex + 1).getValue() === poId) {
      meta.sheet.getRange(r, statusIndex + 1).setValue(status);
      return;
    }
  }
}

function purchaseOrderQrValue_(productId, qty, supplierLotNumber) {
  return [productId, "QTY:" + Number(qty || 0), "SUPLOT:" + (supplierLotNumber || "PENDING")].join("|");
}

function parsePurchaseOrderQr_(value) {
  const parts = String(value || "").split("|").map((part) => part.trim());
  if (parts.length < 2 || parts[1].indexOf("QTY:") !== 0) return null;
  const qtyPart = parts.find((part) => part.indexOf("QTY:") === 0) || "";
  const lotPart = parts.find((part) => part.indexOf("SUPLOT:") === 0) || "";
  return {
    product_id: parts[0],
    qty: Number(qtyPart.replace("QTY:", "") || 0),
    supplier_lot_number: lotPart.replace("SUPLOT:", "")
  };
}

function calculateStockLevels_(input) {
  const velocity = String(input.velocity_class || "").toUpperCase();
  const category = String(input.product_category || "").toUpperCase();
  const target = velocity === "FAST"
    ? 100
    : category.indexOf("PACK") >= 0
      ? 50
      : 25;
  return {
    min_stock_qty: Math.max(1, Math.ceil(target * 0.25)),
    target_stock_qty: Math.max(5, target)
  };
}

function calculateSupplierLeadTime_(supplierId) {
  if (!supplierId) return 5;
  const leadTimes = readTable_("PURCHASE_ORDERS")
    .filter((po) => po.supplier_id === supplierId && po.order_date && po.actual_completed_date)
    .map((po) => daysBetween_(po.order_date, po.actual_completed_date))
    .filter((days) => isFinite(days) && days >= 0);
  if (!leadTimes.length) return 5;
  return Math.round(leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length);
}

function daysBetween_(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NaN;
  return (endDate.getTime() - startDate.getTime()) / 86400000;
}

function buildSupplierAnalytics_(suppliers, products, purchaseOrders, purchaseOrderLines, receiving, leadTimeBySupplier) {
  const totalSpend = purchaseOrders.reduce((sum, po) => sum + Number(po.total_amount || po.subtotal_amount || 0), 0);
  return suppliers.map((supplier) => {
    const supplierOrders = purchaseOrders.filter((po) => po.supplier_id === supplier.supplier_id);
    const supplierLines = purchaseOrderLines.filter((line) => line.supplier_id === supplier.supplier_id);
    const supplierReceiving = receiving.filter((row) => row.supplier_id === supplier.supplier_id);
    const boughtProductIds = unique_(supplierLines.map((line) => line.product_id).filter(Boolean));
    const qualityScores = supplierReceiving.map((row) => Number(row.quality_score || 0)).filter((score) => score > 0);
    const productAccuracyScores = supplierReceiving.map((row) => Number(row.product_accuracy_score || 0)).filter((score) => score > 0);
    const quantityAccuracyValues = supplierLines.map((line) => {
      const ordered = Number(line.qty_ordered || 0);
      const received = Number(line.qty_received_total || 0);
      if (ordered <= 0) return null;
      return Math.max(0, 1 - Math.abs(ordered - received) / ordered) * 100;
    }).filter((value) => value !== null);
    const spend = supplierOrders.reduce((sum, po) => sum + Number(po.total_amount || po.subtotal_amount || 0), 0);
    const lead = leadTimeBySupplier[supplier.supplier_id] || fallbackLeadTimeStats_();
    return {
      supplier_id: supplier.supplier_id,
      supplier_name: supplier.supplier_name,
      email: supplier.email || "",
      phone: supplier.phone || "",
      products_bought: boughtProductIds.map((productId) => {
        const product = products.find((item) => item.product_id === productId);
        return product ? product.product_name : productId;
      }).join(", "),
      product_count: boughtProductIds.length,
      total_orders: supplierOrders.length,
      completed_orders: supplierOrders.filter((po) => po.actual_completed_date || po.actual_first_received_date || po.po_status === "COMPLETE").length,
      total_purchase_amount: round_(spend, 2),
      spend_share_percent: totalSpend > 0 ? round_(spend / totalSpend * 100, 1) : 0,
      avg_lead_time_days: lead.average,
      std_lead_time_days: lead.stdDev,
      lead_time_samples: lead.count,
      avg_quality_score: round_(average_(qualityScores), 2),
      quality_percent: qualityScores.length ? round_(average_(qualityScores) / 5 * 100, 1) : 0,
      product_accuracy_percent: productAccuracyScores.length ? round_(average_(productAccuracyScores) / 5 * 100, 1) : 0,
      quantity_accuracy_percent: quantityAccuracyValues.length ? round_(average_(quantityAccuracyValues), 1) : 0,
      receiving_count: supplierReceiving.length
    };
  });
}

function buildProductPlanning_(product, suppliers, purchaseOrders, purchaseOrderLines, movements, snapshots, leadTimeBySupplier) {
  const usage = buildDailyUsageStats_(product.product_id, movements);
  const supplierId = chooseSupplierForProduct_(product.product_id, purchaseOrderLines);
  const supplier = suppliers.find((item) => item.supplier_id === supplierId) || {};
  const lead = leadTimeBySupplier[supplierId] || fallbackLeadTimeStats_();
  const currentQty = snapshots
    .filter((row) => row.product_id === product.product_id)
    .reduce((sum, row) => sum + Number(row.current_qty || 0), 0);
  const velocityDays = velocityDays_(product.velocity_class);
  const demandDuringLeadTime = usage.averageDailyUsage * lead.average;
  const safetyStock = 1.65 * Math.sqrt(
    (lead.average * Math.pow(usage.stdDailyUsage, 2))
    + (Math.pow(usage.averageDailyUsage, 2) * Math.pow(lead.stdDev, 2))
  );
  const reorderPoint = demandDuringLeadTime + safetyStock;
  const targetStock = Math.max(reorderPoint, usage.averageDailyUsage * velocityDays);

  return {
    product_id: product.product_id,
    product_name: product.product_name,
    velocity_class: product.velocity_class || "MEDIUM",
    supplier_id: supplierId || "",
    supplier_name: supplier.supplier_name || "",
    current_qty: round_(currentQty, 2),
    average_daily_usage: round_(usage.averageDailyUsage, 2),
    std_daily_usage: round_(usage.stdDailyUsage, 2),
    usage_days: usage.days,
    avg_lead_time_days: lead.average,
    std_lead_time_days: lead.stdDev,
    demand_during_lead_time: round_(demandDuringLeadTime, 2),
    safety_stock: round_(safetyStock, 2),
    reorder_point: Math.ceil(reorderPoint),
    target_stock_level: Math.ceil(targetStock),
    recommended_order_qty: Math.max(0, Math.ceil(targetStock - currentQty)),
    status: currentQty <= reorderPoint ? "REORDER" : currentQty < targetStock ? "WATCH" : "OK",
    notes: usage.samples ? "Calculated from movement history." : "No usage history yet; using zero demand fallback."
  };
}

function buildInventorySnapshot_(products, lots, movements) {
  const grouped = {};
  movements.forEach((movement) => {
    const qty = Number(movement.qty_change || 0);
    const locationId = movement.to_location_id || movement.from_location_id || "";
    const key = [movement.product_id, movement.internal_lot_id, locationId].join("|");
    if (!grouped[key]) {
      grouped[key] = {
        product_id: movement.product_id,
        internal_lot_id: movement.internal_lot_id,
        location_id: locationId,
        current_qty: 0,
        unit_type: movement.unit_type || ""
      };
    }
    grouped[key].current_qty += qty;
  });

  return Object.keys(grouped)
    .map((key) => {
      const row = grouped[key];
      const product = products.find((item) => item.product_id === row.product_id) || {};
      const lot = lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
      const daysSinceReceived = lot.received_date ? Math.max(0, Math.floor(daysBetween_(lot.received_date, new Date()))) : "";
      return {
        ...row,
        current_qty: round_(row.current_qty, 2),
        product_name: product.product_name || row.product_id,
        supplier_id: lot.supplier_id || "",
        days_since_received: daysSinceReceived,
        inventory_status: row.current_qty > 0 ? "AVAILABLE" : "EMPTY",
        recommended_action: row.current_qty > 0 ? "Use FIFO before newer lots." : "No stock at this location."
      };
    })
    .filter((row) => Number(row.current_qty || 0) !== 0);
}

function buildRecommendations_(planningRows) {
  return planningRows
    .filter((row) => row.status !== "OK" || Number(row.recommended_order_qty || 0) > 0)
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
      reason_text: row.status === "REORDER"
        ? "Current stock is at or below reorder point."
        : "Current stock is below target stock level."
    }));
}

function buildDailyUsageStats_(productId, movements) {
  const usageByDate = {};
  const usageMovements = movements.filter((movement) => {
    if (movement.product_id !== productId) return false;
    const qty = Number(movement.qty_change || 0);
    const type = String(movement.movement_type || "").toUpperCase();
    return qty < 0 || ["SALE", "SHIP", "PICK", "PACK", "USE", "ADJUST_OUT"].includes(type);
  });
  usageMovements.forEach((movement) => {
    const dateKey = dateKey_(movement.timestamp);
    if (!dateKey) return;
    usageByDate[dateKey] = (usageByDate[dateKey] || 0) + Math.abs(Number(movement.qty_change || 0));
  });
  const dates = Object.keys(usageByDate).sort();
  if (!dates.length) {
    return { averageDailyUsage: 0, stdDailyUsage: 0, days: 0, samples: 0 };
  }
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const totalDays = Math.max(1, Math.floor(daysBetween_(start, end)) + 1);
  const dailyValues = [];
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(start.getTime() + i * 86400000);
    dailyValues.push(usageByDate[dateKey_(day)] || 0);
  }
  return {
    averageDailyUsage: average_(dailyValues),
    stdDailyUsage: standardDeviation_(dailyValues),
    days: totalDays,
    samples: usageMovements.length
  };
}

function buildLeadTimeStatsBySupplier_(purchaseOrders) {
  const bySupplier = {};
  purchaseOrders.forEach((po) => {
    const supplierId = po.supplier_id;
    const orderDate = po.order_date;
    const receivedDate = po.actual_first_received_date || po.actual_completed_date;
    if (!supplierId || !orderDate || !receivedDate) return;
    const days = daysBetween_(orderDate, receivedDate);
    if (!isFinite(days) || days < 0) return;
    if (!bySupplier[supplierId]) bySupplier[supplierId] = [];
    bySupplier[supplierId].push(days);
  });
  const stats = {};
  Object.keys(bySupplier).forEach((supplierId) => {
    stats[supplierId] = {
      average: round_(average_(bySupplier[supplierId]), 2),
      stdDev: round_(standardDeviation_(bySupplier[supplierId]), 2),
      count: bySupplier[supplierId].length
    };
  });
  return stats;
}

function chooseSupplierForProduct_(productId, purchaseOrderLines) {
  const counts = {};
  purchaseOrderLines
    .filter((line) => line.product_id === productId && line.supplier_id)
    .forEach((line) => {
      counts[line.supplier_id] = (counts[line.supplier_id] || 0) + 1;
    });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
}

function fallbackLeadTimeStats_() {
  return { average: 5, stdDev: 0, count: 0 };
}

function velocityDays_(velocityClass) {
  const value = String(velocityClass || "").toUpperCase();
  if (value === "FAST") return 10;
  if (value === "SLOW") return 60;
  return 40;
}

function average_(values) {
  const clean = values.map(Number).filter((value) => isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function standardDeviation_(values) {
  const clean = values.map(Number).filter((value) => isFinite(value));
  if (clean.length < 2) return 0;
  const avg = average_(clean);
  const variance = clean.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

function dateKey_(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function unique_(values) {
  return Array.from(new Set(values));
}

function round_(value, decimals) {
  const n = Number(value || 0);
  const factor = Math.pow(10, decimals || 0);
  return Math.round(n * factor) / factor;
}
