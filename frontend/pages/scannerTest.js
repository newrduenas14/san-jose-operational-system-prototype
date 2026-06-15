import { lookupScan } from "../js/api.js?v=phonefix2";
import { handleKeyboardScan, startCameraScanner, stopCameraScanner } from "../js/scanner.js?v=scanfix3";
import { escapeHtml, notice } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Scanner Test", "Point the phone camera at a QR code and the record opens");
  ctx.view.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>Camera Scanner</h2>
        <div class="actions">
          <button id="startCamera" class="btn" type="button">Start Scanning</button>
          <button id="stopCamera" class="btn secondary" type="button">Stop Camera</button>
        </div>
      </div>
      <div class="scan-box">
        <div id="cameraReader" class="camera-reader"></div>
        <div id="scanResult" class="result">Tap Start Scanning, allow camera access, then point at a QR code.</div>
        <div class="field">
          <label>Manual backup</label>
          <input id="scanInput" autocomplete="off" placeholder="Optional: type or paste a QR value">
        </div>
        <button id="lookupScan" class="btn secondary" type="button">Lookup</button>
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
