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
    "salesOrders:create",
    "salesOrders:actions",
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
    "salesOrders:create",
    "salesOrders:actions",
    "receiving:create",
    "inventory:view",
    "inventory:adjust",
    "scanner:lookup"
  ],
  OPERATOR: [
    "salesOrders:actions",
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
      listLots,
      createOpeningInventory,
      listUsers,
      createUser,
      createProduct,
      listSuppliers,
      createSupplier,
      listLocations,
      listPurchaseOrders,
      getPurchaseOrderDetail,
      generatePurchaseOrderTemplate,
      createPurchaseOrder,
      purchaseOrderAction,
      listSalesOrders,
      getSalesOrderDetail,
      createSalesOrder,
      salesOrderAction,
      receiveProduct,
      recordInventoryMovement,
      recordAmazonOutbound,
      listAmazonOutboundActivity,
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
  const products = readTable_("PRODUCTS");
  const suppliers = readTable_("SUPPLIERS");
  const purchaseOrders = readTable_("PURCHASE_ORDERS");
  const purchaseOrderLines = readTable_("PURCHASE_ORDER_LINES");
  const salesOrders = readTable_("SALES_ORDERS");
  const salesOrderLines = readTable_("SALES_ORDER_LINES");
  const lots = readTable_("LOTS");
  const movements = readTable_("INVENTORY_MOVEMENTS");
  const locations = readTable_("LOCATIONS");
  const snapshots = buildInventorySnapshot_(products, lots, movements);
  const leadTimeBySupplier = buildLeadTimeStatsBySupplier_(purchaseOrders);
  const planning = products.map((product) =>
    buildProductPlanning_(product, suppliers, purchaseOrders, purchaseOrderLines, movements, snapshots, leadTimeBySupplier)
  );
  return {
    productCount: products.length,
    supplierCount: suppliers.length,
    openPoCount: purchaseOrders.filter(isOpenPurchaseOrder_).length,
    lotCount: lots.length,
    movementCount: movements.length,
    pendingAmazonPackages: readTable_("AMAZON_PACKAGES").filter((pkg) => !pkg.matched_amazon_order_id).length,
    ...buildDashboardMetrics_(products, purchaseOrders, purchaseOrderLines, salesOrders, salesOrderLines, lots, locations, snapshots, planning)
  };
}

function listProducts() {
  return readTable_("PRODUCTS");
}

function listLots() {
  return readTable_("LOTS");
}

function createOpeningInventory(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "receiving:create");
  const input = payload.input || {};
  const name = String(input.product_name || "").trim();
  const qty = Number(input.qty || 0);
  const weight = Number(input.purchase_unit_weight || 0);
  const location = readTable_("LOCATIONS").find((row) => row.location_id === input.location_id || row.qr_value === input.location_id);
  if (!name || !isFinite(qty) || qty <= 0 || !isFinite(weight) || weight <= 0 || !location) {
    throw new Error("Complete product, quantity, weight, and inventory space.");
  }
  if (String(location.current_status || "AVAILABLE").toUpperCase() !== "AVAILABLE") throw new Error("Choose an available inventory space.");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const products = readTable_("PRODUCTS");
    let product = products.find((row) => String(row.product_name || "").trim().toLowerCase() === name.toLowerCase());
    if (!product) {
      product = createProduct({ user: user, input: { product_name: name, product_category: input.product_category || "General", perishability_days: Number(input.perishability_days || 0) } });
    }
    ensureTableColumns_("LOTS", ["purchase_qty_received", "purchase_unit_type", "current_qty_script", "current_location_id", "qr_value"]);
    const lots = readTable_("LOTS");
    const lot = {
      internal_lot_id: nextId_("LOTS", "internal_lot_id", "LOT"), product_id: product.product_id,
      supplier_lot_number: input.supplier_lot_number || "OPENING", received_date: new Date(),
      original_qty: qty * weight, current_qty_script: qty * weight, unit_type: "LB",
      purchase_qty_received: qty, purchase_unit_type: input.purchase_unit || "UNIT",
      current_location_id: location.location_id, status: "ACTIVE", qr_value: "", notes: "Opening inventory count."
    };
    lot.qr_value = lot.internal_lot_id;
    const movement = {
      movement_id: nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV"), movement_type: "OPENING_INVENTORY", timestamp: new Date(), user_id: user.user_id || user.role,
      product_id: product.product_id, internal_lot_id: lot.internal_lot_id, qty_change: lot.original_qty, unit_type: "LB",
      from_location_id: "OPENING_COUNT", to_location_id: location.location_id, scan_code: lot.internal_lot_id, device_id: "WEB_APP", approval_status: "APPROVED", notes: input.notes || ""
    };
    appendRecord_("LOTS", lot); appendRecord_("INVENTORY_MOVEMENTS", movement);
    updateTableRecord_("LOCATIONS", "location_id", location.location_id, { current_status: "UNAVAILABLE" });
    return { product: product, lot: lot, movement: movement };
  } finally { lock.releaseLock(); }
}

function listUsers() {
  return readTable_("USERS")
    .filter((user) => user.is_active !== false && String(user.is_active || "").toUpperCase() !== "FALSE")
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
}

function createUser(payload) {
  payload = payload || {};
  const actor = payload.user || {};
  if (String(actor.role || "").toUpperCase() !== "ADMIN") throw new Error("Only an Admin can create users.");
  const input = payload.input || {};
  const fullName = String(input.full_name || "").trim();
  const email = String(input.email || "").trim();
  const role = String(input.role || "OPERATOR").toUpperCase();
  if (!fullName) throw new Error("Full name is required.");
  if (!email) throw new Error("Email is required.");
  if (["ADMIN", "MANAGER", "OPERATOR"].indexOf(role) < 0) throw new Error("Choose a valid role.");
  ensureTableColumns_("USERS", ["full_name", "email", "role", "device_assigned", "is_active", "created_at"]);
  const users = readTable_("USERS");
  if (users.some((item) => String(item.email || "").toLowerCase() === email.toLowerCase())) {
    throw new Error("A user with that email already exists.");
  }
  const record = {
    user_id: nextId_("USERS", "user_id", "USR"),
    full_name: fullName,
    email: email,
    role: role,
    device_assigned: input.device_assigned || "",
    is_active: true,
    created_at: new Date()
  };
  appendRecord_("USERS", record);
  return record;
}

