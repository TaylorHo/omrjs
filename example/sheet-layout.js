/** @typedef {import('../dist/data.js').Data} Data */
/** @typedef {import('../dist/data.js').ImageMarker} ImageMarker */

export const defaultBlock = () => ({
  startX: 200,
  startY: 200,
  rows: 4,
  columns: 5,
  width: 80,
  height: "",
  gaps: { columns: 20, rows: 20 },
});

export const defaultData = () => ({
  cornerPattern: "bullseye",
  cornerSize: 100,
  blocks: [defaultBlock(), { ...defaultBlock(), startX: 800 }],
});

/**
 * @param {string} value
 * @param {string} label
 */
function parseNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number`);
  }
  return n;
}

/**
 * @param {HTMLFieldSetElement} fieldset
 */
function readBlockFromFieldset(fieldset) {
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = Object.fromEntries(
    [...fieldset.querySelectorAll("[data-field]")].map((el) => [
      el.dataset.field,
      /** @type {HTMLInputElement} */ (el),
    ]),
  );

  const block = {
    startX: parseNumber(inputs.startX.value, "startX"),
    startY: parseNumber(inputs.startY.value, "startY"),
    rows: Math.max(1, Math.round(parseNumber(inputs.rows.value, "rows"))),
    columns: Math.max(
      1,
      Math.round(parseNumber(inputs.columns.value, "columns")),
    ),
    width: parseNumber(inputs.width.value, "width"),
    gaps: {
      columns: parseNumber(inputs.gapColumns.value, "column gap"),
      rows: parseNumber(inputs.gapRows.value, "row gap"),
    },
  };

  const heightRaw = inputs.height.value.trim();
  if (heightRaw !== "") {
    block.height = parseNumber(heightRaw, "height");
  }

  return block;
}

/**
 * @param {HTMLElement} container
 * @param {ImageMarker | null} customMarker
 */
export function buildDataFromForm(container, customMarker = null) {
  const cornerPatternValue = /** @type {HTMLSelectElement} */ (
    container.querySelector("#corner-pattern")
  ).value;
  const cornerSize = parseNumber(
    /** @type {HTMLInputElement} */ (container.querySelector("#corner-size"))
      .value,
    "corner size",
  );

  const blockEls = container.querySelectorAll(".block-editor");
  if (blockEls.length === 0) {
    throw new Error("Add at least one answer block");
  }

  /** @type {Data["cornerPattern"]} */
  let cornerPattern = "bullseye";
  if (cornerPatternValue === "image") {
    if (!customMarker) {
      throw new Error("Upload a marker image for the custom corner pattern");
    }
    cornerPattern = customMarker;
  }

  /** @type {Data} */
  const data = {
    cornerPattern,
    cornerSize,
    answersBlocks: [...blockEls].map((el) =>
      readBlockFromFieldset(/** @type {HTMLFieldSetElement} */ (el)),
    ),
  };

  return data;
}

/**
 * @param {object} block
 */
function blockFieldsHtml(block, index) {
  return `
    <legend>Block ${index + 1}</legend>
    <div class="block-grid">
      <label class="field">
        <span>startX</span>
        <input data-field="startX" type="number" step="any" value="${block.startX}" />
      </label>
      <label class="field">
        <span>startY</span>
        <input data-field="startY" type="number" step="any" value="${block.startY}" />
      </label>
      <label class="field">
        <span>Rows</span>
        <input data-field="rows" type="number" min="1" step="1" value="${block.rows}" />
      </label>
      <label class="field">
        <span>Columns</span>
        <input data-field="columns" type="number" min="1" step="1" value="${block.columns}" />
      </label>
      <label class="field">
        <span>Width</span>
        <input data-field="width" type="number" step="any" min="1" value="${block.width}" />
      </label>
      <label class="field">
        <span>Height</span>
        <input data-field="height" type="number" step="any" min="1" value="${block.height ?? ""}" placeholder="= width" />
      </label>
      <label class="field">
        <span>Column gap</span>
        <input data-field="gapColumns" type="number" step="any" min="0" value="${block.gaps.columns}" />
      </label>
      <label class="field">
        <span>Row gap</span>
        <input data-field="gapRows" type="number" step="any" min="0" value="${block.gaps.rows}" />
      </label>
    </div>
    <div class="block-actions">
      <button type="button" class="small duplicate-block-btn">Duplicate block</button>
      <button type="button" class="small remove-block-btn">Remove block</button>
    </div>
  `;
}

/**
 * @param {HTMLElement} listEl
 * @param {object} block
 * @param {number} index
 */
export function appendBlockEditor(listEl, block, index) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "block-editor";
  fieldset.innerHTML = blockFieldsHtml(block, index);
  listEl.appendChild(fieldset);
  renumberBlocks(listEl);
  return fieldset;
}

/** @param {HTMLElement} listEl */
export function renumberBlocks(listEl) {
  listEl.querySelectorAll(".block-editor").forEach((el, index) => {
    const legend = el.querySelector("legend");
    if (legend) legend.textContent = `Block ${index + 1}`;
  });
}

/**
 * @param {HTMLElement} listEl
 * @param {ReturnType<typeof defaultData>} state
 * @param {(event: Event) => void} onChange
 */
export function initSheetLayout(listEl, state, onChange) {
  listEl.replaceChildren();
  for (const block of state.blocks) {
    appendBlockEditor(listEl, block, state.blocks.indexOf(block));
  }

  listEl.addEventListener("input", onChange);
  listEl.addEventListener("change", onChange);
  listEl.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const fieldset = target.closest(".block-editor");
    if (!fieldset) return;

    if (target.classList.contains("duplicate-block-btn")) {
      const block = readBlockFromFieldset(
        /** @type {HTMLFieldSetElement} */ (fieldset),
      );
      const clone = {
        ...block,
        gaps: { ...block.gaps },
      };
      const newFieldset = document.createElement("fieldset");
      newFieldset.className = "block-editor";
      newFieldset.innerHTML = blockFieldsHtml(clone, 0);
      fieldset.insertAdjacentElement("afterend", newFieldset);
      renumberBlocks(listEl);
      onChange(event);
      return;
    }

    if (!target.classList.contains("remove-block-btn")) return;
    if (listEl.querySelectorAll(".block-editor").length <= 1) return;
    fieldset.remove();
    renumberBlocks(listEl);
    onChange(event);
  });
}

/** Build demo marks from block dimensions (diagonal pattern). */
export function buildSampleMarks(data) {
  return data.answersBlocks.map((block) =>
    Array.from({ length: block.rows }, (_, row) => [row % block.columns]),
  );
}
