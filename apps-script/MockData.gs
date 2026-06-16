/**
 * Optional mock-data seeder for the San Jose Operations prototype.
 *
 * Paste this into Apps Script as a separate file named MockData.gs.
 * Keep your existing Code.gs in place, then run seedMockOperationalData()
 * once from the Apps Script editor.
 */
function seedMockOperationalData() {
  [
    "AMAZON_SCAN_MATCHES",
    "AMAZON_PACKAGES",
    "INVENTORY_MOVEMENTS",
    "RECEIVING",
    "LOTS",
    "PURCHASE_ORDER_LINES",
    "PURCHASE_ORDERS",
    "PRODUCTS",
    "SUPPLIERS",
    "LOCATIONS"
  ].forEach(clearSeedTable_);

  const suppliers = [
    {
      supplier_id: "SUP-001",
      supplier_name: "Pacific Packaging Co.",
      contact_name: "Laura Chen",
      email: "orders@pacificpackaging.example",
      phone: "408-555-0111",
      address: "1440 Zanker Rd, San Jose, CA",
      payment_terms: "Net 30",
      default_currency: "USD",
      lead_time_expected_days: 5,
      is_active: true,
      notes: "Primary packaging supplier."
    },
    {
      supplier_id: "SUP-002",
      supplier_name: "Bay Area Ingredients",
      contact_name: "Miguel Santos",
      email: "sales@baingredients.example",
      phone: "408-555-0122",
      address: "2200 Junction Ave, San Jose, CA",
      payment_terms: "Net 15",
      default_currency: "USD",
      lead_time_expected_days: 7,
      is_active: true,
      notes: "Bulk ingredient supplier."
    },
    {
      supplier_id: "SUP-003",
      supplier_name: "Golden State Goods",
      contact_name: "Priya Shah",
      email: "support@goldenstategoods.example",
      phone: "408-555-0133",
      address: "3100 De La Cruz Blvd, Santa Clara, CA",
      payment_terms: "Net 30",
      default_currency: "USD",
      lead_time_expected_days: 5,
      is_active: true,
      notes: "Finished goods supplier."
    },
    {
      supplier_id: "SUP-004",
      supplier_name: "South Bay Wholesale",
      contact_name: "Daniel Ruiz",
      email: "po@southbaywholesale.example",
      phone: "408-555-0144",
      address: "900 Commercial St, San Jose, CA",
      payment_terms: "Due on receipt",
      default_currency: "USD",
      lead_time_expected_days: 5,
      is_active: true,
      notes: "General wholesale partner."
    },
    {
      supplier_id: "SUP-005",
      supplier_name: "Sierra Label & Supply",
      contact_name: "Emily Park",
      email: "orders@sierralabel.example",
      phone: "408-555-0155",
      address: "510 Parrott St, San Jose, CA",
      payment_terms: "Net 30",
      default_currency: "USD",
      lead_time_expected_days: 9,
      is_active: true,
      notes: "Labels and thermal supplies."
    }
  ];

  const products = [
    {
      product_id: "PROD-001",
      product_name: "Mini Tornillo",
      product_category: "Hardware",
      default_unit: "BOX",
      case_weight_lbs: 8,
      amazon_sku: "AMZ-MINI-TORNILLO",
      wholesale_sku: "SJ-MT-001",
      barcode_or_qr_value: "PROD-001",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "FAST",
      storage_zone_preference: "Zone B",
      is_active: true,
      notes: "Fast-moving small hardware product."
    },
    {
      product_id: "PROD-002",
      product_name: "Almond Flour 25 lb",
      product_category: "Ingredients",
      default_unit: "BAG",
      case_weight_lbs: 25,
      amazon_sku: "AMZ-ALM-FLOUR-25",
      wholesale_sku: "SJ-AF-025",
      barcode_or_qr_value: "PROD-002",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "MEDIUM",
      storage_zone_preference: "Zone A",
      is_active: true,
      notes: "Keep dry and off floor."
    },
    {
      product_id: "PROD-003",
      product_name: "Retail Label Roll",
      product_category: "Labels",
      default_unit: "ROLL",
      case_weight_lbs: 3,
      amazon_sku: "AMZ-LABEL-ROLL",
      wholesale_sku: "SJ-LR-100",
      barcode_or_qr_value: "PROD-003",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "MEDIUM",
      storage_zone_preference: "Zone C",
      is_active: true,
      notes: "Used for retail packaging."
    },
    {
      product_id: "PROD-004",
      product_name: "Shipping Carton Small",
      product_category: "Packaging",
      default_unit: "BUNDLE",
      case_weight_lbs: 12,
      amazon_sku: "AMZ-CARTON-S",
      wholesale_sku: "SJ-CS-010",
      barcode_or_qr_value: "PROD-004",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "FAST",
      storage_zone_preference: "Zone B",
      is_active: true,
      notes: "Primary outbound shipping carton."
    },
    {
      product_id: "PROD-005",
      product_name: "Organic Dried Mango",
      product_category: "Finished Goods",
      default_unit: "CASE",
      case_weight_lbs: 18,
      amazon_sku: "AMZ-MANGO-ORG",
      wholesale_sku: "SJ-ODM-012",
      barcode_or_qr_value: "PROD-005",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "SLOW",
      storage_zone_preference: "Zone D",
      is_active: true,
      notes: "Slow mover, check freshness."
    },
    {
      product_id: "PROD-006",
      product_name: "Thermal Receipt Paper",
      product_category: "Supplies",
      default_unit: "CASE",
      case_weight_lbs: 15,
      amazon_sku: "AMZ-THERMAL-PAPER",
      wholesale_sku: "SJ-TRP-050",
      barcode_or_qr_value: "PROD-006",
      min_stock_qty: 0,
      target_stock_qty: 0,
      velocity_class: "SLOW",
      storage_zone_preference: "Zone C",
      is_active: true,
      notes: "Internal operations supply."
    }
  ];

  const locations = [
    { location_id: "LOC-A-01-01", zone: "A", aisle: "01", rack: "01", bin: "01", location_type: "PICK", max_capacity_units: 120, is_active: true, notes: "Ingredients pick face" },
    { location_id: "LOC-B-02-01", zone: "B", aisle: "02", rack: "01", bin: "01", location_type: "PICK", max_capacity_units: 240, is_active: true, notes: "Packaging pick face" },
    { location_id: "LOC-C-01-02", zone: "C", aisle: "01", rack: "02", bin: "01", location_type: "RESERVE", max_capacity_units: 160, is_active: true, notes: "Labels and supplies" },
    { location_id: "LOC-D-03-01", zone: "D", aisle: "03", rack: "01", bin: "01", location_type: "RESERVE", max_capacity_units: 90, is_active: true, notes: "Finished goods reserve" }
  ];

  const purchaseOrders = [
    {
      po_id: "PO-000001",
      supplier_id: "SUP-001",
      po_status: "COMPLETE",
      order_date: "2026-05-20",
      expected_delivery_date: "2026-05-25",
      received_date: "2026-05-25",
      completed_date: "2026-05-25",
      created_by: "Admin",
      total_amount: 685,
      currency: "USD",
      qr_code_value: "PROD-004+80+SUP-001-LOT-A",
      notes: "Completed packaging order."
    },
    {
      po_id: "PO-000002",
      supplier_id: "SUP-002",
      po_status: "COMPLETE",
      order_date: "2026-05-23",
      expected_delivery_date: "2026-05-30",
      received_date: "2026-05-31",
      completed_date: "2026-05-31",
      created_by: "Admin",
      total_amount: 1195,
      currency: "USD",
      qr_code_value: "PROD-002+45+SUP-002-LOT-B",
      notes: "Two bags damaged at receiving."
    },
    {
      po_id: "PO-000003",
      supplier_id: "SUP-005",
      po_status: "COMPLETE",
      order_date: "2026-05-28",
      expected_delivery_date: "2026-06-06",
      received_date: "2026-06-08",
      completed_date: "2026-06-08",
      created_by: "Manager",
      total_amount: 455,
      currency: "USD",
      qr_code_value: "PROD-003+60+SUP-005-LOT-C",
      notes: "Received two days after expected date."
    },
    {
      po_id: "PO-000004",
      supplier_id: "SUP-004",
      po_status: "SENT",
      order_date: "2026-06-10",
      expected_delivery_date: "2026-06-15",
      received_date: "",
      completed_date: "",
      created_by: "Admin",
      total_amount: 770,
      currency: "USD",
      qr_code_value: "PROD-001+120+SUP-004-LOT-D",
      notes: "Pending receipt."
    },
    {
      po_id: "PO-000005",
      supplier_id: "SUP-003",
      po_status: "DRAFT",
      order_date: "2026-06-14",
      expected_delivery_date: "2026-06-19",
      received_date: "",
      completed_date: "",
      created_by: "Manager",
      total_amount: 960,
      currency: "USD",
      qr_code_value: "PROD-005+75+SUP-003-LOT-E",
      notes: "Pending approval."
    }
  ];

  const purchaseOrderLines = [
    { po_line_id: "POL-000001", po_id: "PO-000001", product_id: "PROD-004", ordered_qty: 80, received_qty: 80, remaining_qty: 0, unit_cost: 8.56, line_total: 684.8, supplier_lot_number: "SUP-001-LOT-A", notes: "" },
    { po_line_id: "POL-000002", po_id: "PO-000002", product_id: "PROD-002", ordered_qty: 45, received_qty: 43, remaining_qty: 0, unit_cost: 26.56, line_total: 1195.2, supplier_lot_number: "SUP-002-LOT-B", notes: "2 bags damaged and rejected." },
    { po_line_id: "POL-000003", po_id: "PO-000003", product_id: "PROD-003", ordered_qty: 60, received_qty: 60, remaining_qty: 0, unit_cost: 7.58, line_total: 454.8, supplier_lot_number: "SUP-005-LOT-C", notes: "" },
    { po_line_id: "POL-000004", po_id: "PO-000004", product_id: "PROD-001", ordered_qty: 120, received_qty: 0, remaining_qty: 120, unit_cost: 6.42, line_total: 770.4, supplier_lot_number: "SUP-004-LOT-D", notes: "Pending." },
    { po_line_id: "POL-000005", po_id: "PO-000005", product_id: "PROD-005", ordered_qty: 75, received_qty: 0, remaining_qty: 75, unit_cost: 12.8, line_total: 960, supplier_lot_number: "SUP-003-LOT-E", notes: "Pending." }
  ];

  const receiving = [
    { receiving_id: "RCV-000001", po_id: "PO-000001", po_line_id: "POL-000001", product_id: "PROD-004", received_qty: 80, accepted_qty: 80, rejected_qty: 0, supplier_lot_number: "SUP-001-LOT-A", internal_lot_id: "LOT-000001", received_by: "Operator", received_at: "2026-05-25", quality_status: "PASS", quantity_status: "ACCURATE", notes: "Count and quality confirmed." },
    { receiving_id: "RCV-000002", po_id: "PO-000002", po_line_id: "POL-000002", product_id: "PROD-002", received_qty: 45, accepted_qty: 43, rejected_qty: 2, supplier_lot_number: "SUP-002-LOT-B", internal_lot_id: "LOT-000002", received_by: "Operator", received_at: "2026-05-31", quality_status: "PARTIAL", quantity_status: "SHORT", notes: "Rejected damaged bags." },
    { receiving_id: "RCV-000003", po_id: "PO-000003", po_line_id: "POL-000003", product_id: "PROD-003", received_qty: 60, accepted_qty: 60, rejected_qty: 0, supplier_lot_number: "SUP-005-LOT-C", internal_lot_id: "LOT-000003", received_by: "Operator", received_at: "2026-06-08", quality_status: "PASS", quantity_status: "ACCURATE", notes: "Accepted into labels reserve." }
  ];

  const lots = [
    { internal_lot_id: "LOT-000001", product_id: "PROD-004", supplier_id: "SUP-001", supplier_lot_number: "SUP-001-LOT-A", po_id: "PO-000001", received_date: "2026-05-25", expiration_date: "", initial_qty: 80, current_qty_script: 48, location_id: "LOC-B-02-01", lot_status: "AVAILABLE", notes: "Use FIFO." },
    { internal_lot_id: "LOT-000002", product_id: "PROD-002", supplier_id: "SUP-002", supplier_lot_number: "SUP-002-LOT-B", po_id: "PO-000002", received_date: "2026-05-31", expiration_date: "2027-05-31", initial_qty: 43, current_qty_script: 27, location_id: "LOC-A-01-01", lot_status: "AVAILABLE", notes: "Keep dry." },
    { internal_lot_id: "LOT-000003", product_id: "PROD-003", supplier_id: "SUP-005", supplier_lot_number: "SUP-005-LOT-C", po_id: "PO-000003", received_date: "2026-06-08", expiration_date: "", initial_qty: 60, current_qty_script: 51, location_id: "LOC-C-01-02", lot_status: "AVAILABLE", notes: "Labels reserve." }
  ];

  suppliers.forEach((row) => appendRecord_("SUPPLIERS", withSeedDates_(row)));
  products.forEach((row) => appendRecord_("PRODUCTS", withSeedDates_(row)));
  locations.forEach((row) => appendRecord_("LOCATIONS", row));
  purchaseOrders.forEach((row) => appendRecord_("PURCHASE_ORDERS", withSeedDates_(row)));
  purchaseOrderLines.forEach((row) => appendRecord_("PURCHASE_ORDER_LINES", row));
  receiving.forEach((row) => appendRecord_("RECEIVING", row));
  lots.forEach((row) => appendRecord_("LOTS", row));

  [
    seedMovement_("MOV-000001", "PROD-004", "LOT-000001", "RECEIVE", 80, "2026-05-25", "PO-000001", "Received PO-000001"),
    seedMovement_("MOV-000002", "PROD-004", "LOT-000001", "USE", -8, "2026-06-01", "", "Daily outbound usage"),
    seedMovement_("MOV-000003", "PROD-004", "LOT-000001", "USE", -10, "2026-06-04", "", "Daily outbound usage"),
    seedMovement_("MOV-000004", "PROD-004", "LOT-000001", "USE", -14, "2026-06-10", "", "Daily outbound usage"),
    seedMovement_("MOV-000005", "PROD-002", "LOT-000002", "RECEIVE", 43, "2026-05-31", "PO-000002", "Received PO-000002"),
    seedMovement_("MOV-000006", "PROD-002", "LOT-000002", "USE", -5, "2026-06-03", "", "Production usage"),
    seedMovement_("MOV-000007", "PROD-002", "LOT-000002", "USE", -4, "2026-06-07", "", "Production usage"),
    seedMovement_("MOV-000008", "PROD-002", "LOT-000002", "USE", -7, "2026-06-12", "", "Production usage"),
    seedMovement_("MOV-000009", "PROD-003", "LOT-000003", "RECEIVE", 60, "2026-06-08", "PO-000003", "Received PO-000003"),
    seedMovement_("MOV-000010", "PROD-003", "LOT-000003", "USE", -4, "2026-06-11", "", "Labeling usage"),
    seedMovement_("MOV-000011", "PROD-003", "LOT-000003", "USE", -5, "2026-06-14", "", "Labeling usage")
  ].forEach((row) => appendRecord_("INVENTORY_MOVEMENTS", row));

  return {
    suppliers: suppliers.length,
    products: products.length,
    purchase_orders: purchaseOrders.length,
    completed_purchase_orders: purchaseOrders.filter((po) => po.po_status === "COMPLETE").length,
    pending_purchase_orders: purchaseOrders.filter((po) => po.po_status !== "COMPLETE").length
  };
}

function clearSeedTable_(sheetName) {
  const meta = tableMeta_(sheetName);
  const rowCount = meta.sheet.getLastRow() - meta.headerRow;
  if (rowCount > 0) {
    meta.sheet.getRange(meta.headerRow + 1, 1, rowCount, meta.sheet.getLastColumn()).clearContent();
  }
}

function withSeedDates_(record) {
  const now = new Date();
  return {
    ...record,
    created_at: record.created_at || now,
    updated_at: record.updated_at || now
  };
}

function seedMovement_(movementId, productId, lotId, movementType, qtyChange, movementDate, referenceId, notes) {
  return {
    movement_id: movementId,
    product_id: productId,
    internal_lot_id: lotId,
    from_location_id: movementType === "RECEIVE" ? "" : "PICK-FACE",
    to_location_id: movementType === "RECEIVE" ? "RECEIVING" : "",
    movement_type: movementType,
    qty_change: qtyChange,
    movement_date: movementDate,
    reference_type: movementType === "RECEIVE" ? "PO" : "USAGE",
    reference_id: referenceId,
    performed_by: "System Seed",
    notes
  };
}
