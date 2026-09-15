import { OMR, resolveConfig } from "omrjs";
import { configFormatHint, formatConfigPayload } from "./format-config.js";
import { loadMarkerImageFromFile, storableToMarker } from "./marker-image.js";
import {
  appendBlockEditor,
  buildDataFromForm,
  buildSampleMarks,
  defaultBlock,
  defaultData,
  initSheetLayout,
} from "./sheet-layout.js";
import {
  dataToSheetState,
  isValidStoredData,
  loadStoredPayload,
  saveStoredPayload,
} from "./storage.js";
import { buildErrorSuggestions, buildResultWarnings } from "./suggestions.js";
import { createSyntheticSheet } from "./synthetic.js";
import workerUrl from "./worker-entry.js?worker&url";

const controlsPanel = document.querySelector(".controls");
const blocksList = document.getElementById("blocks-list");
const addBlockBtn = document.getElementById("add-block-btn");
const fileInput = document.getElementById("file-input");
const processBtn = document.getElementById("process-btn");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("preview-empty");
const debugGridPanel = document.getElementById("debug-grid-panel");
const debugCanvas = document.getElementById("debug-canvas");
const uploadPreviewBtn = document.getElementById("upload-preview-btn");
const samplePreviewBtn = document.getElementById("sample-preview-btn");
const resultsLoader = document.getElementById("results-loader");
const resultsNotice = document.getElementById("results-notice");
const resultsEl = document.getElementById("results");
const configPreviewEl = document.getElementById("config-preview");
const configFormat = document.getElementById("config-format");
const configFormatHintEl = document.getElementById("config-format-hint");
const statusEl = document.getElementById("status");
const copyConfigBtn = document.getElementById("copy-config-btn");
const copyResultsBtn = document.getElementById("copy-results-btn");

const cornerPattern = document.getElementById("corner-pattern");
const customMarkerPanel = document.getElementById("custom-marker-panel");
const markerFileInput = document.getElementById("marker-file-input");
const uploadMarkerBtn = document.getElementById("upload-marker-btn");
const clearMarkerBtn = document.getElementById("clear-marker-btn");
const markerPreviewWrap = document.getElementById("marker-preview-wrap");
const markerPreview = document.getElementById("marker-preview");
const markerPreviewMeta = document.getElementById("marker-preview-meta");
const cornerSize = document.getElementById("corner-size");

const nccInput = document.getElementById("ncc-threshold");
const fillInput = document.getElementById("fill-threshold");
const nccValue = document.getElementById("ncc-value");
const fillValue = document.getElementById("fill-value");
const outputFormat = document.getElementById("output-format");
const debugMode = document.getElementById("debug-mode");
const orientation = document.getElementById("orientation");

const exposureGamma = document.getElementById("exposure-gamma");
const gammaValue = document.getElementById("gamma-value");
const grayscale = document.getElementById("grayscale");
const detectionScales = document.getElementById("detection-scales");
const cornerSearchMargin = document.getElementById("corner-search-margin");
const marginValue = document.getElementById("margin-value");
const useWorker = document.getElementById("use-worker");

const ctx = preview.getContext("2d", { willReadFrequently: true });
const debugCtx = debugCanvas.getContext("2d");
const markerPreviewCtx = markerPreview.getContext("2d");

const storedPayload = loadStoredPayload();
const sheetState =
  storedPayload?.data && isValidStoredData(storedPayload.data)
    ? dataToSheetState(storedPayload.data)
    : defaultData();

/** @type {{ pixels: Uint8ClampedArray, width: number, height: number } | null} */
let currentImage = null;

/** @type {import('../dist/data.js').ImageMarker | null} */
let customMarker = null;

/** @type {HTMLElement[]} */
const configInputs = [
  cornerPattern,
  cornerSize,
  nccInput,
  fillInput,
  outputFormat,
  debugMode,
  orientation,
  exposureGamma,
  grayscale,
  detectionScales,
  cornerSearchMargin,
  useWorker,
];

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

function syncRangeOutputs() {
  nccValue.textContent = nccInput.value;
  fillValue.textContent = fillInput.value;
  gammaValue.textContent = exposureGamma.value;
  marginValue.textContent = cornerSearchMargin.value;
}

