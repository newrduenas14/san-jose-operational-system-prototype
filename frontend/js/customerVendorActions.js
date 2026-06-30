import { GOOGLE_SCRIPT_WEB_APP_URL } from "./config.js?v=opening1";
import { requirePermission } from "./permissions.js";

const DB_KEY = "sjops.database.v1";
const APPS_REQUEST_TIMEOUT_MS = 15000;

export async function updateSupplier(user, input) {
  if (useAppsScript()) {
    try {
      return await callAppsScript("updateSupplier", { user, input });
    } catch (error) {
      throw customerVendorMutationError(error, "editing");
    }
  }

  requirePermission(user, "suppliers:edit");
  const data = await localDb();
  const supplierId = String(input.supplier_id || "").trim();
  const record = data.suppliers.find((item) => String(item.supplier_id || "") === supplierId);
  if (!record) throw new Error("Business record was not found.");
  const next = normalizePartyInput(input, record);
  if (!next.supplier_name) throw new Error("Business name is required.");
  Object.assign(record, next, { updated_at: new Date().toISOString() });
  saveLocalDb(data);
  return record;
}

export async function deactivateSupplier(user, supplierId) {
  if (useAppsScript()) {
    try {
      return await callAppsScript("deactivateSupplier", { user, supplierId });
    } catch (error) {
      throw customerVendorMutationError(error, "deleting");
    }
  }

  requirePermission(user, "suppliers:edit");
  const data = await localDb();
  const id = String(supplierId || "").trim();
  const record = data.suppliers.find((item) => String(item.supplier_id || "") === id);
  if (!record) throw new Error("Business record was not found.");
  record.is_active = false;
  record.updated_at = new Date().toISOString();
  saveLocalDb(data);
  return record;
}

function useAppsScript() {
  return Boolean(GOOGLE_SCRIPT_WEB_APP_URL && GOOGLE_SCRIPT_WEB_APP_URL.includes("/exec"));
}

function callAppsScript(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callback = `sjopsCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Apps Script request timed out. Check deployment access and version."));
    }, APPS_REQUEST_TIMEOUT_MS);
    const url = new URL(GOOGLE_SCRIPT_WEB_APP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("payload", JSON.stringify(payload));
    url.searchParams.set("callback", callback);

    const cleanup = () => {
      window.clearTimeout(timer);
      delete window[callback];
      script.remove();
    };

    window[callback] = (data) => {
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "Apps Script request failed."));
        return;
      }
      clearAppsCache();
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

function clearAppsCache() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("sjops.apps.cache."))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch (_error) {
    // Cache clearing is best-effort.
  }
}

async function localDb() {
  const saved = localStorage.getItem(DB_KEY);
  if (saved) return JSON.parse(saved);
  const response = await fetch("../data/spreadsheetSeed.json");
  if (!response.ok) throw new Error("Could not load spreadsheet seed data.");
  const data = await response.json();
  saveLocalDb(data);
  return data;
}

function saveLocalDb(data) {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

function normalizePartyInput(input, existing = {}) {
  const partyType = String(input.party_type || existing.party_type || "VENDOR").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "VENDOR";
  return {
    supplier_id: String(existing.supplier_id || input.supplier_id || "").trim(),
    party_type: partyType,
    supplier_name: String(input.supplier_name || "").trim(),
    contact_name: String(input.contact_name || "").trim(),
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    address: String(input.address || "").trim(),
    payment_terms: String(input.payment_terms || "Net 30").trim(),
    default_currency: String(input.default_currency || "USD").trim().toUpperCase(),
    lead_time_expected_days: partyType === "VENDOR" ? Number(input.lead_time_expected_days || existing.lead_time_expected_days || 5) : "",
    is_active: true,
    notes: String(input.notes || "").trim()
  };
}

function customerVendorMutationError(error, actionLabel) {
  const message = String(error?.message || error || "");
  if (message.includes("Unknown action")) {
    return new Error(`Customer/vendor ${actionLabel} is ready in GitHub, but the deployed Google Apps Script is not current. Add updateSupplier/deactivateSupplier to Apps Script and deploy a new Web App version.`);
  }
  if (message.includes("timed out") || message.includes("Could not reach Apps Script")) {
    return new Error(`Customer/vendor ${actionLabel} could not reach the spreadsheet backend. Check the Apps Script /exec URL and Web App access settings.`);
  }
  return error;
}
