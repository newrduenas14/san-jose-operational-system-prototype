let cameraStream;
let scanLoopId;
let barcodeDetector;
let jsQrLoadPromise;

const JS_QR_URLS = [
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js",
  "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js"
];

export function handleKeyboardScan(inputElement, onScanCallback) {
  let lastValue = "";
  const emitScan = () => {
    const value = inputElement.value.trim();
    if (!value || value === lastValue) return;
    lastValue = value;
    onScanCallback(value);
  };

  inputElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    emitScan();
  });
  inputElement.addEventListener("change", emitScan);
  inputElement.addEventListener("blur", emitScan);

  return emitScan;
}

export async function startCameraScanner(targetInputId, onScanCallback) {
  const target = document.getElementById(targetInputId);
  if (!target) throw new Error("Target scan input was not found.");
  await stopCameraScanner();

  const reader = document.getElementById("cameraReader");
  if (!reader) throw new Error("Camera reader area was not found.");
  reader.innerHTML = `
    <video id="scanVideo" class="scan-video" autoplay muted playsinline></video>
    <canvas id="scanCanvas" hidden></canvas>
    <div class="scan-hint">Point the camera at a QR code.</div>
  `;

  const video = document.getElementById("scanVideo");
  const canvas = document.getElementById("scanCanvas");
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
  video.srcObject = cameraStream;
  await video.play();

  let lastScanValue = "";
  let lastScanAt = 0;
  const emitScan = (value) => {
    const normalized = String(value || "").trim();
    const now = Date.now();
    if (!normalized) return;
    if (normalized === lastScanValue && now - lastScanAt < 2500) return;
    lastScanValue = normalized;
    lastScanAt = now;
    target.value = normalized;
    onScanCallback(normalized);
  };

  if ("BarcodeDetector" in window) {
    barcodeDetector = barcodeDetector || new window.BarcodeDetector({ formats: ["qr_code"] });
  } else {
    await ensureJsQrLibrary();
  }

  const scanFrame = async () => {
    if (!cameraStream) return;
    try {
      if (barcodeDetector) {
        const codes = await barcodeDetector.detect(video);
        if (codes.length) emitScan(codes[0].rawValue);
      } else {
        const code = scanWithJsQr(video, canvas);
        if (code) emitScan(code);
      }
    } finally {
      scanLoopId = window.setTimeout(scanFrame, 250);
    }
  };
  scanFrame();
}

export async function stopCameraScanner() {
  if (scanLoopId) {
    window.clearTimeout(scanLoopId);
    scanLoopId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  const reader = document.getElementById("cameraReader");
  if (reader) reader.innerHTML = "";
}

async function ensureJsQrLibrary() {
  if (window.jsQR) return;
  if (!jsQrLoadPromise) {
    jsQrLoadPromise = loadJsQrLibrary();
  }
  await jsQrLoadPromise;
}

async function loadJsQrLibrary() {
  for (const url of JS_QR_URLS) {
    try {
      await loadScript(url);
      if (window.jsQR) return;
    } catch (_error) {
      // Try the next CDN.
    }
  }
  throw new Error("QR scanner library could not load. Check phone internet access and reload.");
}

function scanWithJsQr(video, canvas) {
  if (!window.jsQR || !video.videoWidth || !video.videoHeight) return null;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert"
  });
  return code?.data || null;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("Scanner library load timed out."));
    }, 7000);
    script.src = src;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Scanner library failed to load."));
    };
    document.head.appendChild(script);
  });
}
