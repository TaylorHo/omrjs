import { isImageMarker, markerToStorable } from "./marker-image.js";

const STORAGE_KEY = "omrjs-example";

/**
 * @param {unknown} payload
 */
export function saveStoredPayload(payload) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializePayload(payload)),
    );
  } catch {
    // Ignore quota or privacy-mode errors.
  }
}

/**
 * @param {{ data: import('../dist/data.js').Data, config: Record<string, unknown> }} payload
 */
export function serializePayload(payload) {
  const data = { ...payload.data };
  /** @type {Record<string, unknown>} */
  const stored = {
    config: payload.config,
    data,
  };

  if (isImageMarker(data.cornerPattern)) {
    stored.customMarker = markerToStorable(data.cornerPattern);
    data.cornerPattern = "image";
  }

  return stored;
}

/**
 * @returns {{ data?: import('../dist/data.js').Data, config?: Record<string, unknown> } | null}
 */
export function loadStoredPayload() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return /** @type {{ data?: import('../dist/data.js').Data, config?: Record<string, unknown> } } */ (
      parsed
    );
  } catch {
    return null;
  }
}

/**
 * @param {import('../dist/data.js').Data} data
 */
export function dataToSheetState(data) {
  return {
    cornerPattern: isImageMarker(data.cornerPattern) ? "image" : "bullseye",
    cornerSize: data.cornerSize,
    blocks: data.answersBlocks.map((block) => ({
      startX: block.startX,
      startY: block.startY,
      rows: block.rows,
      columns: block.columns,
      width: block.width,
      height: block.height ?? "",
      gaps: { ...block.gaps },
    })),
  };
}

/**
 * @param {import('../dist/data.js').Data | undefined} data
 */
export function isValidStoredData(data) {
  if (
    !data ||
    !Array.isArray(data.answersBlocks) ||
    data.answersBlocks.length === 0
  ) {
    return false;
  }

  return data.answersBlocks.every(
    (block) =>
      Number.isFinite(block.startX) &&
      Number.isFinite(block.startY) &&
      Number.isFinite(block.rows) &&
      Number.isFinite(block.columns) &&
      Number.isFinite(block.width) &&
      block.gaps &&
      Number.isFinite(block.gaps.columns) &&
      Number.isFinite(block.gaps.rows),
  );
}
