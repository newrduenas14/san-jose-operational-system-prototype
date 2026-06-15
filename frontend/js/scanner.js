let cameraScanner;

export function handleKeyboardScan(inputElement, onScanCallback) {
  inputElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = inputElement.value.trim();
    if (value) onScanCallback(value);
  });
}

export async function startCameraScanner(targetInputId, onScanCallback) {
  const target = document.getElementById(targetInputId);
  if (!target) throw new Error("Target scan input was not found.");
  if (!window.Html5Qrcode) {
    throw new Error("Camera scanner library is not loaded. Check internet access and reload.");
  }
  await stopCameraScanner();
  const readerId = "cameraReader";
  cameraScanner = new window.Html5Qrcode(readerId);
  await cameraScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      target.value = decodedText;
      onScanCallback(decodedText);
    }
  );
}

export async function stopCameraScanner() {
  if (!cameraScanner) return;
  try {
    await cameraScanner.stop();
    await cameraScanner.clear();
  } finally {
    cameraScanner = null;
  }
}
