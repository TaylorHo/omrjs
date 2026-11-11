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
import { createSyntheticSheet } from "./synthetic.js";
import workerUrl from "./worker-entry.js?worker&url";

const el = (id) => document.getElementById(id);
const controls = document.querySelector(".controls");
const preview = el("preview");
const output = el("debug-canvas");
const stored = loadStoredPayload();
let image = null;
let customMarker = null;
let inspection = null;
let busy = false;

function status(message, type = "") {
  el("status").textContent = message;
  el("status").className = `status ${type}`;
}

function pageColor() {
  return el("page-color")
    .value.slice(1)
    .match(/../g)
    .map((v) => Number.parseInt(v, 16));
}

function payload(runtime = false) {
  return {
    data: buildDataFromForm(controls, customMarker),
    config: {
      page: {
        backgroundColor: pageColor(),
        colorTolerance: Number(el("color-tolerance").value),
      },
      aspectRatio: Number(el("aspect-ratio").value),
      rotation: Number(el("rotation").value),
      nccThreshold: Number(el("ncc-threshold").value),
      ...(el("use-worker").checked
        ? {
            worker: {
              enabled: true,
              url: runtime ? workerUrl : "./worker-entry.js",
            },
          }
        : {}),
    },
  };
}

function draw(canvas, raster) {
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas
    .getContext("2d")
    .putImageData(
      new ImageData(raster.data ?? raster.pixels, raster.width, raster.height),
      0,
      0,
    );
}

function drawInput(page) {
  if (!image) return;
  draw(preview, image);
  if (!page) return;
  const ctx = preview.getContext("2d");
  ctx.strokeStyle = "#00aa66";
  ctx.lineWidth = Math.max(2, image.width / 300);
  ctx.beginPath();
  page.outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();
}

function drawInspection() {
  const stage = el("inspection-stage").value;
  const raster =
    stage === "page"
      ? inspection?.page?.image
      : stage === "rectified"
        ? inspection?.rectified
        : inspection?.gridImage;
  el("debug-grid-panel").hidden = !raster;
  if (!raster) return;
  draw(output, raster);
  if (stage === "page" && inspection.markers) {
    const ctx = output.getContext("2d");
    ctx.strokeStyle = "#0099cc";
    ctx.fillStyle = "#005577";
    ctx.lineWidth = Math.max(2, raster.width / 400);
    ctx.font = `${Math.max(12, raster.width / 45)}px sans-serif`;
    inspection.markers.forEach((p, i) => {
      ctx.strokeRect(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height);
      ctx.fillText(
        `${["TL", "TR", "BR", "BL"][i]} ${p.score.toFixed(2)}`,
        Math.max(0, p.x - p.width / 2),
        Math.min(raster.height - 4, p.y + p.height / 2 + raster.width / 40),
      );
    });
  }
  el("stage-hint").textContent =
    stage === "page"
      ? "Original-resolution page crop. Boxes show matched references; labels show corner order and correlation score. The input preview shows the page boundary."
      : stage === "rectified"
        ? "Cropped between marker centers. The reference width is normalized to Corner size, so layout units stay fixed across crops and input resolutions."
        : "Colored rectangles show configured cell bounds. They are not detected cells. Answer recognition and automatic orientation are not run.";
}

function clearResults() {
  inspection = null;
  el("debug-grid-panel").hidden = true;
  el("results-notice").hidden = true;
  el("results").textContent =
    "Load an image and click Rectify sheet to inspect its geometry.";
  el("copy-results-btn").disabled = true;
  for (const option of el("inspection-stage").options) option.disabled = false;
  drawInput();
}

function updateConfig() {
  el("ncc-value").textContent = el("ncc-threshold").value;
  el("tolerance-value").textContent = el("color-tolerance").value;
  el("custom-marker-panel").hidden = el("corner-pattern").value !== "image";
  const format = el("config-format").value;
  el("config-format-hint").textContent = configFormatHint(format);
  try {
    const value = payload();
    resolveConfig(value.config);
    el("config-preview").textContent = formatConfigPayload(value, format);
    el("config-preview").classList.remove("err");
    saveStoredPayload(value);
  } catch (error) {
    el("config-preview").textContent = error.message;
    el("config-preview").classList.add("err");
  }
}

function changed() {
  updateConfig();
  if (inspection) {
    clearResults();
    status("Settings changed. Rectify the sheet again to update the overlays.");
  }
}

function showMarker() {
  el("marker-preview-wrap").hidden = !customMarker;
  el("clear-marker-btn").hidden = !customMarker;
  if (customMarker) {
    draw(el("marker-preview"), customMarker);
    el("marker-preview-meta").textContent =
      `${customMarker.width}×${customMarker.height} px`;
  }
}

function setImage(value) {
  image = value;
  clearResults();
  el("preview").hidden = false;
  el("preview-empty").hidden = true;
  el("process-btn").disabled = false;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("processing", value);
  for (const input of document.querySelectorAll(
    ".controls input, .controls select, .controls button, .preview-actions button",
  ))
    input.disabled = value;
  el("process-btn").disabled = value || !image;
  el("process-btn").textContent = value ? "Rectifying…" : "Rectify sheet";
  el("results-loader").hidden = !value;
  el("results").hidden = value;
}

function showNotice(message, error = false) {
  el("results-notice").textContent = message;
  el("results-notice").className = `results-notice ${error ? "err" : "info"}`;
  el("results-notice").hidden = !message;
}