function createProduct(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "products:create");

  const input = payload.input || {};
  const products = readTable_("PRODUCTS");
  const productName = String(input.product_name || "").trim();
  const productCategory = String(input.product_category || "").trim();
  const perishabilityDays = Number(input.perishability_days || 0);
  if (!productName) throw new Error("Product name is required.");
  if (!productCategory) throw new Error("Product category is required.");
  if (!Number.isFinite(perishabilityDays) || perishabilityDays < 0) {
    throw new Error("Perishability days must be zero or greater.");
  }
  if (products.some((row) => String(row.product_name || "").trim().toLowerCase() === productName.toLowerCase())) {
    throw new Error("A product with this name already exists.");
  }

  ensureTableColumns_("PRODUCTS", ["base_unit", "units_per_purchase_unit", "can_break_case", "perishability_days"]);
  const productId = input.product_id || nextId_("PRODUCTS", "product_id", "PROD");
  if (products.some((row) => row.product_id === productId)) {
    throw new Error("Product ID already exists.");
  }

  const record = {
    product_id: productId,
    product_name: productName,
    product_category: productCategory,
    default_unit: "",
    base_unit: "LB",
    units_per_purchase_unit: 0,
    can_break_case: "",
    case_weight_lbs: 0,
    perishability_days: perishabilityDays,
    amazon_sku: "",
    wholesale_sku: "",
    barcode_or_qr_value: productId,
    min_stock_qty: 0,
    target_stock_qty: 0,
    velocity_class: "",
    storage_zone_preference: "",
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    notes: ""
  };

  appendRecord_("PRODUCTS", record);
  return record;
}

