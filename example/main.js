import { OMR, resolveConfig } from "omrjs";
import { renderLayoutGrid } from "../dist/core/debug-render.js";
import { configFormatHint, formatConfigPayload } from "./format-config.js";
import { loadMarkerImageFromFile, storableToMarker } from "./marker-image.js";
import {
  appendBlockEditor,
  buildDataFromForm,
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
import workerUrl from "./worker-entry.js?worker&url";

const el = (id) => document.getElementById(id);
const controls = document.querySelector(".controls");
const output = el("debug-canvas");
const stored = loadStoredPayload();
let image = null;
let customMarker = null;
let inspection = null;
let recognition = null;
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
      orientation: el("orientation").value,
      fillThreshold: Number(el("fill-threshold").value),
      debug: el("debug").checked,
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

function drawInspection() {
  const stages = {
    original: image,
    page: inspection?.page?.image,
    rectified: inspection?.rectified,
    grid: inspection?.gridImage,
  };
  const select = el("inspection-stage");
  for (const option of select.options) {
    option.disabled = !stages[option.value];
    if (option.value === "grid")
      option.textContent = recognition?.debug
        ? "Detected cells and answers"
        : "Configured cell positions";
  }
  if (!stages[select.value]) select.value = "original";
  const stage = select.value;
  const raster = stages[stage];
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
    stage === "original"
      ? "Uploaded image. Process the sheet to find markers and validate the configured cells."
      : stage === "page"
        ? "Original-resolution page crop. Boxes show matched references; labels show corner order and correlation score."
        : stage === "rectified"
          ? "Cropped between marker centers. The reference width is normalized to Corner size, so layout units stay fixed across crops and input resolutions."
          : recognition
            ? "Detected outlines: blue = blank, green = marked, orange = uncertain. Point at a cell to inspect the returned ink and fill measurements."
            : "These rectangles show the configured cell positions on the rectified page. Edit the blocks to move or resize them, then process again to validate and read answers.";
}

function clearResults(geometry = null) {
  inspection = geometry;
  recognition = null;
  el("cell-detail").textContent = "";
  el("results-notice").hidden = true;
  el("results").textContent =
    "Load an image and click Process sheet to inspect recognized answers.";
  el("copy-results-btn").disabled = true;
  el("inspection-stage").value = geometry ? "grid" : "original";
  drawInspection();
}

function updateConfig() {
  el("fill-value").textContent = el("fill-threshold").value;
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

function changed(layoutOnly = false) {
  const geometry = layoutOnly && inspection?.rectified ? inspection : null;
  updateConfig();
  clearResults(geometry);
  if (geometry) {
    try {
      const data = payload().data;
      if (
        data.answersBlocks.some(
          (block) =>
            Math.min(
              block.startX,
              block.startY,
              block.gaps.columns,
              block.gaps.rows,
            ) < 0 || Math.min(block.width, block.height ?? block.width) <= 0,
        ) ||
        data.answersBlocks.reduce(
          (count, block) => count + block.rows * block.columns,
          0,
        ) > 100_000
      )
        throw new Error(
          "Use nonnegative positions/gaps, positive dimensions, and at most 100,000 cells.",
        );
      const grid = renderLayoutGrid(
        geometry.rectified,
        data,
        geometry.scaleFactor,
      );
      inspection.gridImage = grid.image;
      el("inspection-stage").value = "grid";
      drawInspection();
      if (grid.warnings.length) showNotice(grid.warnings.join("\n"));
    } catch (error) {
      // Invalid intermediate input must not leave an old grid looking current.
      inspection.gridImage = null;
      drawInspection();
      showNotice(error.message, true);
    }
  }
  if (image)
    status("Settings changed. Process the sheet again to update the results.");
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
  el("process-btn").disabled = false;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("processing", value);
  for (const input of document.querySelectorAll(
    ".controls input, .controls select, .controls button",
  ))
    input.disabled = value;
  el("process-btn").disabled = value || !image;
  el("process-btn").textContent = value ? "Processing…" : "Process sheet";
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
  () => changed(true),
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
  if (config.orientation != null)
    el("orientation").value = config.orientation === "none" ? "none" : "auto";
  if (config.fillThreshold != null)
    el("fill-threshold").value = config.fillThreshold;
  if (config.rotation != null) el("rotation").value = String(config.rotation);
  if (config.nccThreshold != null)
    el("ncc-threshold").value = config.nccThreshold;
  el("use-worker").checked = Boolean(config.worker?.enabled);
  el("debug").checked = Boolean(config.debug);
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
  changed(true);
});
el("inspection-stage").addEventListener("change", drawInspection);
el("upload-image-btn").addEventListener("click", () =>
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
  status("Detecting page, markers, orientation, grid, and answers…");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const started = performance.now();
  try {
    // The example always needs inspection images; the checkbox controls JSON diagnostics.
    recognition = await new OMR(value.data, {
      ...value.config,
      debug: true,
    }).process(image.pixels, image.width, image.height);
    inspection = recognition.debug;
    if (inspection) el("inspection-stage").value = "grid";
    drawInspection();
    const elapsedMs = Math.round(performance.now() - started);
    el("results").textContent = JSON.stringify(
      recognition,
      (key, entry) =>
        (key === "debug" && !value.config.debug) ||
        entry instanceof Uint8ClampedArray
          ? undefined
          : entry,
      2,
    );
    showNotice(
      recognition.warnings.length
        ? recognition.warnings.join("\n")
        : "Answers recognized.",
    );
    el("copy-results-btn").disabled = false;
    status(`Processed in ${elapsedMs} ms`, "ok");
  } catch (error) {
    if (error.page) {
      inspection = error.inspection ?? { page: error.page };
      el("inspection-stage").value = error.inspection ? "grid" : "page";
      drawInspection();
    }
    el("results").textContent = JSON.stringify(
      {
        stage: error.stage ?? "input",
        error: error.message,
        ...(value.config.debug && error.inspection
          ? {
              markers: error.inspection.markers,
              logicalFrameSize: error.inspection.logicalSize,
              warnings: error.inspection.warnings,
            }
          : {}),
      },
      null,
      2,
    );
    showNotice(error.message, true);
    status(`${error.stage ?? "Input"}: ${error.message}`, "err");
  } finally {
    setBusy(false);
  }
});

output.addEventListener("pointermove", (event) => {
  if (!recognition?.debug || el("inspection-stage").value !== "grid") return;
  const bounds = output.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) * output.width) / bounds.width;
  const y = ((event.clientY - bounds.top) * output.height) / bounds.height;
  let detail = "Point at a detected cell to inspect its measurements.";
  for (const [bi, block] of recognition.debug.cells.entries())
    for (const [ri, row] of block.entries())
      for (const [ci, cell] of row.entries()) {
        if (
          x >= cell.x &&
          x < cell.x + cell.width &&
          y >= cell.y &&
          y < cell.y + cell.height
        )
          detail = `Block ${bi + 1}, row ${ri + 1}, column ${ci + 1}: ${cell.status}\nInk ${(cell.inkRatio * 100).toFixed(1)}%, compensated fill ${(cell.fillRatio * 100).toFixed(1)}%, outline ${(cell.outlineScore * 100).toFixed(1)}%\nRow answers: ${JSON.stringify(recognition.answers[bi][ri])}`;
      }
  el("cell-detail").textContent = detail;
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
