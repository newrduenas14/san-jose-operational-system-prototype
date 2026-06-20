import { matchAmazonPackageScan } from "../js/api-smooth1.js?v=parties1";
import { handleKeyboardScan } from "../js/scanner.js";
import { escapeHtml } from "../js/utils.js";

export async function render(ctx) {
  ctx.setTitle("Amazon Match", "Package scan placeholder for future Amazon API flow");
  ctx.view.innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Scan Amazon Package</h2></div>
      <div class="scan-box">
        <div class="field">
          <label>Package QR</label>
          <input id="amazonScan" placeholder="Try PKG-000001 and press Enter">
        </div>
        <div id="amazonResult" class="result">Waiting for package scan.</div>
      </div>
    </section>
  `;

  handleKeyboardScan(document.getElementById("amazonScan"), async (value) => {
    const result = await matchAmazonPackageScan(value);
    document.getElementById("amazonResult").innerHTML = `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
  });
}
