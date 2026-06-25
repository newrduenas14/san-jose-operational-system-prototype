import * as base from "./api.js?v=inventoryvalue1";

const READ_CACHE_TTL_MS = 45000;
const readCache = new Map();
const pendingReads = new Map();

export const purchaseOrderQrValue = base.purchaseOrderQrValue;
export const resetToSpreadsheetSeed = base.resetToSpreadsheetSeed;

export function warmOperationalCache() {
  [
    () => getDashboard(),
    () => listProducts(),
    () => listSuppliers(),
    () => listPurchaseOrders(),
    () => listSalesOrders(),
    () => inventorySnapshot()
  ].forEach((load, index) => {
    window.setTimeout(() => load().catch(() => {}), index * 350);
  });
}

export function clearApiCache() {
  readCache.clear();
  pendingReads.clear();
}

export const getDashboard = () => cachedRead("getDashboard", [], base.getDashboard);
export const listProducts = () => cachedRead("listProducts", [], base.listProducts);
export const listLots = () => cachedRead("listLots", [], base.listLots);
export const listUsers = () => cachedRead("listUsers", [], base.listUsers);
export const listSuppliers = () => cachedRead("listSuppliers", [], base.listSuppliers);
export const listLocations = () => cachedRead("listLocations", [], base.listLocations);
export const listPurchaseOrders = () => cachedRead("listPurchaseOrders", [], base.listPurchaseOrders);
export const listSalesOrders = () => cachedRead("listSalesOrders", [], base.listSalesOrders);
export const inventorySnapshot = () => cachedRead("inventorySnapshot", [], base.inventorySnapshot);
export const getOperationalReports = () => cachedRead("getOperationalReports", [], base.getOperationalReports);
export const getPurchaseOrderDetail = (poId) => cachedRead("getPurchaseOrderDetail", [poId], () => base.getPurchaseOrderDetail(poId));
export const getSalesOrderDetail = (salesOrderId) => cachedRead("getSalesOrderDetail", [salesOrderId], () => base.getSalesOrderDetail(salesOrderId));
export const listAmazonOutboundActivity = () => cachedRead("listAmazonOutboundActivity", [], base.listAmazonOutboundActivity);

export async function createProduct(user, input) {
  return mutate(() => base.createProduct(user, input));
}
export async function createOpeningInventory(user, input) { return mutate(() => base.createOpeningInventory(user, input)); }

export async function createUser(user, input) {
  return mutate(() => base.createUser(user, input));
}

export async function updateProductStatus(user, productId, isActive) {
  return mutate(() => base.updateProductStatus(user, productId, isActive));
}

export async function createSupplier(user, input) {
  return mutate(() => base.createSupplier(user, input));
}

export async function createPurchaseOrder(user, input) {
  return mutate(() => base.createPurchaseOrder(user, input));
}

export async function purchaseOrderAction(user, poId, action) {
  return mutate(() => base.purchaseOrderAction(user, poId, action));
}

export async function createSalesOrder(user, input) {
  return mutate(() => base.createSalesOrder(user, input));
}

export async function salesOrderAction(user, salesOrderId, action) {
  return mutate(() => base.salesOrderAction(user, salesOrderId, action));
}

export async function receiveProduct(user, input) {
  return mutate(() => base.receiveProduct(user, input));
}

export async function recordInventoryMovement(user, input) {
  return mutate(() => base.recordInventoryMovement(user, input));
}

export async function recordAmazonOutbound(user, input) {
  return mutate(() => base.recordAmazonOutbound(user, input));
}

export async function lookupScan(scanValue) {
  return base.lookupScan(scanValue);
}

export async function matchAmazonPackageScan(scanValue) {
  return mutate(() => base.matchAmazonPackageScan(scanValue));
}

async function cachedRead(name, args, load) {
  const key = `${name}:${JSON.stringify(args)}`;
  const cached = readCache.get(key);
  if (cached && Date.now() - cached.savedAt < READ_CACHE_TTL_MS) {
    return cached.value;
  }
  if (pendingReads.has(key)) {
    return pendingReads.get(key);
  }

  const request = load()
    .then((value) => {
      readCache.set(key, { savedAt: Date.now(), value });
      pendingReads.delete(key);
      return value;
    })
    .catch((error) => {
      pendingReads.delete(key);
      throw error;
    });
  pendingReads.set(key, request);
  return request;
}

async function mutate(load) {
  const result = await load();
  clearApiCache();
  return result;
}
