import { lookupScan } from "../js/api.js";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js";
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
        <div id="cameraReader"></div>
        <div id="scanResult" class="result">Try spreadsheet values like PROD-001, LOT-000001, LOC-B-02-01, PKG-000001.</div>
      </div>
    </section>
  `;

  const input = document.getElementById("scanInput");
  const onScan = async (value) => {
    const match = await lookupScan(value);
    document.getElementById("scanResult").innerHTML = match
      ? `<strong>${match.type}</strong><pre>${escapeHtml(JSON.stringify(match.record, null, 2))}</pre>`
      : `No match for <strong>${escapeHtml(value)}</strong>.`;
  };
  handleKeyboardScan(input, onScan);
  document.getElementById("startCamera").addEventListener("click", async () => {
    try {
      await startCameraScanner("scanInput", onScan);
    } catch (error) {
      notice(error.message);
    }
  });
  document.getElementById("stopCamera").addEventListener("click", stopCameraScanner);
}