function listSuppliers() {
  return readTable_("SUPPLIERS").map((supplier) => ({
    ...supplier,
    party_type: normalizePartyType_(supplier.party_type),
    lead_time_expected_days: normalizePartyType_(supplier.party_type) === "VENDOR"
      ? calculateSupplierLeadTime_(supplier.supplier_id)
      : ""
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
  if (!input.supplier_name) throw new Error("Business name is required.");

  ensureTableColumns_("SUPPLIERS", ["party_type"]);
  const suppliers = readTable_("SUPPLIERS");
  const partyType = normalizePartyType_(input.party_type);
  const supplierId = input.supplier_id || nextId_("SUPPLIERS", "supplier_id", partyType === "CUSTOMER" ? "CUST" : "SUP");
  if (suppliers.some((row) => row.supplier_id === supplierId)) {
    throw new Error("Business record ID already exists.");
  }

  const record = {
    supplier_id: supplierId,
    party_type: partyType,
    supplier_name: input.supplier_name,
    contact_name: input.contact_name || "",
    email: input.email || "",
    phone: input.phone || "",
    address: input.address || "",
    payment_terms: input.payment_terms || "Net 30",
    default_currency: input.default_currency || "USD",
    lead_time_expected_days: partyType === "VENDOR" ? calculateSupplierLeadTime_(supplierId) : "",
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
  const lines = readTable_("PURCHASE_ORDER_LINES");
  return readTable_("PURCHASE_ORDERS").map((po) => ({
    ...po,
    supplier: suppliers.find((supplier) => supplier.supplier_id === po.supplier_id) || null,
    line_count: lines.filter((line) => line.po_id === po.po_id).length
  }));
}

function getPurchaseOrderDetail(payload) {
  payload = payload || {};
  const poId = payload.poId || payload.po_id;
  const products = readTable_("PRODUCTS");
  const suppliers = readTable_("SUPPLIERS");
  const po = readTable_("PURCHASE_ORDERS").find((row) => row.po_id === poId);
  if (!po) return null;

  const lines = readTable_("PURCHASE_ORDER_LINES")
    .filter((line) => line.po_id === poId)
    .map((line) => ({
      ...line,
      product: products.find((product) => product.product_id === line.product_id) || null
    }));

  return {
    po: {
      ...po,
      supplier: suppliers.find((supplier) => supplier.supplier_id === po.supplier_id) || null
    },
    lines
  };
}

function generatePurchaseOrderTemplate(payload) {
  const detail = getPurchaseOrderDetail(payload);
  if (!detail) throw new Error("Purchase order not found.");
  return {
    po: detail.po,
    lines: detail.lines.map((line) => ({
      ...line,
      qr_value: line.qr_value || purchaseOrderQrValue_({
        poId: line.po_id,
        poLineId: line.po_line_id,
        productId: line.product_id,
        productName: line.product && line.product.product_name || line.product_id,
        qty: line.qty_ordered,
        supplierLotNumber: line.supplier_expected_lot_number
      })
    }))
  };
}

function createPurchaseOrder(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "purchaseOrders:create");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const input = payload.input || {};
    const suppliers = readTable_("SUPPLIERS");
    const supplier = suppliers.find((row) => row.supplier_id === input.supplier_id);
    if (!supplier || normalizePartyType_(supplier.party_type) !== "VENDOR") {
      throw new Error("Select a valid vendor.");
    }
    const products = readTable_("PRODUCTS");
    const inputLines = Array.isArray(input.lines) ? input.lines : [input];
    if (!inputLines.length) throw new Error("Add at least one product.");
    const validatedLines = inputLines.map((item, index) => validatePurchaseOrderLine_(item, index, products));

    ensureTableColumns_("PURCHASE_ORDERS", ["tax_enabled", "tax_rate", "ship_via"]);
    ensureTableColumns_("PURCHASE_ORDER_LINES", ["base_unit", "units_per_purchase_unit", "expected_base_qty", "case_weight_lbs", "qr_value"]);

    const subtotal = round_(validatedLines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0), 2);
    const taxEnabled = input.tax_enabled === true || String(input.tax_enabled).toUpperCase() === "TRUE";
    const taxRate = taxEnabled ? Math.max(0, Number(input.tax_rate_percent || 6.25) / 100) : 0;
    const taxAmount = round_(subtotal * taxRate, 2);
    const orderDate = dateFromInput_(input.order_date);
    const expectedDeliveryDate = input.expected_delivery_date
      ? dateFromInput_(input.expected_delivery_date)
      : addDays_(orderDate, calculateSupplierLeadTime_(input.supplier_id));
    const poId = nextId_("PURCHASE_ORDERS", "po_id", "PO");
    const firstPoLineId = nextId_("PURCHASE_ORDER_LINES", "po_line_id", "POL");
    const firstPoLineNumber = Number(String(firstPoLineId).match(/(\d+)$/)[1]);
    const currency = supplier.default_currency || "USD";

    const po = {
      po_id: poId,
      po_status: "DRAFT",
      supplier_id: input.supplier_id,
      created_by: user.user_id || user.role || "UNKNOWN",
      order_date: orderDate,
      expected_delivery_date: expectedDeliveryDate,
      actual_first_received_date: "",
      actual_completed_date: "",
      payment_terms: supplier.payment_terms || "Net 30",
      currency,
      subtotal_amount: subtotal,
      tax_enabled: taxEnabled,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      shipping_amount: 0,
      ship_via: input.ship_via || "SUPPLIER_DELIVERY",
      total_amount: round_(subtotal + taxAmount, 2),
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

    const lines = validatedLines.map((item, index) => {
      const product = products.find((row) => row.product_id === item.product_id);
      const poLineId = `POL-${String(firstPoLineNumber + index).padStart(6, "0")}`;
      const line = {
        po_line_id: poLineId,
        po_id: poId,
        supplier_id: input.supplier_id,
        product_id: item.product_id,
        line_status: "ORDERED",
        qty_ordered: item.qty_ordered,
        qty_received_total: 0,
        qty_remaining: item.qty_ordered,
        unit_type: item.unit_type,
        base_unit: "LB",
        units_per_purchase_unit: item.case_weight_lbs,
        expected_base_qty: round_(item.qty_ordered * item.case_weight_lbs, 2),
        case_weight_lbs: item.case_weight_lbs,
        unit_cost: item.unit_cost,
        currency,
        line_total: round_(item.qty_ordered * item.unit_cost, 2),
        supplier_expected_lot_number: item.supplier_expected_lot_number,
        notes: ""
      };
      line.qr_value = purchaseOrderQrValue_({
        poId,
        poLineId,
        productId: item.product_id,
        productName: product.product_name,
        qty: item.qty_ordered,
        supplierLotNumber: item.supplier_expected_lot_number
      });
      return line;
    });

    appendRecord_("PURCHASE_ORDERS", po);
    lines.forEach((line) => appendRecord_("PURCHASE_ORDER_LINES", line));
    return { ...po, lines };
  } finally {
    lock.releaseLock();
  }
}

function validatePurchaseOrderLine_(input, index, products) {
  const lineNumber = index + 1;
  const product = products.find((row) => row.product_id === input.product_id);
  const qty = Number(input.qty_ordered || 0);
  const unitCost = Number(input.unit_cost || 0);
  const unitWeight = Number(input.case_weight_lbs || input.units_per_purchase_unit || 0);
  const unitType = String(input.unit_type || "").trim().toUpperCase();
  if (!product) throw new Error(`Select a valid product on line ${lineNumber}.`);
  if (!isFinite(qty) || qty <= 0) throw new Error(`Quantity must be greater than zero on line ${lineNumber}.`);
  if (!unitType) throw new Error(`Purchase unit is required on line ${lineNumber}.`);
  if (!isFinite(unitWeight) || unitWeight <= 0) throw new Error(`Unit weight must be greater than zero on line ${lineNumber}.`);
  if (!isFinite(unitCost) || unitCost < 0) throw new Error(`Unit cost cannot be negative on line ${lineNumber}.`);
  return {
    product_id: product.product_id,
    qty_ordered: qty,
    unit_type: unitType,
    case_weight_lbs: unitWeight,
    unit_cost: unitCost,
    supplier_expected_lot_number: String(input.supplier_expected_lot_number || "").trim()
  };
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

function listSalesOrders() {
  const parties = readTable_("SUPPLIERS");
  const products = readTable_("PRODUCTS");
  const lines = readTable_("SALES_ORDER_LINES");
  return readTable_("SALES_ORDERS").map((order) => {
    const orderLines = lines.filter((line) => line.sales_order_id === order.sales_order_id);
    return {
      ...order,
      customer: parties.find((party) => party.supplier_id === order.customer_id)
        || parties.find((party) => party.supplier_name === order.customer_name)
        || null,
      line_count: orderLines.length,
      product_names: unique_(orderLines.map((line) => {
        const product = products.find((item) => item.product_id === line.product_id);
        return product ? product.product_name : line.product_id;
      })).join(", ")
    };
  }).sort((a, b) => new Date(b.order_date || 0) - new Date(a.order_date || 0));
}

function getSalesOrderDetail(payload) {
  payload = payload || {};
  const salesOrderId = payload.salesOrderId || payload.sales_order_id;
  const parties = readTable_("SUPPLIERS");
  const products = readTable_("PRODUCTS");
  const lots = readTable_("LOTS");
  const locations = readTable_("LOCATIONS");
  const order = readTable_("SALES_ORDERS").find((item) => item.sales_order_id === salesOrderId);
  if (!order) return null;
  const lines = readTable_("SALES_ORDER_LINES")
    .filter((line) => line.sales_order_id === salesOrderId)
    .map((line) => ({
      ...line,
      product: products.find((product) => product.product_id === line.product_id) || null,
      lot: lots.find((lot) => lot.internal_lot_id === line.preferred_internal_lot_id) || null,
      location: locations.find((location) => location.location_id === line.preferred_location_id) || null
    }));
  return {
    order: {
      ...order,
      customer: parties.find((party) => party.supplier_id === order.customer_id)
        || parties.find((party) => party.supplier_name === order.customer_name)
        || null
    },
    lines: lines,
    pickTasks: readTable_("PICK_TASKS").filter((task) => task.sales_order_id === salesOrderId)
  };
}

function createSalesOrder(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "salesOrders:create");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const input = payload.input || {};
    const parties = readTable_("SUPPLIERS");
    const customer = parties.find((party) => party.supplier_id === input.customer_id);
    if (!customer || normalizePartyType_(customer.party_type) !== "CUSTOMER") {
      throw new Error("Select a valid customer.");
    }
    const shippingAddress = String(input.shipping_address || customer.address || "").trim();
    if (!shippingAddress) throw new Error("Ship To Address is required.");
    const inputLines = Array.isArray(input.lines) ? input.lines : [];
    if (!inputLines.length) throw new Error("Add at least one inventory item.");
    const products = readTable_("PRODUCTS");
    const lots = readTable_("LOTS");
    const purchaseOrderLines = readTable_("PURCHASE_ORDER_LINES");
    const snapshot = inventorySnapshot();
    const allocatedByInventory = {};
    const validatedLines = inputLines.map((line, index) => validateSalesOrderLine_(
      line,
      index,
      products,
      lots,
      purchaseOrderLines,
      snapshot,
      allocatedByInventory,
      input.requested_delivery_date
    ));

    ensureTableColumns_("SALES_ORDERS", [
      "customer_id", "ship_method", "payment_terms", "tax_enabled", "tax_rate",
      "estimated_gross_profit", "estimated_gross_margin_percent", "confirmed_at", "picked_at", "shipped_at",
      "bl_folio", "shipping_address"
    ]);
    ensureTableColumns_("SALES_ORDER_LINES", [
      "unit_weight_lbs", "inventory_qty_required", "inventory_unit_type", "unit_cost",
      "estimated_gross_profit", "expiration_date", "fefo_status"
    ]);

    const subtotal = round_(validatedLines.reduce((sum, line) => sum + line.line_total, 0), 2);
    const estimatedGrossProfit = round_(validatedLines.reduce((sum, line) => sum + line.estimated_gross_profit, 0), 2);
    const taxEnabled = input.tax_enabled === true || String(input.tax_enabled).toUpperCase() === "TRUE";
    const taxRate = taxEnabled ? Math.max(0, Number(input.tax_rate_percent || 6.25) / 100) : 0;
    const taxAmount = round_(subtotal * taxRate, 2);
    const salesOrderId = nextId_("SALES_ORDERS", "sales_order_id", "SO");
    const blFolio = nextBlFolio_();
    const firstLineId = nextId_("SALES_ORDER_LINES", "sales_order_line_id", "SOL");
    const firstLineNumber = Number(String(firstLineId).match(/(\d+)$/)[1]);
    const order = {
      sales_order_id: salesOrderId,
      bl_folio: blFolio,
      channel: String(input.sales_channel || "OTHER").toUpperCase(),
      order_source: "MANUAL",
      customer_id: customer.supplier_id,
      customer_name: customer.supplier_name,
      customer_email: customer.email || "",
      customer_phone: customer.phone || "",
      amazon_order_id: "",
      order_date: dateFromInput_(input.order_date),
      ship_by_date: input.requested_delivery_date ? dateFromInput_(input.requested_delivery_date) : "",
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
      total_amount: round_(subtotal + taxAmount, 2),
      estimated_gross_profit: estimatedGrossProfit,
      estimated_gross_margin_percent: subtotal > 0 ? round_(estimatedGrossProfit / subtotal * 100, 2) : 0,
      invoice_status: "NOT_INVOICED",
      created_by: user.user_id || user.role || "UNKNOWN",
      created_at: new Date(),
      updated_at: new Date(),
      notes: input.notes || ""
    };
    const lines = validatedLines.map((line, index) => ({
      sales_order_line_id: `SOL-${String(firstLineNumber + index).padStart(6, "0")}`,
      sales_order_id: salesOrderId,
      channel: order.channel,
      amazon_order_item_id: "",
      product_id: line.product_id,
      amazon_sku: "",
      wholesale_sku: "",
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
      notes: line.notes || ""
    }));
    appendRecord_("SALES_ORDERS", order);
    lines.forEach((line) => appendRecord_("SALES_ORDER_LINES", line));
    return { ...order, lines: lines };
  } finally {
    lock.releaseLock();
  }
}

function salesOrderAction(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "salesOrders:actions");
  const salesOrderId = payload.salesOrderId || payload.sales_order_id;
  const action = String(payload.action || "").toUpperCase();
  enforceSalesOrderActionRole_(user, action);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureTableColumns_("SALES_ORDERS", ["confirmed_at", "picked_at", "shipped_at", "updated_at"]);
    ensureTableColumns_("SALES_ORDER_LINES", ["inventory_qty_required", "line_status"]);
    const detail = getSalesOrderDetail({ salesOrderId: salesOrderId });
    if (!detail) throw new Error("Sales order not found.");
    const order = detail.order;
    const lines = detail.lines;

    if (action === "CONFIRM") {
      if (String(order.status).toUpperCase() !== "DRAFT") throw new Error("Only draft Sales Orders can be confirmed.");
      const snapshot = inventorySnapshot();
      const requestedByInventory = {};
      lines.forEach((line, index) => validateExistingSalesAllocation_(line, index, snapshot, requestedByInventory));
      ensureTableColumns_("PICK_TASKS", ["qty_to_pick_base", "reservation_status"]);
      const firstTaskId = nextId_("PICK_TASKS", "pick_task_id", "PICK");
      const firstTaskNumber = Number(String(firstTaskId).match(/(\d+)$/)[1]);
      lines.forEach((line, index) => {
        appendRecord_("PICK_TASKS", {
          pick_task_id: `PICK-${String(firstTaskNumber + index).padStart(6, "0")}`,
          sales_order_id: salesOrderId,
          sales_order_line_id: line.sales_order_line_id,
          channel: order.channel,
          task_date: new Date(),
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
          picked_at: "",
          scan_code: "",
          device_id: "",
          exception_code: "",
          notes: line.fefo_status === "RECOMMENDED" ? "FEFO allocation." : "Manual lot allocation."
        });
        updateTableRecord_("SALES_ORDER_LINES", "sales_order_line_id", line.sales_order_line_id, { line_status: "CONFIRMED" });
      });
      updateTableRecord_("SALES_ORDERS", "sales_order_id", salesOrderId, {
        status: "CONFIRMED", confirmed_at: new Date(), updated_at: new Date()
      });
    } else if (action === "PICKED") {
      if (String(order.status).toUpperCase() !== "CONFIRMED") throw new Error("Only confirmed Sales Orders can be marked picked.");
      lines.forEach((line) => updateTableRecord_("SALES_ORDER_LINES", "sales_order_line_id", line.sales_order_line_id, {
        line_status: "PICKED", qty_picked: line.qty_ordered, qty_remaining: 0
      }));
      detail.pickTasks.forEach((task) => updateTableRecord_("PICK_TASKS", "pick_task_id", task.pick_task_id, {
        pick_status: "PICKED", qty_picked: task.qty_to_pick, picked_at: new Date()
      }));
      updateTableRecord_("SALES_ORDERS", "sales_order_id", salesOrderId, {
        status: "PICKED", picked_at: new Date(), updated_at: new Date()
      });
    } else if (action === "SHIPPED") {
      if (String(order.status).toUpperCase() !== "PICKED") throw new Error("Only picked Sales Orders can be marked shipped.");
      detail.pickTasks.forEach((task) => updateTableRecord_("PICK_TASKS", "pick_task_id", task.pick_task_id, {
        pick_status: "SHIPPED"
      }));
      updateTableRecord_("SALES_ORDERS", "sales_order_id", salesOrderId, {
        status: "SHIPPED", shipped_at: new Date(), updated_at: new Date()
      });
    } else {
      throw new Error("Unknown Sales Order action.");
    }
    return getSalesOrderDetail({ salesOrderId: salesOrderId });
  } finally {
    lock.releaseLock();
  }
}

