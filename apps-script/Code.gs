const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";

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
    "inventory:adjust",
    "scanner:lookup"
  ],
  MANAGER: [
    "products:create",
    "suppliers:create",
    "purchaseOrders:create",
    "purchaseOrders:actions",
    "receiving:create",
    "inventory:view",
    "inventory:adjust",
    "scanner:lookup"
  ],
  OPERATOR: [
    "receiving:create",
    "inventory:view",
    "inventory:adjust",
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
      recordInventoryMovement,
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
  ensureTableColumns_("PRODUCTS", ["base_unit", "units_per_purchase_unit", "can_break_case"]);
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
    base_unit: input.base_unit || input.default_unit || "BOX",
    units_per_purchase_unit: Number(input.units_per_purchase_unit || input.case_weight_lbs || 1),
    can_break_case: input.can_break_case || "FALSE",
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
  const product = readTable_("PRODUCTS").find((row) => row.product_id === input.product_id) || {};
  const unitsPerPurchaseUnit = Number(input.units_per_purchase_unit || product.units_per_purchase_unit || product.case_weight_lbs || 1) || 1;
  const baseUnit = input.base_unit || product.base_unit || input.unit_type || product.default_unit || "EACH";
  ensureTableColumns_("PURCHASE_ORDER_LINES", ["base_unit", "units_per_purchase_unit", "expected_base_qty", "case_weight_lbs"]);
  const poId = nextId_("PURCHASE_ORDERS", "po_id", "PO");
  const poLineId = nextId_("PURCHASE_ORDER_LINES", "po_line_id", "POL");
  const supplierLotNumber = input.supplier_expected_lot_number || supplierLotNumber_(input.supplier_id, input.product_id);

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
    unit_type: input.unit_type || product.default_unit || "BOX",
    base_unit: baseUnit,
    units_per_purchase_unit: unitsPerPurchaseUnit,
    expected_base_qty: qty * unitsPerPurchaseUnit,
    case_weight_lbs: Number(input.case_weight_lbs || product.case_weight_lbs || 0),
    unit_cost: unitCost,
    currency: "USD",
    line_total: qty * unitCost,
    supplier_expected_lot_number: supplierLotNumber,
    notes: input.notes || ""
  };

  appendRecord_("PURCHASE_ORDERS", po);
  appendRecord_("PURCHASE_ORDER_LINES", line);
  return po;
}