function syncCustomMarkerPanel() {
  const showCustom = cornerPattern.value === "image";
  customMarkerPanel.hidden = !showCustom;
}

function drawMarkerPreview(marker) {
  markerPreview.width = marker.width;
  markerPreview.height = marker.height;
  markerPreviewCtx.putImageData(
    new ImageData(marker.pixels, marker.width, marker.height),
    0,
    0,
  );
  markerPreviewWrap.hidden = false;
  clearMarkerBtn.hidden = false;
  markerPreviewMeta.textContent = `${marker.width}×${marker.height} px`;
}

function clearCustomMarker() {
  customMarker = null;
  markerPreviewWrap.hidden = true;
  clearMarkerBtn.hidden = true;
  markerPreviewMeta.textContent = "";
  markerPreviewCtx.clearRect(0, 0, markerPreview.width, markerPreview.height);
}

async function restoreCustomMarker(stored) {
  if (!stored?.customMarker) return;
  customMarker = await storableToMarker(stored.customMarker);
  cornerPattern.value = "image";
  syncCustomMarkerPanel();
  drawMarkerPreview(customMarker);
  updateConfigPreview();
}

function applyStoredConfig(config) {
  if (config.nccThreshold != null) {
    nccInput.value = String(config.nccThreshold);
  }
  if (config.fillThreshold != null) {
    fillInput.value = String(config.fillThreshold);
  }

  const output = config.outputFormat;
  if (output?.type === "number") {
    outputFormat.value = output.startAt === 0 ? "number-0" : "number-1";
  } else {
    outputFormat.value = "letter";
  }

  if (typeof config.debug === "boolean") {
    debugMode.checked = config.debug;
  }
  if (typeof config.orientation === "string") {
    orientation.value = config.orientation;
  }

  const improvements = config.improvements;
  if (improvements && typeof improvements === "object") {
    if (typeof improvements.grayscale === "string") {
      grayscale.value = improvements.grayscale;
    }
    if (improvements.exposureGamma != null) {
      exposureGamma.value = String(improvements.exposureGamma);
    }
    if (Array.isArray(improvements.detectionScales)) {
      detectionScales.value = improvements.detectionScales.join(", ");
    }
    if (improvements.cornerSearchMargin != null) {
      cornerSearchMargin.value = String(improvements.cornerSearchMargin);
    }
  }

  useWorker.checked =
    typeof config.worker === "object" && config.worker
      ? Boolean(config.worker.enabled)
      : true;

  syncRangeOutputs();
}

function bindRange(input, output) {
  input.addEventListener("input", () => {
    output.textContent = input.value;
    updateConfigPreview();
  });
}

if (storedPayload?.data && isValidStoredData(storedPayload.data)) {
  cornerPattern.value =
    storedPayload.data.cornerPattern === "image" ? "image" : "bullseye";
  cornerSize.value = String(storedPayload.data.cornerSize);
}

if (storedPayload?.config) {
  applyStoredConfig(storedPayload.config);
}

void restoreCustomMarker(storedPayload).catch(() => {
  clearCustomMarker();
});

bindRange(nccInput, nccValue);
bindRange(fillInput, fillValue);
bindRange(exposureGamma, gammaValue);
bindRange(cornerSearchMargin, marginValue);

for (const el of configInputs) {
  el.addEventListener("change", updateConfigPreview);
  el.addEventListener("input", updateConfigPreview);
}

configFormat.addEventListener("change", () => {
  updateConfigFormatHint();
  updateConfigPreview();
});

initSheetLayout(blocksList, sheetState, updateConfigPreview);

addBlockBtn.addEventListener("click", () => {
  appendBlockEditor(blocksList, defaultBlock(), blocksList.children.length);
  updateConfigPreview();
});

function parseDetectionScales(value) {
  const scales = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (scales.length === 0) {
    throw new Error(
      "Detection scales must contain at least one positive number",
    );
  }
  return scales;
}