function validateSalesOrderLine_(input, index, products, lots, purchaseOrderLines, snapshot, allocatedByInventory, requestedDeliveryDate) {
  const lineNumber = index + 1;
  const product = products.find((item) => item.product_id === input.product_id);
  const lot = lots.find((item) => item.internal_lot_id === input.internal_lot_id);
  const inventoryRow = snapshot.find((row) =>
    row.product_id === input.product_id
    && row.internal_lot_id === input.internal_lot_id
    && row.location_id === input.location_id
  );
  if (!product || !lot || !inventoryRow) throw new Error(`Select valid inventory on line ${lineNumber}.`);
  if (["ACTIVE", "AVAILABLE"].indexOf(String(lot.status || "ACTIVE").toUpperCase()) < 0) {
    throw new Error(`The selected lot is not sellable on line ${lineNumber}.`);
  }
  const expiration = effectiveExpirationDate_(lot, product);
  const today = startOfDay_(new Date());
  if (expiration && expiration < today) throw new Error(`The selected lot is expired on line ${lineNumber}.`);
  const requestedDate = startOfDay_(requestedDeliveryDate);
  if (expiration && requestedDate && expiration < requestedDate) {
    throw new Error(`The selected lot expires before the requested delivery date on line ${lineNumber}.`);
  }

  const qtyOrdered = Number(input.qty_ordered || 0);
  const salesUnit = String(input.unit_type || "").trim().toUpperCase();
  const unitWeight = Number(input.unit_weight_lbs || (salesUnit === "LB" ? 1 : 0));
  const unitPrice = Number(input.unit_price || 0);
  const inventoryUnit = String(inventoryRow.unit_type || lot.unit_type || "").toUpperCase();
  if (!isFinite(qtyOrdered) || qtyOrdered <= 0) throw new Error(`Quantity sold must be greater than zero on line ${lineNumber}.`);
  if (!salesUnit) throw new Error(`Sales unit is required on line ${lineNumber}.`);
  if (!isFinite(unitWeight) || unitWeight <= 0) throw new Error(`Unit weight must be greater than zero on line ${lineNumber}.`);
  if (!isFinite(unitPrice) || unitPrice < 0) throw new Error(`Unit price cannot be negative on line ${lineNumber}.`);
  if (inventoryUnit !== salesUnit && inventoryUnit !== "LB") {
    throw new Error(`The selected inventory cannot be converted from ${inventoryUnit} to ${salesUnit} on line ${lineNumber}.`);
  }

  const inventoryQtyRequired = round_(inventoryUnit === salesUnit ? qtyOrdered : qtyOrdered * unitWeight, 2);
  const key = salesInventoryKey_(input.product_id, input.internal_lot_id, input.location_id);
  const combinedQty = Number(allocatedByInventory[key] || 0) + inventoryQtyRequired;
  const availableQty = Number(inventoryRow.available_qty !== undefined ? inventoryRow.available_qty : inventoryRow.qty || 0);
  if (combinedQty > availableQty + 0.0001) {
    throw new Error(`Line ${lineNumber} exceeds the available quantity for this lot and location.`);
  }
  allocatedByInventory[key] = combinedQty;

  const inventoryUnitCost = dashboardUnitCost_(lot, purchaseOrderLines);
  const unitCost = round_(inventoryUnitCost * inventoryQtyRequired / qtyOrdered, 4);
  const lineTotal = round_(qtyOrdered * unitPrice, 2);
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
    estimated_gross_profit: round_(qtyOrdered * (unitPrice - unitCost), 2),
    expiration_date: expiration ? dateKey_(expiration) : "",
    fefo_status: isFefoChoice_(inventoryRow, snapshot, lots, products, unitWeight) ? "RECOMMENDED" : "OVERRIDE",
    notes: String(input.notes || "")
  };
}

