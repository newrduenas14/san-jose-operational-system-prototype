import { lookupScan } from "../js/api.js?v=phonefix2";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=scanfix1";
import { escapeHtml, notice } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Scanner Test", "Use camera QR scanning or a keyboard-style scanner");
  ctx.view.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>Scan Lookup</h2>
        <div class="actions">
          <button id="startCamera" class="btn" type="button">Start Camera</button>
          <button id="stopCamera" class="btn secondary" type="button">Stop Camera</button>
        </div>
      </div>
      <div class="scan-box">
        <div class="field">
          <label>Scan value</label>
          <input id="scanInput" autocomplete="off" placeholder="Focus here, scan, then press Enter">
        </div>
        <button id="lookupScan" class="btn secondary" type="button">Lookup</button>
        <div id="cameraReader"></div>
        <div id="scanResult" class="result">Try spreadsheet values like PROD-001, LOT-000001, LOC-B-02-01, PKG-000001.</div>
      </div>
    </section>
  `;

  const input = document.getElementById("scanInput");
  const onScan = async (value) => {
    const result = document.getElementById("scanResult");
    result.textContent = `Looking up ${value}...`;
    try {
      const match = await lookupScan(value);
      result.innerHTML = match
        ? `<strong>${match.type}</strong><pre>${escapeHtml(JSON.stringify(match.record, null, 2))}</pre>`
        : `No match for <strong>${escapeHtml(value)}</strong>.`;
    } catch (error) {
      result.textContent = error.message;
    }
  };
  const runLookup = handleKeyboardScan(input, onScan);
  document.getElementById("lookupScan").addEventListener("click", runLookup);
  document.getElementById("startCamera").addEventListener("click", async () => {
    try {
      notice("Starting camera scanner...");
      await startCameraScanner("scanInput", onScan);
      notice("Camera scanner is ready.");
    } catch (error) {
      notice(error.message);
    }
  });
  document.getElementById("stopCamera").addEventListener("click", stopCameraScanner);
}