function getOutputFormat() {
  const value = outputFormat.value;
  if (value === "number-0") return { type: "number", startAt: 0 };
  if (value === "number-1") return { type: "number", startAt: 1 };
  return { type: "letter" };
}

function buildProcessConfig(forRuntime = false) {
  const config = {
    nccThreshold: Number(nccInput.value),
    fillThreshold: Number(fillInput.value),
    outputFormat: getOutputFormat(),
    debug: debugMode.checked,
    orientation: orientation.value,
    improvements: {
      grayscale: grayscale.value,
      exposureGamma: Number(exposureGamma.value),
      detectionScales: parseDetectionScales(detectionScales.value),
      cornerSearchMargin: Number(cornerSearchMargin.value),
    },
  };

  if (useWorker.checked) {
    config.worker = {
      enabled: true,
      url: forRuntime ? workerUrl : "./worker-entry.js",
    };
  }

  return config;
}

function buildExportPayload(forRuntime = false) {
  return {
    data: buildDataFromForm(controlsPanel, customMarker),
    config: buildProcessConfig(forRuntime),
  };
}

function getConfigFormat() {
  return configFormat.value === "json" ? "json" : "js";
}

function buildCopyConfig() {
  return formatConfigPayload(buildExportPayload(false), getConfigFormat());
}

function updateConfigFormatHint() {
  configFormatHintEl.textContent = configFormatHint(getConfigFormat());
}

function updateConfigPreview() {
  try {
    const payload = buildExportPayload(false);
    configPreviewEl.textContent = formatConfigPayload(
      payload,
      getConfigFormat(),
    );
    configPreviewEl.classList.remove("err");
    saveStoredPayload(payload);
  } catch (error) {
    configPreviewEl.textContent =
      error instanceof Error ? error.message : String(error);
    configPreviewEl.classList.add("err");
  }
}

function setPreviewVisible(hasImage) {
  preview.hidden = !hasImage;
  previewEmpty.hidden = hasImage;
}

function clearResults() {
  setSheetProcessingLoading(false);
  setDebugGridVisible(false);
  setResultsNotice(null);
  resultsEl.hidden = false;
  resultsEl.textContent = "Load an image and click Process to see results.";
  copyResultsBtn.disabled = true;
}

function setResultsNotice(html, type = "warn") {
  if (!html) {
    resultsNotice.hidden = true;
    resultsNotice.innerHTML = "";
    resultsNotice.className = "results-notice";
    return;
  }

  resultsNotice.hidden = false;
  resultsNotice.className = `results-notice ${type}`;
  resultsNotice.innerHTML = html;
}

function setSheetProcessingLoading(loading) {
  resultsLoader.hidden = !loading;
  resultsEl.hidden = loading;
  if (!loading) return;

  setDebugGridVisible(false);
  setResultsNotice(null);
}

function updateProcessButtonState() {
  processBtn.disabled =
    document.body.classList.contains("processing") || !currentImage;
}

function setDebugGridVisible(visible) {
  debugGridPanel.hidden = !visible;
}

function drawDebugGrid(gridImage) {
  if (!gridImage) {
    setDebugGridVisible(false);
    return;
  }

  debugCanvas.width = gridImage.width;
  debugCanvas.height = gridImage.height;
  debugCtx.putImageData(
    new ImageData(gridImage.data, gridImage.width, gridImage.height),
    0,
    0,
  );
  setDebugGridVisible(true);
}

