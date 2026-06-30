// Dashboard response alignment for GitHub Pages.
// Keep this file after Code.gs in Apps Script so this getDashboard() definition
// returns the metric names expected by frontend/pages/dashboard.js while keeping
// the older metric names for backward compatibility.

function getDashboard() {
  const products = dashboardActiveRows_(dashboardReadTable_("PRODUCTS"));
  const suppliers = dashboardActiveRows_(dashboardReadTable_("SUPPLIERS"));
  const purchaseOrders = dashboardReadTable_("PURCHASE_ORDERS");
  const salesOrders = dashboardReadTable_("SALES_ORDERS");
  const salesLines = dashboardReadTable_("SALES_ORDER_LINES");
  const lots = dashboardReadTable_("LOTS");
  const movements = dashboardReadTable_("INVENTORY_MOVEMENTS");
  const locations = dashboardActiveRows_(dashboardReadTable_("LOCATIONS"));
  const amazonPackages = dashboardReadTable_("AMAZON_PACKAGES");
  const snapshot = inventorySnapshot();

  const productMap = dashboardById_(products, "product_id");
  const lotMap = dashboardById_(lots, "internal_lot_id");
  const inventoryByProduct = dashboardInventoryByProduct_(snapshot);
  const openPurchaseOrders = purchaseOrders.filter(dashboardIsOpenPurchaseOrder_);
  const openSalesOrders = salesOrders.filter(dashboardIsOpenSalesOrder_);
  const lowStockProducts = dashboardLowStockProducts_(products, inventoryByProduct);
  const expiration = dashboardExpirationRisk_(snapshot, lots, productMap, lotMap);
  const sales = dashboardSalesMetrics_(salesOrders, salesLines, productMap);
  const capacity = dashboardWarehouseCapacity_(locations, snapshot);
  const inventoryValue = dashboardInventoryValue_(snapshot, lotMap);

  return {
    productCount: products.length,
    supplierCount: suppliers.length,
    openPoCount: openPurchaseOrders.length,
    lotCount: lots.length,
    movementCount: movements.length,
    pendingAmazonPackages: amazonPackages.filter((pkg) => !pkg.matched_amazon_order_id).length,

    // Existing/legacy names kept so older screens do not break.
    inventoryValue,
    lowStockCount: lowStockProducts.length,
    openSalesOrderCount: openSalesOrders.length,

    // Names expected by frontend/pages/dashboard.js.
    totalInventoryValue: inventoryValue,
    usageHistoryNeededCount: lowStockProducts.filter((row) => !dashboardNumber_(row.average_daily_usage, 0)).length,
    expiringLotCount: expiration.expiringLots.length,
    expiringProductCount: dashboardUnique_(expiration.expiringLots.map((row) => row.product_id)).length,
    expiringInventoryValue: expiration.expiringInventoryValue,
    openPoValue: dashboardSum_(openPurchaseOrders, "total_amount"),
    openSoCount: openSalesOrders.length,
    openSoValue: dashboardSum_(openSalesOrders, "total_amount"),
    weeklySales: sales.weeklySales,
    topProfitProduct: sales.topProfitProduct,
    warehouseCapacityPercent: capacity.warehouseCapacityPercent,
    warehouseOccupiedPositions: capacity.warehouseOccupiedPositions,
    warehouseTotalPositions: capacity.warehouseTotalPositions,
    lowStockProducts,
    expiringLots: expiration.expiringLots
  };
}

function dashboardReadTable_(sheetName) {
  try {
    return readTable_(sheetName);
  } catch (_error) {
    return [];
  }
}

function dashboardActiveRows_(rows) {
  return (rows || []).filter((row) => row && row.is_active !== false && String(row.is_active || "TRUE").toUpperCase() !== "FALSE");
}

function dashboardNumber_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback || 0);
}

function dashboardSum_(rows, field) {
  return (rows || []).reduce((sum, row) => sum + dashboardNumber_(row[field], 0), 0);
}

function dashboardById_(rows, idColumn) {
  return (rows || []).reduce((map, row) => {
    if (row && row[idColumn] !== undefined && row[idColumn] !== "") map[String(row[idColumn])] = row;
    return map;
  }, {});
}

