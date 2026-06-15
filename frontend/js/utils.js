export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function uid(prefix, list, key) {
  const next = list.length + 1;
  let value = `${prefix}-${String(next).padStart(6, "0")}`;
  let n = next;
  const existing = new Set(list.map((item) => item[key]));
  while (existing.has(value)) {
    n += 1;
    value = `${prefix}-${String(n).padStart(6, "0")}`;
  }
  return value;
}

export function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No records yet.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${headers.map((h) => `<td>${h.render ? h.render(row) : escapeHtml(row[h.key])}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function status(value) {
  const text = escapeHtml(value || "UNKNOWN");
  const cls = /active|available|approved|matched|ready|ok/i.test(text)
    ? "ok"
    : /pending|draft|ordered|partial/i.test(text)
      ? "warn"
      : "";
  return `<span class="status ${cls}">${text}</span>`;
}

export function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function notice(message) {
  const el = $("#notice");
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(notice.timer);
  notice.timer = window.setTimeout(() => {
    el.hidden = true;
  }, 4200);
}