initSheetLayout(
  el("blocks-list"),
  stored?.data && isValidStoredData(stored.data)
    ? dataToSheetState(stored.data)
    : defaultData(),
  changed,
);
if (stored?.data && isValidStoredData(stored.data)) {
  el("corner-size").value = stored.data.cornerSize;
  el("corner-pattern").value =
    stored.data.cornerPattern === "image" ? "image" : "bullseye";
}
const config = stored?.config;
if (config) {
  if (config.page?.backgroundColor?.length === 3)
    el("page-color").value =
      `#${config.page.backgroundColor.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  if (config.page?.colorTolerance != null)
    el("color-tolerance").value = config.page.colorTolerance;
  if (config.aspectRatio != null) el("aspect-ratio").value = config.aspectRatio;
  if (config.rotation != null) el("rotation").value = String(config.rotation);
  if (config.nccThreshold != null)
    el("ncc-threshold").value = config.nccThreshold;
  el("use-worker").checked = Boolean(config.worker?.enabled);
}

controls.addEventListener("input", (event) => {
  if (!event.target.closest("#blocks-list")) changed();
});
controls.addEventListener("change", (event) => {
  if (!event.target.closest("#blocks-list")) changed();
});
el("add-block-btn").addEventListener("click", () => {
  appendBlockEditor(
    el("blocks-list"),
    defaultBlock(),
    el("blocks-list").children.length,
  );
  changed();
});
el("inspection-stage").addEventListener("change", drawInspection);
el("upload-preview-btn").addEventListener("click", () =>
  el("file-input").click(),
);
el("upload-marker-btn").addEventListener("click", () =>
  el("marker-file-input").click(),
);
el("clear-marker-btn").addEventListener("click", () => {
  customMarker = null;
  showMarker();
  changed();
});

el("file-input").addEventListener("change", async () => {
  const file = el("file-input").files?.[0];
  if (!file || busy) return;
  setBusy(true);
  try {
    const loaded = await loadMarkerImageFromFile(file);
    setImage(loaded);
    status(`Loaded ${file.name} (${loaded.width}×${loaded.height})`, "ok");
  } catch (error) {
    status(error.message, "err");
  } finally {
    el("file-input").value = "";
    setBusy(false);
  }
});
el("marker-file-input").addEventListener("change", async () => {
  const file = el("marker-file-input").files?.[0];
  if (!file || busy) return;
  setBusy(true);
  try {
    customMarker = await loadMarkerImageFromFile(file);
    showMarker();
    changed();
    status(`Loaded marker ${file.name}`, "ok");
  } catch (error) {
    status(error.message, "err");
  } finally {
    el("marker-file-input").value = "";
    setBusy(false);
  }
});
el("sample-preview-btn").addEventListener("click", () => {
  try {
    const { data, config } = payload();
    resolveConfig(config);
    setImage(
      createSyntheticSheet(600, 800, data, buildSampleMarks(data), {
        ...config,
        shape: el("sample-shape").value,
      }),
    );
    status(
      "Sample generated with the current marker, page color, layout, and aspect ratio.",
      "ok",
    );
  } catch (error) {
    status(error.message, "err");
  }
});

el("process-btn").addEventListener("click", async () => {
  if (!image || busy) return;
  let value;
  try {
    value = payload(true);
    resolveConfig(value.config);
  } catch (error) {
    status(error.message, "err");
    return;
  }
  clearResults();
  setBusy(true);
  status("Detecting page and markers, then rectifying…");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const started = performance.now();
  try {
    inspection = await new OMR(value.data, value.config).rectify(
      image.pixels,
      image.width,
      image.height,
    );
    drawInput(inspection.page);
    drawInspection();
    const elapsedMs = Math.round(performance.now() - started);
    el("results").textContent = JSON.stringify(
      {
        elapsedMs,
        pageBounds: inspection.page.bounds,
        markers: inspection.markers,
        rectifiedSize: {
          width: inspection.rectified.width,
          height: inspection.rectified.height,
        },
        scaleFactor: inspection.scaleFactor,
        logicalFrameSize: inspection.logicalSize,
        normalizedReferenceWidth:
          value.data.cornerSize * inspection.scaleFactor,
        rotation: inspection.rotation,
        warnings: inspection.warnings,
      },
      null,
      2,
    );
    showNotice(
      inspection.warnings.length
        ? inspection.warnings.join("\n")
        : "Geometry ready for inspection. Grid rectangles come from your configuration; answers have not been read.",
    );
    el("copy-results-btn").disabled = false;
    status(`Rectified in ${elapsedMs} ms`, "ok");
  } catch (error) {
    if (error.page) {
      inspection = { page: error.page };
      el("inspection-stage").value = "page";
      for (const option of el("inspection-stage").options)
        option.disabled = option.value !== "page";
      drawInput(error.page);
      drawInspection();
    }
    el("results").textContent = JSON.stringify(
      { stage: error.stage ?? "input", error: error.message },
      null,
      2,
    );
    showNotice(error.message, true);
    status(`${error.stage ?? "Input"}: ${error.message}`, "err");
  } finally {
    setBusy(false);
  }
});

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => {
      button.textContent = previous;
    }, 1500);
  } catch {
    status("Could not copy to clipboard", "err");
  }
}
el("copy-config-btn").addEventListener("click", () => {
  try {
    void copy(
      formatConfigPayload(payload(), el("config-format").value),
      el("copy-config-btn"),
    );
  } catch (error) {
    status(error.message, "err");
  }
});
el("copy-results-btn").addEventListener("click", () =>
  copy(el("results").textContent, el("copy-results-btn")),
);

// Complete marker restoration before saving, so an unfinished restore cannot overwrite it.
async function initialize() {
  if (stored?.customMarker) {
    setBusy(true);
    try {
      customMarker = await storableToMarker(stored.customMarker);
      showMarker();
    } catch (error) {
      status(error.message, "err");
    } finally {
      setBusy(false);
    }
  }
  updateConfig();
}
void initialize();