function validateExistingSalesAllocation_(line, index, snapshot, requestedByInventory) {
  const inventoryRow = snapshot.find((row) =>
    row.product_id === line.product_id
    && row.internal_lot_id === line.preferred_internal_lot_id
    && row.location_id === line.preferred_location_id
  );
  if (!inventoryRow) throw new Error(`Inventory allocation is missing on line ${index + 1}.`);
  const key = salesInventoryKey_(line.product_id, line.preferred_internal_lot_id, line.preferred_location_id);
  const requested = Number(line.inventory_qty_required || line.qty_ordered || 0);
  const combined = Number(requestedByInventory[key] || 0) + requested;
  const available = Number(inventoryRow.available_qty !== undefined ? inventoryRow.available_qty : inventoryRow.qty || 0);
  if (combined > available + 0.0001) {
    throw new Error(`Inventory is no longer available for line ${index + 1}. Choose another lot or quantity.`);
  }
  requestedByInventory[key] = combined;
}

function isFefoChoice_(selectedRow, snapshot, lots, products, unitWeight) {
  const selectedLot = lots.find((lot) => lot.internal_lot_id === selectedRow.internal_lot_id) || {};
  const product = products.find((item) => item.product_id === selectedRow.product_id) || {};
  const selectedExpiration = effectiveExpirationDate_(selectedLot, product);
  const expirations = snapshot.filter((row) => {
    if (row.product_id !== selectedRow.product_id || Number(row.available_qty || row.qty || 0) <= 0) return false;
    const lot = lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    return ["ACTIVE", "AVAILABLE"].indexOf(String(lot.status || "ACTIVE").toUpperCase()) >= 0
      && Math.abs(salesLotUnitWeight_(lot) - unitWeight) < 0.001;
  }).map((row) => {
    const lot = lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    return effectiveExpirationDate_(lot, product);
  }).filter((date) => date).sort((a, b) => a - b);
  return !expirations.length || (selectedExpiration && selectedExpiration.getTime() === expirations[0].getTime());
}

function salesLotUnitWeight_(lot) {
  const originalQty = Number(lot.original_qty || 0);
  const purchaseQty = Number(lot.purchase_qty_received || 0);
  return originalQty > 0 && purchaseQty > 0 ? round_(originalQty / purchaseQty, 4) : 1;
}

function salesInventoryKey_(productId, lotId, locationId) {
  return [productId, lotId, locationId].join("|");
}