function setProcessing(processing) {
  document.body.classList.toggle("processing", processing);
  updateProcessButtonState();
  addBlockBtn.disabled = processing;
  fileInput.disabled = processing;
  copyConfigBtn.disabled = processing;

  for (const el of configInputs) {
    el.disabled = processing;
  }

  uploadMarkerBtn.disabled = processing;
  clearMarkerBtn.disabled = processing;
  markerFileInput.disabled = processing;

  for (const el of blocksList.querySelectorAll("input, button")) {
    el.disabled = processing;
  }

  for (const btn of [uploadPreviewBtn, samplePreviewBtn]) {
    btn.disabled = processing;
  }

  processBtn.textContent = processing ? "Processing…" : "Process sheet";
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function drawToCanvas(pixels, width, height) {
  preview.width = width;
  preview.height = height;
  const imageData = new ImageData(pixels, width, height);
  ctx.putImageData(imageData, 0, 0);
  currentImage = { pixels: new Uint8ClampedArray(pixels), width, height };
  setPreviewVisible(true);
  updateProcessButtonState();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      preview.width = img.width;
      preview.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(url);
      resolve({
        pixels: new Uint8ClampedArray(imageData.data),
        width: img.width,
        height: img.height,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function formatOrientationStatus(orientationInfo) {
  if (!orientationInfo) return "";

  const parts = [];
  if (orientationInfo.appliedRotation > 0) {
    parts.push(`rotated ${orientationInfo.appliedRotation}°`);
  }
  if (orientationInfo.autoFlipped) {
    parts.push("auto-flipped 180°");
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function buildOrientationNoticeHtml(orientationInfo) {
  if (!orientationInfo) return "";

  const parts = [];

  if (
    orientationInfo.appliedRotation === 90 ||
    orientationInfo.appliedRotation === 270
  ) {
    parts.push(
      `<p class="results-notice-title">Image was auto-rotated</p><p>The input was landscape — it was rotated ${orientationInfo.appliedRotation}° clockwise to match the expected portrait orientation.</p>`,
    );
  }

  if (orientationInfo.autoFlipped) {
    const rotationNote =
      orientationInfo.appliedRotation > 0
        ? ` Total rotation applied: ${orientationInfo.appliedRotation}° clockwise.`
        : "";
    parts.push(
      `<p class="results-notice-title">Image was auto-flipped</p><p>Initial orientation yielded no results — the image was rotated 180° automatically.${rotationNote}</p>`,
    );
  }

  return parts.join("");
}

function formatResult(result, elapsedMs) {
  const payload = {
    elapsedMs,
    answers: result.answers,
  };

  if (result.orientation) {
    payload.orientation = result.orientation;
  }

  if (result.debug) {
    payload.debug = {
      scaleFactor: result.debug.scaleFactor,
      corners: result.debug.corners,
      preprocessedSize: result.debug.preprocessed?.length ?? 0,
      gridImageSize: result.debug.gridImage
        ? `${result.debug.gridImage.width}×${result.debug.gridImage.height}`
        : null,
    };
  }

  return JSON.stringify(payload, null, 2);
}

function formatErrorDisplay(error) {
  const { message, suggestions } = buildErrorSuggestions(error);
  return `${message}\n\nSuggestions:\n${suggestions.map((item) => `- ${item}`).join("\n")}`;
}

function renderErrorNotice(error) {
  const { message, suggestions } = buildErrorSuggestions(error);
  const items = suggestions.map((item) => `<li>${item}</li>`).join("");
  setResultsNotice(
    `<p class="results-notice-title">${message}</p><ul>${items}</ul>`,
    "err",
  );
}

function renderResultNotices(result) {
  const parts = [];
  const orientationHtml = buildOrientationNoticeHtml(result.orientation);
  if (orientationHtml) {
    parts.push(orientationHtml);
  }

  const warning = buildResultWarnings(result.answers);
  if (warning) {
    const items = warning.warnings.map((item) => `<li>${item}</li>`).join("");
    const details = warning.details
      .map((item) => `<li><code>${item}</code></li>`)
      .join("");
    parts.push(
      `<p class="results-notice-title">Multiple marks detected in some rows</p><ul>${items}</ul><p class="results-notice-subtitle">Affected rows</p><ul>${details}</ul>`,
    );
  }

  if (parts.length === 0) {
    setResultsNotice(null);
    return;
  }

  const type = warning ? "warn" : "info";
  setResultsNotice(parts.join(""), type);
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied!";
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

async function handleFileSelected(file) {
  if (!file) return;

  setStatus("Loading image…");
  try {
    currentImage = await loadImageFromFile(file);
    clearResults();
    setPreviewVisible(true);
    updateProcessButtonState();
    setStatus(
      `Loaded ${file.name} (${currentImage.width}×${currentImage.height})`,
      "ok",
    );
  } catch (error) {
    currentImage = null;
    setPreviewVisible(false);
    updateProcessButtonState();
    renderErrorNotice(error);
    resultsEl.textContent = formatErrorDisplay(error);
    setStatus(error instanceof Error ? error.message : String(error), "err");
  }
}

function openFilePicker() {
  fileInput.click();
}

function generateSampleSheet() {
  let data;
  try {
    data = buildDataFromForm(controlsPanel);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "err");
    return;
  }

  const marks = buildSampleMarks(data);
  const sheet = createSyntheticSheet(600, 800, data, marks);
  clearResults();
  drawToCanvas(sheet.pixels, sheet.width, sheet.height);
  const usesCustomMarker =
    typeof data.cornerPattern === "object" &&
    data.cornerPattern.type === "image";
  const note = usesCustomMarker ? " (sample corners are always bullseye)" : "";
  setStatus(
    `Sample sheet generated from current layout (600×800)${note}`,
    "ok",
  );
}

async function handleMarkerFileSelected(file) {
  if (!file) return;

  setStatus("Loading marker image…");
  try {
    customMarker = await loadMarkerImageFromFile(file);
    cornerPattern.value = "image";
    syncCustomMarkerPanel();
    drawMarkerPreview(customMarker);
    updateConfigPreview();
    setStatus(
      `Marker loaded: ${file.name} (${customMarker.width}×${customMarker.height})`,
      "ok",
    );
  } catch (error) {
    clearCustomMarker();
    setStatus(error instanceof Error ? error.message : String(error), "err");
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  await handleFileSelected(file);
  fileInput.value = "";
});

uploadPreviewBtn.addEventListener("click", openFilePicker);
samplePreviewBtn.addEventListener("click", generateSampleSheet);

cornerPattern.addEventListener("change", () => {
  syncCustomMarkerPanel();
  updateConfigPreview();
});

uploadMarkerBtn.addEventListener("click", () => {
  markerFileInput.click();
});

clearMarkerBtn.addEventListener("click", () => {
  clearCustomMarker();
  updateConfigPreview();
});

markerFileInput.addEventListener("change", async () => {
  const file = markerFileInput.files?.[0];
  await handleMarkerFileSelected(file);
  markerFileInput.value = "";
});

processBtn.addEventListener("click", async () => {
  if (!currentImage) return;

  let payload;
  try {
    payload = buildExportPayload(true);
    resolveConfig(payload.config);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "err");
    return;
  }

  setProcessing(true);
  setStatus("Processing…");
  setSheetProcessingLoading(true);
  await waitForPaint();

  const omr = new OMR(payload.data, payload.config);
  const started = performance.now();
  const pixels = new Uint8ClampedArray(currentImage.pixels);

  try {
    const result = await omr.process(
      pixels,
      currentImage.width,
      currentImage.height,
    );
    const elapsedMs = Math.round(performance.now() - started);
    setSheetProcessingLoading(false);
    resultsEl.textContent = formatResult(result, elapsedMs);
    renderResultNotices(result);
    drawDebugGrid(result.debug?.gridImage ?? null);
    copyResultsBtn.disabled = false;
    setStatus(
      `Done in ${elapsedMs} ms${formatOrientationStatus(result.orientation)}`,
      "ok",
    );
  } catch (error) {
    setSheetProcessingLoading(false);
    resultsEl.textContent = formatErrorDisplay(error);
    renderErrorNotice(error);
    copyResultsBtn.disabled = true;
    setStatus(error instanceof Error ? error.message : String(error), "err");
  } finally {
    setProcessing(false);
    updateConfigPreview();
  }
});

copyConfigBtn.addEventListener("click", async () => {
  try {
    await copyText(buildCopyConfig(), copyConfigBtn);
  } catch {
    setStatus("Could not copy configuration", "err");
  }
});

copyResultsBtn.addEventListener("click", async () => {
  try {
    await copyText(resultsEl.textContent ?? "", copyResultsBtn);
  } catch {
    setStatus("Could not copy results", "err");
  }
});

setPreviewVisible(false);
setDebugGridVisible(false);
syncCustomMarkerPanel();
updateConfigFormatHint();
updateConfigPreview();