function dashboardUnique_(values) {
  const seen = {};
  return (values || []).filter((value) => {
    const key = String(value || "");
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function dashboardIsOpenPurchaseOrder_(po) {
  const status = String(po.po_status || "").toUpperCase();
  return ["DRAFT", "SENT", "ORDERED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "PARTIAL"].indexOf(status) >= 0;
}

function dashboardIsOpenSalesOrder_(order) {
  const status = String(order.status || "").toUpperCase();
  return ["DRAFT", "CONFIRMED", "PICKED", "OPEN", "PARTIAL"].indexOf(status) >= 0;
}

function dashboardInventoryByProduct_(snapshot) {
  return (snapshot || []).reduce((map, row) => {
    const productId = String(row.product_id || "");
    if (!productId) return map;
    map[productId] = (map[productId] || 0) + dashboardNumber_(row.available_qty !== undefined ? row.available_qty : row.current_qty, 0);
    return map;
  }, {});
}

function dashboardLowStockProducts_(products, inventoryByProduct) {
  return (products || []).map((product) => {
    const productId = String(product.product_id || "");
    const currentQty = dashboardNumber_(inventoryByProduct[productId], 0);
    const averageDailyUsage = dashboardEstimateDailyUsage_(productId);
    const reorderPoint = Math.max(dashboardNumber_(product.min_stock_qty, 0), averageDailyUsage * 7);
    const targetStock = Math.max(dashboardNumber_(product.target_stock_qty, 0), reorderPoint * 1.5);
    const daysOfSupply = averageDailyUsage > 0 ? currentQty / averageDailyUsage : 0;
    const recommendedOrderQty = Math.max(targetStock - currentQty, 0);
    return {
      product_id: productId,
      product_name: product.product_name || productId,
      current_qty: currentQty,
      average_daily_usage: averageDailyUsage,
      reorder_point: reorderPoint,
      target_stock_level: targetStock,
      days_of_supply: daysOfSupply,
      recommended_order_qty: recommendedOrderQty,
      status: currentQty <= reorderPoint ? "REORDER" : currentQty <= targetStock ? "WATCH" : "OK"
    };
  }).filter((row) => row.status !== "OK" || dashboardNumber_(row.recommended_order_qty, 0) > 0);
}

function dashboardEstimateDailyUsage_(productId) {
  const since = new Date(new Date().getTime() - 90 * 86400000);
  const usage = dashboardReadTable_("INVENTORY_MOVEMENTS")
    .filter((move) => String(move.product_id || "") === String(productId || "") && dashboardNumber_(move.qty_change, 0) < 0)
    .filter((move) => !move.timestamp || new Date(move.timestamp) >= since)
    .reduce((sum, move) => sum + Math.abs(dashboardNumber_(move.qty_change, 0)), 0);
  return usage / 90;
}

function dashboardExpirationRisk_(snapshot, lots, productMap, lotMap) {
  const today = dashboardStartOfDay_(new Date());
  const maxDate = new Date(today.getTime() + 30 * 86400000);
  const expiringLots = (snapshot || []).map((row) => {
    const lot = lotMap[String(row.internal_lot_id || "")] || {};
    const product = productMap[String(row.product_id || lot.product_id || "")] || {};
    const expirationDate = dashboardParseDate_(row.expiration_date || lot.expiration_date);
    const currentQty = dashboardNumber_(row.current_qty !== undefined ? row.current_qty : row.available_qty, 0);
    if (!expirationDate || currentQty <= 0 || expirationDate < today || expirationDate > maxDate) return null;
    const unitCost = dashboardLotUnitCost_(lot);
    return {
      product_id: row.product_id || lot.product_id || "",
      product_name: row.product_name || product.product_name || row.product_id || "",
      internal_lot_id: row.internal_lot_id || "",
      current_qty: currentQty,
      unit_type: row.unit_type || lot.unit_type || product.base_unit || "LB",
      location_id: row.location_id || row.location_label || lot.current_location_id || "",
      expiration_date: dashboardDateKey_(expirationDate),
      days_remaining: Math.ceil((expirationDate - today) / 86400000),
      inventory_value: currentQty * unitCost
    };
  }).filter(Boolean);
  return {
    expiringLots,
    expiringInventoryValue: expiringLots.reduce((sum, row) => sum + dashboardNumber_(row.inventory_value, 0), 0)
  };
}

function dashboardInventoryValue_(snapshot, lotMap) {
  const fromSnapshot = (snapshot || []).reduce((sum, row) => {
    const lot = lotMap[String(row.internal_lot_id || "")] || {};
    const qty = dashboardNumber_(row.current_qty !== undefined ? row.current_qty : row.available_qty, 0);
    return qty > 0 ? sum + qty * dashboardLotUnitCost_(lot) : sum;
  }, 0);
  if (fromSnapshot > 0) return fromSnapshot;
  return dashboardReadTable_("LOTS").reduce((sum, lot) => {
    const status = String(lot.status || "ACTIVE").toUpperCase();
    if (status !== "ACTIVE" && status !== "AVAILABLE") return sum;
    return sum + dashboardNumber_(lot.purchase_qty_received || lot.original_qty, 0) * dashboardNumber_(lot.unit_cost, 0);
  }, 0);
}

function dashboardLotUnitCost_(lot) {
  const originalQty = dashboardNumber_(lot.original_qty, 0);
  const purchaseQty = dashboardNumber_(lot.purchase_qty_received, 0);
  const unitCost = dashboardNumber_(lot.unit_cost, 0);
  if (originalQty > 0 && purchaseQty > 0) return unitCost / (originalQty / purchaseQty);
  return unitCost;
}

function dashboardSalesMetrics_(salesOrders, salesLines, productMap) {
  const since = new Date(new Date().getTime() - 7 * 86400000);
  const shippedOrders = (salesOrders || []).filter((order) => String(order.status || "").toUpperCase() === "SHIPPED");
  const weeklySales = shippedOrders
    .filter((order) => dashboardOrderDate_(order) >= since)
    .reduce((sum, order) => sum + dashboardNumber_(order.total_amount, 0), 0);
  const shippedIds = shippedOrders.reduce((map, order) => {
    map[String(order.sales_order_id || "")] = true;
    return map;
  }, {});
  const profitByProduct = {};
  (salesLines || []).filter((line) => shippedIds[String(line.sales_order_id || "")]).forEach((line) => {
    const productId = String(line.product_id || "");
    if (!productId) return;
    if (!profitByProduct[productId]) {
      const product = productMap[productId] || {};
      profitByProduct[productId] = { product_id: productId, product_name: product.product_name || productId, gross_profit: 0, sales: 0 };
    }
    profitByProduct[productId].gross_profit += dashboardNumber_(line.estimated_gross_profit, 0);
    profitByProduct[productId].sales += dashboardNumber_(line.line_total, 0);
  });
  const topProfitProduct = Object.keys(profitByProduct).map((key) => {
    const row = profitByProduct[key];
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      gross_profit: row.gross_profit,
      gross_margin_percent: row.sales ? row.gross_profit / row.sales * 100 : 0
    };
  }).sort((a, b) => b.gross_profit - a.gross_profit)[0] || null;
  return { weeklySales, topProfitProduct };
}

function dashboardWarehouseCapacity_(locations, snapshot) {
  const activeLocations = (locations || []).filter((location) => String(location.location_type || "").toUpperCase() !== "DOCK");
  const occupied = {};
  (snapshot || []).forEach((row) => {
    const qty = dashboardNumber_(row.current_qty !== undefined ? row.current_qty : row.available_qty, 0);
    const locationId = String(row.location_id || row.location_label || "");
    if (qty > 0 && locationId) occupied[locationId] = true;
  });
  const total = activeLocations.length || (locations || []).length;
  const occupiedCount = Object.keys(occupied).length;
  return {
    warehouseTotalPositions: total,
    warehouseOccupiedPositions: occupiedCount,
    warehouseCapacityPercent: total ? occupiedCount / total * 100 : 0
  };
}

function dashboardOrderDate_(order) {
  return dashboardParseDate_(order.shipped_at || order.order_date || order.created_at) || new Date(0);
}

function dashboardParseDate_(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : dashboardStartOfDay_(date);
}

function dashboardStartOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dashboardDateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