function enforceSalesOrderActionRole_(user, action) {
  const role = String(user.role || "OPERATOR").toUpperCase();
  if (role === "OPERATOR" && action !== "PICKED") {
    throw new Error("Operators can only mark confirmed Sales Orders as picked.");
  }
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
    if (line.po_id !== input.po_id) throw new Error("The selected product does not belong to this purchase order.");

    const qtyReceived = Number(input.qty_received || 0);
    const qtyDamaged = Number(input.qty_damaged || 0);
    if (qtyReceived <= 0) throw new Error("Quantity received must be greater than zero.");
    if (qtyDamaged < 0 || qtyDamaged > qtyReceived) throw new Error("Damaged quantity cannot exceed quantity received.");
    const qualityStatus = String(input.quality_status || "PASS").toUpperCase();
    if (!["PASS", "HOLD", "REJECTED"].includes(qualityStatus)) throw new Error("Select a valid quality status.");
    if (qualityStatus === "REJECTED" && qtyDamaged !== qtyReceived) {
      throw new Error("A rejected delivery must have the full received quantity marked as damaged/rejected.");
    }

    const product = readTable_("PRODUCTS").find((row) => row.product_id === line.product_id);
    const unitsPerPurchaseUnit = Number(line.units_per_purchase_unit || (product && (product.units_per_purchase_unit || product.case_weight_lbs)) || 1) || 1;
    const baseUnit = line.base_unit || (product && product.base_unit) || line.unit_type;
    const locations = readTable_("LOCATIONS");
    const confirmedLocation = locations.find((row) => [row.location_id, row.qr_value].includes(input.confirmed_location_id));
    if (!confirmedLocation) throw new Error("Select or scan a valid warehouse location.");
    const confirmedLocationId = confirmedLocation.location_id;

    const internalLotId = input.internal_lot_id || nextId_("LOTS", "internal_lot_id", "LOT");
    const receivingId = nextId_("RECEIVING", "receiving_id", "RCV");
    const movementId = nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV");
    const acceptedQty = qtyReceived - qtyDamaged;
    const remainingBefore = Number(line.qty_remaining || Math.max(0, Number(line.qty_ordered || 0) - Number(line.qty_received_total || 0)));
    const quantityStatus = acceptedQty > remainingBefore ? "OVER" : acceptedQty < remainingBefore ? "PARTIAL" : "MATCH";
    const approvalStatus = qualityStatus === "PASS" ? "APPROVED" : qualityStatus;
    const acceptedBaseQty = Number(input.actual_base_qty || 0) > 0
      ? Number(input.actual_base_qty)
      : acceptedQty * unitsPerPurchaseUnit;
    ensureTableColumns_("RECEIVING", ["base_unit", "units_per_purchase_unit", "qty_accepted_base", "pallet_count", "quality_status"]);
    ensureTableColumns_("LOTS", ["purchase_qty_received", "purchase_unit_type", "pallet_count", "expiration_date"]);

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
      quality_status: qualityStatus,
      product_accuracy_score: 5,
      over_under_status: quantityStatus,
      recommended_location_id: "",
      confirmed_location_id: confirmedLocationId,
      requires_supervisor_approval: qualityStatus !== "PASS" || quantityStatus === "OVER",
      approval_status: approvalStatus,
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
      status: qualityStatus === "PASS" ? "ACTIVE" : qualityStatus,
      expiration_date: calculatedExpirationDate_(product, new Date()),
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
      approval_status: approvalStatus,
      notes: input.notes || ""
    };

    appendRecord_("RECEIVING", receiving);
    appendRecord_("LOTS", lot);
    appendRecord_("INVENTORY_MOVEMENTS", movement);
    updatePoLineReceived_(input.po_line_id, acceptedQty);
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

function recordAmazonOutbound(payload) {
  payload = payload || {};
  const user = payload.user || {};
  requirePermission_(user, "inventory:adjust");
  const input = payload.input || {};
  const lotKey = String(input.internal_lot_id || "").trim();
  if (!lotKey) throw new Error("Scan or enter an internal lot.");
  const lot = readTable_("LOTS").find((row) =>
    [row.internal_lot_id, row.qr_value, row.supplier_lot_number].includes(lotKey)
  );
  if (!lot) throw new Error("Lot was not found.");
  const qty = Number(input.qty || 0);
  if (!isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than zero.");
  const available = inventorySnapshot()
    .filter((row) => row.internal_lot_id === lot.internal_lot_id && row.location_id === lot.current_location_id)
    .reduce((total, row) => total + Number(row.available_qty || 0), 0);
  if (qty > available + 0.0001) throw new Error(`Only ${available} ${lot.unit_type} is available from this lot.`);

  ensureTableColumns_("INVENTORY_MOVEMENTS", ["related_amazon_order_id"]);
  const movement = {
    movement_id: nextId_("INVENTORY_MOVEMENTS", "movement_id", "MOV"),
    movement_type: "AMAZON_OUT",
    timestamp: new Date(),
    user_id: user.user_id || user.role || "UNKNOWN",
    product_id: lot.product_id,
    internal_lot_id: lot.internal_lot_id,
    package_id: "",
    qty_change: -qty,
    unit_type: input.unit_type || lot.unit_type,
    from_location_id: lot.current_location_id,
    to_location_id: "AMAZON_OUTBOUND",
    related_po_id: lot.po_id || "",
    related_receiving_id: "",
    related_sales_order_id: "",
    related_pick_task_id: "",
    related_amazon_order_id: String(input.amazon_reference || "").trim(),
    scan_code: lotKey,
    device_id: "WEB_APP",
    approval_status: "APPROVED",
    notes: input.notes || ""
  };
  appendRecord_("INVENTORY_MOVEMENTS", movement);
  updateLotQuantity_(lot.internal_lot_id, -qty);
  return movement;
}

function listAmazonOutboundActivity() {
  const products = readTable_("PRODUCTS");
  const lots = readTable_("LOTS");
  return readTable_("INVENTORY_MOVEMENTS")
    .filter((movement) => movement.movement_type === "AMAZON_OUT")
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 25)
    .map((movement) => ({
      ...movement,
      product: products.find((product) => product.product_id === movement.product_id) || null,
      lot: lots.find((lot) => lot.internal_lot_id === movement.internal_lot_id) || null
    }));
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
  const reservedByInventory = buildReservedInventory_();
  const grouped = {};

  movements.forEach((movement) => {
    const qtyChange = Number(movement.qty_change || 0);
    const locationId = qtyChange < 0
      ? movement.from_location_id || movement.to_location_id || ""
      : movement.to_location_id || movement.from_location_id || "";
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
    grouped[key].qty += qtyChange;
  });

  return Object.keys(grouped).map((key) => {
    const row = grouped[key];
    const inventoryKey = salesInventoryKey_(row.product_id, row.internal_lot_id, row.location_id);
    const reservedQty = Number(reservedByInventory[inventoryKey] || 0);
    return {
      ...row,
      reserved_qty: round_(reservedQty, 2),
      available_qty: round_(Math.max(0, Number(row.qty || 0) - reservedQty), 2),
      product: products.find((product) => product.product_id === row.product_id) || null,
      lot: lots.find((lot) => lot.internal_lot_id === row.internal_lot_id) || null
    };
  });
}

