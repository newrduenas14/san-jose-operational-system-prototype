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
        <thead><tr>${headers.map((h, index) => `
          <th${h.sortable ? ` aria-sort="none"` : ""}>
            ${h.sortable ? `
              <button
                class="table-sort-button"
                type="button"
                data-sort-column="${index}"
                data-sort-type="${h.sortType === "number" ? "number" : "text"}"
                data-sort-direction="${h.sortDirection === "desc" ? "desc" : "asc"}"
              >
                <span>${escapeHtml(h.label)}</span>
                <span class="sort-indicator" aria-hidden="true"></span>
              </button>
            ` : escapeHtml(h.label)}
          </th>
        `).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${headers.map((h) => {
                const sortValue = h.sortable
                  ? (h.sortValue ? h.sortValue(row) : row[h.key])
                  : null;
                const sortAttribute = h.sortable ? ` data-sort-value="${escapeHtml(sortValue)}"` : "";
                return `<td${sortAttribute}>${h.render ? h.render(row) : escapeHtml(row[h.key])}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function enableTableSorting(root = document) {
  root.querySelectorAll(".table-sort-button").forEach((button) => {
    if (button.dataset.sortReady) return;
    button.dataset.sortReady = "true";
    button.addEventListener("click", () => {
      const tableElement = button.closest("table");
      const tbody = tableElement?.tBodies[0];
      if (!tbody) return;

      const column = Number(button.dataset.sortColumn);
      const type = button.dataset.sortType;
      const header = button.closest("th");
      const currentDirection = header.getAttribute("aria-sort");
      const direction = currentDirection === "ascending"
        ? "desc"
        : currentDirection === "descending"
          ? "asc"
          : button.dataset.sortDirection;
      const multiplier = direction === "desc" ? -1 : 1;

      const rows = Array.from(tbody.rows).map((row, index) => ({ row, index }));
      rows.sort((a, b) => {
        const aValue = a.row.cells[column]?.dataset.sortValue ?? "";
        const bValue = b.row.cells[column]?.dataset.sortValue ?? "";
        const aMissing = aValue === "" || (type === "number" && !Number.isFinite(Number(aValue)));
        const bMissing = bValue === "" || (type === "number" && !Number.isFinite(Number(bValue)));
        if (aMissing !== bMissing) return aMissing ? 1 : -1;

        const comparison = type === "number"
          ? Number(aValue) - Number(bValue)
          : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
        return comparison === 0 ? a.index - b.index : comparison * multiplier;
      });
      rows.forEach(({ row }) => tbody.append(row));

      tableElement.querySelectorAll("th[aria-sort]").forEach((item) => item.setAttribute("aria-sort", "none"));
      tableElement.querySelectorAll(".table-sort-button").forEach((item) => {
        item.classList.remove("sort-asc", "sort-desc");
      });
      header.setAttribute("aria-sort", direction === "desc" ? "descending" : "ascending");
      button.classList.add(direction === "desc" ? "sort-desc" : "sort-asc");
    });
  });
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