function supplierLotNumber_(supplierId, productId) {
  const supplier = String(supplierId || "SUP").replace(/[^A-Z0-9]/gi, "").slice(-4).toUpperCase();
  const product = String(productId || "PROD").replace(/[^A-Z0-9]/gi, "").slice(-4).toUpperCase();
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMdd");
  return `${supplier}-${product}-${date}`;
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
    const unitsPerPurchaseUnit = Number(line.units_per_purchase_unit || (product && (product.units_per_purchase_unit || product.case_weight_lbs)) || 1) || 1;
    const baseUnit = line.base_unit || (product && product.base_unit) || line.unit_type;
    const recommendedLocation = recommendLocation_(product);
    const confirmedLocationId = input.confirmed_location_id || recommendedLocation.location_id;
    if (!readTable_("LOCATIONS").some((row) => row.location_id === confirmedLocationId || row.qr_value === confirmedLocationId)) {
      throw new Error("Confirmed location was not found.");
    }

    const internalLotId = input.internal_lot_id || nextId_("LOTS", "internal_lot_id", "LOT");
    const receivingId = nextId_("RECEIVING", "receiving_id", "RCV");
    const movementId = nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV");
    const acceptedQty = qtyReceived - qtyDamaged;
    const acceptedBaseQty = Number(input.actual_base_qty || 0) > 0
      ? Number(input.actual_base_qty)
      : acceptedQty * unitsPerPurchaseUnit;
    ensureTableColumns_("RECEIVING", ["base_unit", "units_per_purchase_unit", "qty_accepted_base", "pallet_count"]);
    ensureTableColumns_("LOTS", ["purchase_qty_received", "purchase_unit_type", "pallet_count"]);

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
      base_unit: baseUnit,
      units_per_purchase_unit: unitsPerPurchaseUnit,
      qty_accepted_base: acceptedBaseQty,
      pallet_count: Number(input.pallet_count || 0),
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
      original_qty: acceptedBaseQty,
      current_qty_script: acceptedBaseQty,
      unit_type: baseUnit,
      purchase_qty_received: qtyReceived,
      purchase_unit_type: line.unit_type,
      pallet_count: Number(input.pallet_count || 0),
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
      qty_change: acceptedBaseQty,
      unit_type: baseUnit,
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

function recordInventoryMovement(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "inventory:adjust");

  const input = payload.input || {};
  const lotKey = String(input.internal_lot_id || "").trim();
  if (!lotKey) throw new Error("Lot is required.");

  const lots = readTable_("LOTS");
  const lot = lots.find((row) =>
    [row.internal_lot_id, row.qr_value, row.supplier_lot_number].includes(lotKey)
  );
  if (!lot) throw new Error("Lot was not found.");

  const qty = Number(input.qty || 0);
  if (qty <= 0) throw new Error("Quantity must be greater than zero.");

  const movementType = String(input.movement_type || "SALE").toUpperCase();
  const direction = movementType === "ADJUST_IN" ? 1 : -1;
  const qtyChange = qty * direction;
  const movement = {
    movement_id: nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV"),
    movement_type: movementType,
    timestamp: new Date(),
    user_id: user.user_id || user.role || "UNKNOWN",
    product_id: lot.product_id,
    internal_lot_id: lot.internal_lot_id,
    package_id: "",
    qty_change: qtyChange,
    unit_type: input.unit_type || lot.unit_type,
    from_location_id: lot.current_location_id,
    to_location_id: direction > 0 ? lot.current_location_id : "OUTBOUND",
    related_po_id: lot.po_id || "",
    related_receiving_id: "",
    related_sales_order_id: "",
    related_pick_task_id: "",
    related_amazon_order_id: "",
    scan_code: lotKey,
    device_id: "WEB_APP",
    approval_status: "APPROVED",
    notes: input.notes || ""
  };

  appendRecord_("INVENTORY_MOVEMENTS", movement);
  updateLotQuantity_(lot.internal_lot_id, qtyChange);
  return movement;
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

function seedMockOperationalData() {
  [
    "INVENTORY_MOVEMENTS",
    "RECEIVING",
    "LOTS",
    "PURCHASE_ORDER_LINES",
    "PURCHASE_ORDERS",
    "PRODUCTS",
    "SUPPLIERS",
    "LOCATIONS",
    "AMAZON_PACKAGES",
    "AMAZON_SCAN_MATCHES"
  ].forEach(clearTable_);

  const suppliers = [
    { supplier_id: "SUP-001", supplier_name: "Pacific Packaging Co.", contact_name: "Maria Lopez", email: "orders@pacpack.example", phone: "408-555-0101", address: "1200 Berryessa Rd, San Jose, CA", payment_terms: "Net 30", default_currency: "USD", lead_time_expected_days: 5, is_active: true, notes: "Primary packaging supplier." },
    { supplier_id: "SUP-002", supplier_name: "Bay Area Ingredients", contact_name: "Owen Chen", email: "sales@bayingredients.example", phone: "408-555-0102", address: "88 Industrial Way, Fremont, CA", payment_terms: "Net 15", default_currency: "USD", lead_time_expected_days: 6, is_active: true, notes: "Bulk ingredient supplier." },
    { supplier_id: "SUP-003", supplier_name: "Golden State Goods", contact_name: "Nina Patel", email: "nina@gsgoods.example", phone: "408-555-0103", address: "455 Market St, San Jose, CA", payment_terms: "Net 30", default_currency: "USD", lead_time_expected_days: 8, is_active: true, notes: "Seasonal product supplier." },
    { supplier_id: "SUP-004", supplier_name: "South Bay Wholesale", contact_name: "Luis Romero", email: "orders@southbaywholesale.example", phone: "408-555-0104", address: "90 Trimble Rd, San Jose, CA", payment_terms: "Net 30", default_currency: "USD", lead_time_expected_days: 4, is_active: true, notes: "Fast replenishment supplier." },
    { supplier_id: "SUP-005", supplier_name: "Sierra Label & Supply", contact_name: "Avery Brooks", email: "support@sierralabel.example", phone: "408-555-0105", address: "2100 Zanker Rd, San Jose, CA", payment_terms: "Net 45", default_currency: "USD", lead_time_expected_days: 10, is_active: true, notes: "Labels and printed materials." }
  ];

  const products = [
    { product_id: "PROD-001", product_name: "Mini Tornillo", product_category: "Packaging", default_unit: "BOX", case_weight_lbs: 12, amazon_sku: "AMZ-MINI-TORN", wholesale_sku: "WH-MINI-TORN", barcode_or_qr_value: "PROD-001", min_stock_qty: 20, target_stock_qty: 80, velocity_class: "FAST", storage_zone_preference: "B", is_active: true, notes: "Fast moving packaging item." },
    { product_id: "PROD-002", product_name: "Almond Flour 25 lb", product_category: "Ingredients", default_unit: "BAG", case_weight_lbs: 25, amazon_sku: "AMZ-ALM-FLR", wholesale_sku: "WH-ALM-FLR", barcode_or_qr_value: "PROD-002", min_stock_qty: 15, target_stock_qty: 90, velocity_class: "MEDIUM", storage_zone_preference: "A", is_active: true, notes: "Dry ingredient." },
    { product_id: "PROD-003", product_name: "Retail Label Roll", product_category: "Labels", default_unit: "ROLL", case_weight_lbs: 8, amazon_sku: "AMZ-LABEL-ROLL", wholesale_sku: "WH-LABEL-ROLL", barcode_or_qr_value: "PROD-003", min_stock_qty: 10, target_stock_qty: 60, velocity_class: "MEDIUM", storage_zone_preference: "C", is_active: true, notes: "Product label roll." },
    { product_id: "PROD-004", product_name: "Shipping Carton Small", product_category: "Packaging", default_unit: "BUNDLE", case_weight_lbs: 15, amazon_sku: "AMZ-CARTON-S", wholesale_sku: "WH-CARTON-S", barcode_or_qr_value: "PROD-004", min_stock_qty: 25, target_stock_qty: 120, velocity_class: "FAST", storage_zone_preference: "B", is_active: true, notes: "Small shipping cartons." },
    { product_id: "PROD-005", product_name: "Organic Dried Mango", product_category: "Finished Goods", default_unit: "CASE", case_weight_lbs: 18, amazon_sku: "AMZ-MANGO-ORG", wholesale_sku: "WH-MANGO-ORG", barcode_or_qr_value: "PROD-005", min_stock_qty: 8, target_stock_qty: 45, velocity_class: "SLOW", storage_zone_preference: "D", is_active: true, notes: "Slow moving seasonal item." },
    { product_id: "PROD-006", product_name: "Thermal Receipt Paper", product_category: "Supplies", default_unit: "CASE", case_weight_lbs: 10, amazon_sku: "AMZ-THERM-PAPER", wholesale_sku: "WH-THERM-PAPER", barcode_or_qr_value: "PROD-006", min_stock_qty: 6, target_stock_qty: 30, velocity_class: "SLOW", storage_zone_preference: "C", is_active: true, notes: "Operational supply." }
  ];

  const locations = [
    { location_id: "LOC-A-01-01", zone: "A", aisle: "01", rack: "01", level: "01", bin: "01", location_type: "DRY_STORAGE", capacity_units: 180, capacity_weight_lbs: 2500, current_status: "AVAILABLE", allowed_categories: "Ingredients", priority_rank: 1, is_active: true, qr_value: "LOC-A-01-01", notes: "Dry ingredient storage." },
    { location_id: "LOC-B-02-01", zone: "B", aisle: "02", rack: "01", level: "01", bin: "01", location_type: "PACKAGING", capacity_units: 220, capacity_weight_lbs: 1800, current_status: "AVAILABLE", allowed_categories: "Packaging", priority_rank: 1, is_active: true, qr_value: "LOC-B-02-01", notes: "Packaging forward pick." },
    { location_id: "LOC-C-01-02", zone: "C", aisle: "01", rack: "02", level: "01", bin: "02", location_type: "SUPPLIES", capacity_units: 120, capacity_weight_lbs: 900, current_status: "AVAILABLE", allowed_categories: "Labels", priority_rank: 2, is_active: true, qr_value: "LOC-C-01-02", notes: "Labels and supplies." },
    { location_id: "LOC-D-03-01", zone: "D", aisle: "03", rack: "01", level: "01", bin: "01", location_type: "FINISHED_GOODS", capacity_units: 160, capacity_weight_lbs: 1700, current_status: "AVAILABLE", allowed_categories: "Finished Goods", priority_rank: 1, is_active: true, qr_value: "LOC-D-03-01", notes: "Finished goods reserve." }
  ];

  const purchaseOrders = [
    { po_id: "PO-000001", po_status: "COMPLETE", supplier_id: "SUP-001", created_by: "ADMIN", order_date: new Date("2026-05-20"), expected_delivery_date: new Date("2026-05-26"), actual_first_received_date: new Date("2026-05-25"), actual_completed_date: new Date("2026-05-25"), payment_terms: "Net 30", currency: "USD", subtotal_amount: 640, tax_amount: 0, shipping_amount: 45, total_amount: 685, recommendation_id: "", po_doc_url: "", po_pdf_url: "", email_status: "SENT", email_sent_at: new Date("2026-05-20"), printed_status: "PRINTED", printed_at: new Date("2026-05-20"), supplier_confirmation_status: "CONFIRMED", supplier_confirmed_delivery_date: new Date("2026-05-25"), notes: "Completed mock PO." },
    { po_id: "PO-000002", po_status: "COMPLETE", supplier_id: "SUP-002", created_by: "ADMIN", order_date: new Date("2026-05-23"), expected_delivery_date: new Date("2026-05-30"), actual_first_received_date: new Date("2026-05-31"), actual_completed_date: new Date("2026-05-31"), payment_terms: "Net 15", currency: "USD", subtotal_amount: 1125, tax_amount: 0, shipping_amount: 70, total_amount: 1195, recommendation_id: "", po_doc_url: "", po_pdf_url: "", email_status: "SENT", email_sent_at: new Date("2026-05-23"), printed_status: "PRINTED", printed_at: new Date("2026-05-23"), supplier_confirmation_status: "CONFIRMED", supplier_confirmed_delivery_date: new Date("2026-05-31"), notes: "Completed mock PO." },
    { po_id: "PO-000003", po_status: "COMPLETE", supplier_id: "SUP-005", created_by: "MANAGER", order_date: new Date("2026-05-28"), expected_delivery_date: new Date("2026-06-07"), actual_first_received_date: new Date("2026-06-08"), actual_completed_date: new Date("2026-06-08"), payment_terms: "Net 45", currency: "USD", subtotal_amount: 420, tax_amount: 0, shipping_amount: 35, total_amount: 455, recommendation_id: "", po_doc_url: "", po_pdf_url: "", email_status: "SENT", email_sent_at: new Date("2026-05-28"), printed_status: "PRINTED", printed_at: new Date("2026-05-28"), supplier_confirmation_status: "CONFIRMED", supplier_confirmed_delivery_date: new Date("2026-06-08"), notes: "Completed mock PO." },
    { po_id: "PO-000004", po_status: "SENT", supplier_id: "SUP-004", created_by: "ADMIN", order_date: new Date("2026-06-10"), expected_delivery_date: new Date("2026-06-15"), actual_first_received_date: "", actual_completed_date: "", payment_terms: "Net 30", currency: "USD", subtotal_amount: 720, tax_amount: 0, shipping_amount: 50, total_amount: 770, recommendation_id: "", po_doc_url: "", po_pdf_url: "", email_status: "SENT", email_sent_at: new Date("2026-06-10"), printed_status: "PRINTED", printed_at: new Date("2026-06-10"), supplier_confirmation_status: "PENDING", supplier_confirmed_delivery_date: "", notes: "Pending mock PO." },
    { po_id: "PO-000005", po_status: "DRAFT", supplier_id: "SUP-003", created_by: "MANAGER", order_date: new Date("2026-06-14"), expected_delivery_date: new Date("2026-06-24"), actual_first_received_date: "", actual_completed_date: "", payment_terms: "Net 30", currency: "USD", subtotal_amount: 900, tax_amount: 0, shipping_amount: 60, total_amount: 960, recommendation_id: "", po_doc_url: "", po_pdf_url: "", email_status: "NOT_SENT", email_sent_at: "", printed_status: "NOT_PRINTED", printed_at: "", supplier_confirmation_status: "PENDING", supplier_confirmed_delivery_date: "", notes: "Pending mock PO." }
  ];

  const lines = [
    { po_line_id: "POL-000001", po_id: "PO-000001", supplier_id: "SUP-001", product_id: "PROD-004", line_status: "RECEIVED", qty_ordered: 80, qty_received_total: 80, qty_remaining: 0, unit_type: "BUNDLE", unit_cost: 8, currency: "USD", line_total: 640, supplier_expected_lot_number: "PPC-CTN-0525", notes: "" },
    { po_line_id: "POL-000002", po_id: "PO-000002", supplier_id: "SUP-002", product_id: "PROD-002", line_status: "RECEIVED", qty_ordered: 45, qty_received_total: 43, qty_remaining: 0, unit_type: "BAG", unit_cost: 25, currency: "USD", line_total: 1125, supplier_expected_lot_number: "BAI-AF-0531", notes: "Two bags rejected as damaged." },
    { po_line_id: "POL-000003", po_id: "PO-000003", supplier_id: "SUP-005", product_id: "PROD-003", line_status: "RECEIVED", qty_ordered: 60, qty_received_total: 60, qty_remaining: 0, unit_type: "ROLL", unit_cost: 7, currency: "USD", line_total: 420, supplier_expected_lot_number: "SLS-LBL-0608", notes: "" },
    { po_line_id: "POL-000004", po_id: "PO-000004", supplier_id: "SUP-004", product_id: "PROD-001", line_status: "ORDERED", qty_ordered: 120, qty_received_total: 0, qty_remaining: 120, unit_type: "BOX", unit_cost: 6, currency: "USD", line_total: 720, supplier_expected_lot_number: "SBW-MT-0615", notes: "" },
    { po_line_id: "POL-000005", po_id: "PO-000005", supplier_id: "SUP-003", product_id: "PROD-005", line_status: "ORDERED", qty_ordered: 75, qty_received_total: 0, qty_remaining: 75, unit_type: "CASE", unit_cost: 12, currency: "USD", line_total: 900, supplier_expected_lot_number: "GSG-MANGO-0624", notes: "" }
  ];

  const receiving = [
    { receiving_id: "RCV-000001", po_id: "PO-000001", po_line_id: "POL-000001", supplier_id: "SUP-001", product_id: "PROD-004", scan_code: "PROD-004|QTY:80|SUPLOT:PPC-CTN-0525", internal_lot_id: "LOT-000001", supplier_lot_number: "PPC-CTN-0525", received_date: new Date("2026-05-25"), received_by: "OPERATOR", qty_received: 80, qty_damaged: 0, qty_accepted: 80, unit_type: "BUNDLE", quality_score: 5, product_accuracy_score: 5, over_under_status: "MATCH", recommended_location_id: "LOC-B-02-01", confirmed_location_id: "LOC-B-02-01", requires_supervisor_approval: false, approval_status: "APPROVED", notes: "" },
    { receiving_id: "RCV-000002", po_id: "PO-000002", po_line_id: "POL-000002", supplier_id: "SUP-002", product_id: "PROD-002", scan_code: "PROD-002|QTY:45|SUPLOT:BAI-AF-0531", internal_lot_id: "LOT-000002", supplier_lot_number: "BAI-AF-0531", received_date: new Date("2026-05-31"), received_by: "OPERATOR", qty_received: 45, qty_damaged: 2, qty_accepted: 43, unit_type: "BAG", quality_score: 4, product_accuracy_score: 5, over_under_status: "UNDER", recommended_location_id: "LOC-A-01-01", confirmed_location_id: "LOC-A-01-01", requires_supervisor_approval: false, approval_status: "APPROVED", notes: "Two damaged bags." },
    { receiving_id: "RCV-000003", po_id: "PO-000003", po_line_id: "POL-000003", supplier_id: "SUP-005", product_id: "PROD-003", scan_code: "PROD-003|QTY:60|SUPLOT:SLS-LBL-0608", internal_lot_id: "LOT-000003", supplier_lot_number: "SLS-LBL-0608", received_date: new Date("2026-06-08"), received_by: "OPERATOR", qty_received: 60, qty_damaged: 0, qty_accepted: 60, unit_type: "ROLL", quality_score: 5, product_accuracy_score: 4, over_under_status: "MATCH", recommended_location_id: "LOC-C-01-02", confirmed_location_id: "LOC-C-01-02", requires_supervisor_approval: false, approval_status: "APPROVED", notes: "" }
  ];

  const lots = [
    { internal_lot_id: "LOT-000001", product_id: "PROD-004", supplier_id: "SUP-001", supplier_lot_number: "PPC-CTN-0525", po_id: "PO-000001", po_line_id: "POL-000001", received_date: new Date("2026-05-25"), original_qty: 80, current_qty_script: 48, unit_type: "BUNDLE", unit_cost: 8, currency: "USD", current_location_id: "LOC-B-02-01", status: "ACTIVE", expiration_date: "", qr_value: "LOT-000001", label_printed_status: "PRINTED", label_printed_at: new Date("2026-05-25"), created_at: new Date("2026-05-25"), updated_at: new Date("2026-06-16"), notes: "" },
    { internal_lot_id: "LOT-000002", product_id: "PROD-002", supplier_id: "SUP-002", supplier_lot_number: "BAI-AF-0531", po_id: "PO-000002", po_line_id: "POL-000002", received_date: new Date("2026-05-31"), original_qty: 43, current_qty_script: 27, unit_type: "BAG", unit_cost: 25, currency: "USD", current_location_id: "LOC-A-01-01", status: "ACTIVE", expiration_date: new Date("2027-05-31"), qr_value: "LOT-000002", label_printed_status: "PRINTED", label_printed_at: new Date("2026-05-31"), created_at: new Date("2026-05-31"), updated_at: new Date("2026-06-16"), notes: "" },
    { internal_lot_id: "LOT-000003", product_id: "PROD-003", supplier_id: "SUP-005", supplier_lot_number: "SLS-LBL-0608", po_id: "PO-000003", po_line_id: "POL-000003", received_date: new Date("2026-06-08"), original_qty: 60, current_qty_script: 51, unit_type: "ROLL", unit_cost: 7, currency: "USD", current_location_id: "LOC-C-01-02", status: "ACTIVE", expiration_date: "", qr_value: "LOT-000003", label_printed_status: "PRINTED", label_printed_at: new Date("2026-06-08"), created_at: new Date("2026-06-08"), updated_at: new Date("2026-06-16"), notes: "" }
  ];

  const movements = [
    movement_("MOV-000001", "RECEIVE", "2026-05-25", "PROD-004", "LOT-000001", 80, "BUNDLE", "SUPPLIER", "LOC-B-02-01", "PO-000001", "RCV-000001"),
    movement_("MOV-000002", "USE", "2026-06-01", "PROD-004", "LOT-000001", -12, "BUNDLE", "LOC-B-02-01", "PACK_STATION", "", ""),
    movement_("MOV-000003", "USE", "2026-06-05", "PROD-004", "LOT-000001", -9, "BUNDLE", "LOC-B-02-01", "PACK_STATION", "", ""),
    movement_("MOV-000004", "USE", "2026-06-11", "PROD-004", "LOT-000001", -11, "BUNDLE", "LOC-B-02-01", "PACK_STATION", "", ""),
    movement_("MOV-000005", "RECEIVE", "2026-05-31", "PROD-002", "LOT-000002", 43, "BAG", "SUPPLIER", "LOC-A-01-01", "PO-000002", "RCV-000002"),
    movement_("MOV-000006", "USE", "2026-06-03", "PROD-002", "LOT-000002", -5, "BAG", "LOC-A-01-01", "PRODUCTION", "", ""),
    movement_("MOV-000007", "USE", "2026-06-09", "PROD-002", "LOT-000002", -7, "BAG", "LOC-A-01-01", "PRODUCTION", "", ""),
    movement_("MOV-000008", "USE", "2026-06-14", "PROD-002", "LOT-000002", -4, "BAG", "LOC-A-01-01", "PRODUCTION", "", ""),
    movement_("MOV-000009", "RECEIVE", "2026-06-08", "PROD-003", "LOT-000003", 60, "ROLL", "SUPPLIER", "LOC-C-01-02", "PO-000003", "RCV-000003"),
    movement_("MOV-000010", "USE", "2026-06-12", "PROD-003", "LOT-000003", -6, "ROLL", "LOC-C-01-02", "LABEL_STATION", "", ""),
    movement_("MOV-000011", "USE", "2026-06-15", "PROD-003", "LOT-000003", -3, "ROLL", "LOC-C-01-02", "LABEL_STATION", "", "")
  ];

  suppliers.forEach((record) => appendRecord_("SUPPLIERS", dated_(record)));
  products.forEach((record) => appendRecord_("PRODUCTS", dated_(record)));
  locations.forEach((record) => appendRecord_("LOCATIONS", record));
  purchaseOrders.forEach((record) => appendRecord_("PURCHASE_ORDERS", record));
  lines.forEach((record) => appendRecord_("PURCHASE_ORDER_LINES", record));
  receiving.forEach((record) => appendRecord_("RECEIVING", record));
  lots.forEach((record) => appendRecord_("LOTS", record));
  movements.forEach((record) => appendRecord_("INVENTORY_MOVEMENTS", record));

  return {
    suppliers: suppliers.length,
    products: products.length,
    purchase_orders: purchaseOrders.length,
    completed_purchase_orders: purchaseOrders.filter((po) => po.po_status === "COMPLETE").length,
    pending_purchase_orders: purchaseOrders.filter((po) => po.po_status !== "COMPLETE").length
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

function ensureTableColumns_(sheetName, requiredHeaders) {
  const meta = tableMeta_(sheetName);
  const missing = requiredHeaders.filter((header) => meta.headers.indexOf(header) < 0);
  if (!missing.length) return;
  const startColumn = meta.headers.length + 1;
  meta.sheet.getRange(meta.headerRow, startColumn, 1, missing.length).setValues([missing]);
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

function updateLotQuantity_(internalLotId, qtyChange) {
  const meta = tableMeta_("LOTS");
  const idIndex = meta.headers.indexOf("internal_lot_id");
  const qtyIndex = meta.headers.indexOf("current_qty_script");
  const updatedIndex = meta.headers.indexOf("updated_at");
  if (idIndex < 0 || qtyIndex < 0) return;

  for (let r = meta.headerRow + 1; r <= meta.sheet.getLastRow(); r++) {
    if (meta.sheet.getRange(r, idIndex + 1).getValue() === internalLotId) {
      const current = Number(meta.sheet.getRange(r, qtyIndex + 1).getValue() || 0);
      meta.sheet.getRange(r, qtyIndex + 1).setValue(current + Number(qtyChange || 0));
      if (updatedIndex >= 0) meta.sheet.getRange(r, updatedIndex + 1).setValue(new Date());
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

function clearTable_(sheetName) {
  const meta = tableMeta_(sheetName);
  const dataRows = meta.sheet.getLastRow() - meta.headerRow;
  if (dataRows > 0) {
    meta.sheet.getRange(meta.headerRow + 1, 1, dataRows, meta.sheet.getLastColumn()).clearContent();
  }
}

function dated_(record) {
  const now = new Date();
  return {
    created_at: now,
    updated_at: now,
    ...record
  };
}

function movement_(movementId, movementType, timestamp, productId, lotId, qty, unitType, fromLocation, toLocation, poId, receivingId) {
  return {
    movement_id: movementId,
    movement_type: movementType,
    timestamp: new Date(timestamp),
    user_id: "MOCK_ADMIN",
    product_id: productId,
    internal_lot_id: lotId,
    package_id: "",
    qty_change: qty,
    unit_type: unitType,
    from_location_id: fromLocation,
    to_location_id: toLocation,
    related_po_id: poId || "",
    related_receiving_id: receivingId || "",
    related_sales_order_id: "",
    related_pick_task_id: "",
    related_amazon_order_id: "",
    scan_code: lotId,
    device_id: "MOCK_SEED",
    approval_status: "APPROVED",
    notes: "Mock operational seed data."
  };
}