function buildReservedInventory_() {
  const reserved = {};
  const lines = readTable_("SALES_ORDER_LINES");
  readTable_("PICK_TASKS").forEach((task) => {
    const reservationStatus = String(task.reservation_status || "RESERVED").toUpperCase();
    const pickStatus = String(task.pick_status || "OPEN").toUpperCase();
    if (reservationStatus === "RELEASED" || ["CANCELLED", "RELEASED"].indexOf(pickStatus) >= 0) return;
    const line = lines.find((item) => item.sales_order_line_id === task.sales_order_line_id) || {};
    const productId = task.product_id || line.product_id;
    const lotId = task.recommended_internal_lot_id || line.preferred_internal_lot_id;
    const locationId = task.recommended_location_id || line.preferred_location_id;
    if (!productId || !lotId || !locationId) return;
    const qty = Number(task.qty_to_pick_base || line.inventory_qty_required || task.qty_to_pick || 0);
    const key = salesInventoryKey_(productId, lotId, locationId);
    reserved[key] = Number(reserved[key] || 0) + qty;
  });
  return reserved;
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

function updateTableRecord_(sheetName, idColumn, idValue, fields) {
  const meta = tableMeta_(sheetName);
  const idIndex = meta.headers.indexOf(idColumn);
  if (idIndex < 0) throw new Error(`Missing ${idColumn} column in ${sheetName}.`);
  for (let row = meta.headerRow + 1; row <= meta.sheet.getLastRow(); row++) {
    if (meta.sheet.getRange(row, idIndex + 1).getValue() !== idValue) continue;
    Object.keys(fields).forEach((field) => {
      const columnIndex = meta.headers.indexOf(field);
      if (columnIndex >= 0) meta.sheet.getRange(row, columnIndex + 1).setValue(fields[field]);
    });
    return;
  }
  throw new Error(`${idValue} was not found in ${sheetName}.`);
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

function nextBlFolio_() {
  const maxFolio = readTable_("SALES_ORDERS").reduce((max, order) => {
    return Math.max(max, Number(order.bl_folio) || 0);
  }, 2719);
  return maxFolio + 1;
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
  const firstReceivedIndex = meta.headers.indexOf("actual_first_received_date");
  const completedIndex = meta.headers.indexOf("actual_completed_date");
  for (let r = meta.headerRow + 1; r <= meta.sheet.getLastRow(); r++) {
    if (meta.sheet.getRange(r, idIndex + 1).getValue() === poId) {
      meta.sheet.getRange(r, statusIndex + 1).setValue(status);
      if (firstReceivedIndex >= 0 && !meta.sheet.getRange(r, firstReceivedIndex + 1).getValue()) {
        meta.sheet.getRange(r, firstReceivedIndex + 1).setValue(new Date());
      }
      if (allReceived && completedIndex >= 0) {
        meta.sheet.getRange(r, completedIndex + 1).setValue(new Date());
      }
      return;
    }
  }
}

function purchaseOrderQrValue_(input) {
  return JSON.stringify({
    v: 1,
    type: "PO_LINE",
    po_id: input.poId,
    po_line_id: input.poLineId,
    product_id: input.productId,
    product_name: input.productName,
    qty: Number(input.qty || 0),
    supplier_lot_number: input.supplierLotNumber || "PENDING"
  });
}

function parsePurchaseOrderQr_(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed && parsed.type === "PO_LINE" && parsed.product_id) {
      return {
        po_id: parsed.po_id || "",
        po_line_id: parsed.po_line_id || "",
        product_id: parsed.product_id,
        product_name: parsed.product_name || "",
        qty: Number(parsed.qty || 0),
        supplier_lot_number: parsed.supplier_lot_number === "PENDING" ? "" : parsed.supplier_lot_number || ""
      };
    }
  } catch (_error) {
    // Continue with legacy pipe-delimited PO QR values.
  }
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
    .filter((po) => po.supplier_id === supplierId && po.order_date && (po.actual_first_received_date || po.actual_completed_date))
    .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
    .slice(0, 10)
    .map((po) => daysBetween_(po.order_date, po.actual_first_received_date || po.actual_completed_date))
    .filter((days) => isFinite(days) && days >= 0);
  if (!leadTimes.length) return 5;
  leadTimes.sort((a, b) => a - b);
  const middle = Math.floor(leadTimes.length / 2);
  const median = leadTimes.length % 2
    ? leadTimes[middle]
    : (leadTimes[middle - 1] + leadTimes[middle]) / 2;
  return Math.round(median);
}

function dateFromInput_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const parts = String(value || "").split("-").map(Number);
  if (parts.length === 3 && parts.every((part) => isFinite(part))) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }
  return new Date();
}

function addDays_(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Math.max(0, Math.round(Number(days || 5))));
  return date;
}

function daysBetween_(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NaN;
  return (endDate.getTime() - startDate.getTime()) / 86400000;
}

function buildSupplierAnalytics_(suppliers, products, purchaseOrders, purchaseOrderLines, receiving, leadTimeBySupplier) {
  const totalSpend = purchaseOrders.reduce((sum, po) => sum + Number(po.total_amount || po.subtotal_amount || 0), 0);
  return suppliers.filter((supplier) => normalizePartyType_(supplier.party_type) === "VENDOR").map((supplier) => {
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
    const locationId = qty < 0
      ? movement.from_location_id || movement.to_location_id || ""
      : movement.to_location_id || movement.from_location_id || "";
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

function buildDashboardMetrics_(products, purchaseOrders, purchaseOrderLines, salesOrders, salesOrderLines, lots, locations, snapshots, planning) {
  const positiveStock = snapshots.filter((row) => Number(row.current_qty || 0) > 0);
  const qtyByLot = {};
  positiveStock.forEach((row) => {
    qtyByLot[row.internal_lot_id] = Number(qtyByLot[row.internal_lot_id] || 0) + Number(row.current_qty || 0);
  });

  const totalInventoryValue = positiveStock.reduce((sum, row) => {
    const lot = lots.find((item) => item.internal_lot_id === row.internal_lot_id) || {};
    return sum + dashboardInventoryValue_(lot, Number(row.current_qty || 0), purchaseOrderLines);
  }, 0);

  const lowStockProducts = planning
    .filter((row) => Number(row.average_daily_usage || 0) > 0 && row.status === "REORDER")
    .map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      current_qty: row.current_qty,
      average_daily_usage: row.average_daily_usage,
      reorder_point: row.reorder_point,
      recommended_order_qty: row.recommended_order_qty,
      days_of_supply: Number(row.average_daily_usage || 0) > 0
        ? round_(Number(row.current_qty || 0) / Number(row.average_daily_usage || 0), 1)
        : 0
    }))
    .sort((a, b) => a.days_of_supply - b.days_of_supply);

  const today = startOfDay_(new Date());
  const expirationLimit = new Date(today.getTime() + 30 * 86400000);
  const expiringLots = lots.map((lot) => {
    const product = products.find((item) => item.product_id === lot.product_id) || {};
    const expirationDate = effectiveExpirationDate_(lot, product);
    const currentQty = Number(qtyByLot[lot.internal_lot_id] || 0);
    if (!expirationDate || currentQty <= 0 || expirationDate < today || expirationDate > expirationLimit) return null;
    return {
      internal_lot_id: lot.internal_lot_id,
      product_id: lot.product_id,
      product_name: product.product_name || lot.product_id,
      current_qty: round_(currentQty, 2),
      unit_type: lot.unit_type || "",
      location_id: lot.current_location_id || "",
      expiration_date: dateKey_(expirationDate),
      days_remaining: Math.ceil((expirationDate.getTime() - today.getTime()) / 86400000),
      inventory_value: round_(dashboardInventoryValue_(lot, currentQty, purchaseOrderLines), 2)
    };
  }).filter((row) => row).sort((a, b) => a.days_remaining - b.days_remaining);

  const activeLocations = locations.filter(isActiveRecord_);
  const activeLocationIds = {};
  activeLocations.forEach((location) => { activeLocationIds[location.location_id] = true; });
  const occupiedLocationIds = {};
  positiveStock.forEach((row) => {
    if (activeLocationIds[row.location_id]) occupiedLocationIds[row.location_id] = true;
  });
  const occupiedLocationCount = Object.keys(occupiedLocationIds).length;
  const openOrders = purchaseOrders.filter(isOpenPurchaseOrder_);
  const openSalesOrders = salesOrders.filter((order) => ["SHIPPED", "CANCELLED", "CLOSED"].indexOf(String(order.status || "").toUpperCase()) < 0);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const shippedThisWeek = salesOrders.filter((order) => {
    if (String(order.status || "").toUpperCase() !== "SHIPPED") return false;
    const shippedDate = new Date(order.shipped_at || order.updated_at || order.order_date || 0);
    return !isNaN(shippedDate.getTime()) && shippedDate >= weekStart;
  });
  const shippedIds = {};
  shippedThisWeek.forEach((order) => { shippedIds[order.sales_order_id] = true; });
  const profitByProduct = {};
  salesOrderLines.filter((line) => shippedIds[line.sales_order_id]).forEach((line) => {
    if (!profitByProduct[line.product_id]) profitByProduct[line.product_id] = { revenue: 0, profit: 0 };
    profitByProduct[line.product_id].revenue += Number(line.line_total || 0);
    profitByProduct[line.product_id].profit += Number(line.estimated_gross_profit || 0);
  });
  const topProfitProduct = Object.keys(profitByProduct).map((productId) => {
    const totals = profitByProduct[productId];
    const product = products.find((item) => item.product_id === productId) || {};
    return {
      product_id: productId,
      product_name: product.product_name || productId,
      gross_profit: round_(totals.profit, 2),
      gross_margin_percent: totals.revenue > 0 ? round_(totals.profit / totals.revenue * 100, 1) : 0
    };
  }).sort((a, b) => b.gross_profit - a.gross_profit)[0] || null;

  return {
    totalInventoryValue: round_(totalInventoryValue, 2),
    lowStockCount: lowStockProducts.length,
    lowStockProducts: lowStockProducts,
    usageHistoryNeededCount: planning.filter((row) => Number(row.usage_days || 0) === 0).length,
    expiringLotCount: expiringLots.length,
    expiringProductCount: unique_(expiringLots.map((row) => row.product_id)).length,
    expiringInventoryValue: round_(expiringLots.reduce((sum, row) => sum + Number(row.inventory_value || 0), 0), 2),
    expiringLots: expiringLots,
    openPoValue: round_(openOrders.reduce((sum, po) => sum + Number(po.total_amount || po.subtotal_amount || 0), 0), 2),
    openSoCount: openSalesOrders.length,
    openSoValue: round_(openSalesOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0), 2),
    weeklySales: round_(shippedThisWeek.reduce((sum, order) => sum + Number(order.total_amount || 0), 0), 2),
    topProfitProduct: topProfitProduct,
    warehouseOccupiedPositions: occupiedLocationCount,
    warehouseTotalPositions: activeLocations.length,
    warehouseCapacityPercent: activeLocations.length ? round_(occupiedLocationCount / activeLocations.length * 100, 1) : 0
  };
}

function isOpenPurchaseOrder_(po) {
  return ["COMPLETE", "CANCELLED", "CLOSED"].indexOf(String(po.po_status || "").toUpperCase()) === -1;
}

function dashboardInventoryValue_(lot, currentQty, purchaseOrderLines) {
  const cost = Number(lot.unit_cost || 0);
  const line = purchaseOrderLines.find((item) => item.po_line_id === lot.po_line_id) || {};
  const purchaseUnit = String(lot.purchase_unit_type || line.unit_type || "").toUpperCase();
  const inventoryUnit = String(lot.unit_type || line.base_unit || "").toUpperCase();
  const lotUnitsPerPurchaseUnit = Number(lot.purchase_qty_received || 0) > 0
    ? Number(lot.original_qty || 0) / Number(lot.purchase_qty_received || 0)
    : 0;
  const unitsPerPurchaseUnit = Number(line.units_per_purchase_unit || lotUnitsPerPurchaseUnit || 1) || 1;
  if (purchaseUnit && inventoryUnit && purchaseUnit !== inventoryUnit && unitsPerPurchaseUnit > 0) {
    return (Number(currentQty || 0) / unitsPerPurchaseUnit) * cost;
  }
  return Number(currentQty || 0) * cost;
}

function isActiveRecord_(record) {
  return record.is_active === undefined
    || record.is_active === ""
    || record.is_active === true
    || String(record.is_active).toUpperCase() === "TRUE";
}

function effectiveExpirationDate_(lot, product) {
  const explicit = startOfDay_(lot.expiration_date);
  if (explicit) return explicit;
  const calculated = calculatedExpirationDate_(product, lot.received_date);
  return calculated ? startOfDay_(calculated) : null;
}

function calculatedExpirationDate_(product, receivedDate) {
  const perishabilityDays = Number(product && product.perishability_days || 0);
  const received = startOfDay_(receivedDate);
  if (perishabilityDays <= 0 || !received) return "";
  return new Date(received.getTime() + perishabilityDays * 86400000);
}

function startOfDay_(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

function normalizePartyType_(value) {
  return String(value || "VENDOR").trim().toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
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
