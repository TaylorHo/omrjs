import type { Data } from "../data.js";
import type { CellMeasurement, RasterImage } from "../types.js";
import { type Component, connectedComponents } from "./components.js";
import { adaptiveInkMask, toGrayscale } from "./preprocess.js";

function perimeter(
  c: Component,
  labels: Int32Array,
  width: number,
  shape: CellMeasurement["shape"],
) {
  const w = c.x1 - c.x0,
    h = c.y1 - c.y0;
  let hits = 0;
  for (let i = 0; i < 48; i++) {
    const angle = ((i + 0.5) * Math.PI) / 24;
    let dx = Math.cos(angle),
      dy = Math.sin(angle);
    if (shape === "rectangle") {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx /= m;
      dy /= m;
    }
    let found = false;
    for (const r of [0.82, 0.9, 0.98]) {
      const x = Math.floor((c.x0 + c.x1) / 2 + ((dx * w) / 2) * r);
      const y = Math.floor((c.y0 + c.y1) / 2 + ((dy * h) / 2) * r);
      if (labels[y * width + x] === c.id) found = true;
    }
    if (found) hits++;
  }
  return hits / 48;
}

function prepareGrid(image: RasterImage, data: Data, scale: number) {
  if (!data.answersBlocks.length)
    throw new Error("Grid requires at least one answer block");
  const gray = toGrayscale(image.data, image.width, image.height, "luminance");
  const radius = Math.max(
    4,
    Math.round(
      Math.max(
        ...data.answersBlocks.map((b) =>
          Math.max(b.width, b.height ?? b.width),
        ),
      ) * scale,
    ),
  );
  const { components, labels } = connectedComponents(
    adaptiveInkMask(gray, image.width, image.height, radius),
    image.width,
    image.height,
  );
  return { gray, components, labels };
}

function matchGrid(
  image: RasterImage,
  data: Data,
  scale: number,
  { components, labels }: ReturnType<typeof prepareGrid>,
) {
  const used = new Set<number>();
  let score = 0;
  const cells = data.answersBlocks.map((block, bi) => {
    const w = block.width * scale,
      h = (block.height ?? block.width) * scale;
    if (Math.min(w, h) < 8)
      throw new Error(`Block ${bi + 1}: cells are too small to validate`);
    const candidates = components.filter(
      (c) =>
        Math.abs((c.x1 - c.x0) / w - 1) < 0.22 &&
        Math.abs((c.y1 - c.y0) / h - 1) < 0.22,
    );
    const rows: CellMeasurement[][] = [];
    let offsetX = 0,
      offsetY = 0;
    const offsets: { x: number; y: number }[] = [];
    for (let row = 0; row < block.rows; row++) {
      const line: CellMeasurement[] = [];
      for (let col = 0; col < block.columns; col++) {
        const x =
          (block.startX + col * (block.width + block.gaps.columns)) * scale;
        const y =
          (block.startY +
            row * ((block.height ?? block.width) + block.gaps.rows)) *
          scale;
        const matches = candidates.filter(
          (c) =>
            Math.abs((c.x0 + c.x1) / 2 - x - w / 2 - offsetX) <= w * 0.35 &&
            Math.abs((c.y0 + c.y1) / 2 - y - h / 2 - offsetY) <= h * 0.35,
        );
        if (matches.length !== 1 || used.has(matches[0]!.id))
          throw new Error(
            `Block ${bi + 1}, row ${row + 1}, column ${col + 1}: missing or incompatible printed outline`,
          );
        const c = matches[0]!;
        const ellipse = perimeter(c, labels, image.width, "ellipse");
        const rectangle = perimeter(c, labels, image.width, "rectangle");
        const outlineScore = Math.max(ellipse, rectangle);
        if (outlineScore < 0.7)
          throw new Error(
            `Block ${bi + 1}, row ${row + 1}, column ${col + 1}: incomplete printed outline`,
          );
        used.add(c.id);
        const dx = (c.x0 + c.x1) / 2 - x - w / 2,
          dy = (c.y0 + c.y1) / 2 - y - h / 2;
        if (row === 0 && col === 0) {
          offsetX = dx;
          offsetY = dy;
        }
        offsets.push({ x: dx, y: dy });
        score += outlineScore - (Math.abs(dx) / w + Math.abs(dy) / h) / 2;
        line.push({
          x: c.x0,
          y: c.y0,
          width: c.x1 - c.x0,
          height: c.y1 - c.y0,
          shape: ellipse >= rectangle ? "ellipse" : "rectangle",
          outlineScore,
          inkRatio: 0,
          fillRatio: 0,
          status: "blank",
        });
      }
      rows.push(line);
    }
    const median = (v: number[]) =>
      v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    const dx = median(offsets.map((p) => p.x)),
      dy = median(offsets.map((p) => p.y));
    // Component bounds round centers to half pixels; allow one pixel between two rounded centers.
    if (
      offsets.some(
        (p) =>
          Math.abs(p.x - dx) > Math.max(2, w * 0.1 + 1) ||
          Math.abs(p.y - dy) > Math.max(2, h * 0.1 + 1),
      )
    )
      throw new Error(
        `Block ${bi + 1}: printed row or column spacing disagrees with the layout`,
      );
    return rows;
  });
  // A neighboring continuation is evidence that the configured count truncates a printed block.
  for (const block of data.answersBlocks) {
    const w = block.width * scale,
      h = (block.height ?? block.width) * scale;
    const left =
        (block.startX - block.width - block.gaps.columns) * scale - w * 0.4,
      top =
        (block.startY - (block.height ?? block.width) - block.gaps.rows) *
          scale -
        h * 0.4;
    const right =
      (block.startX + block.columns * (block.width + block.gaps.columns)) *
        scale +
      w * 1.4;
    const bottom =
      (block.startY +
        block.rows * ((block.height ?? block.width) + block.gaps.rows)) *
        scale +
      h * 1.4;
    if (
      components.some(
        (c) =>
          !used.has(c.id) &&
          c.x0 >= left &&
          c.y0 >= top &&
          c.x1 <= right &&
          c.y1 <= bottom &&
          Math.abs((c.x1 - c.x0) / w - 1) < 0.22 &&
          Math.abs((c.y1 - c.y0) / h - 1) < 0.22 &&
          Math.max(
            perimeter(c, labels, image.width, "ellipse"),
            perimeter(c, labels, image.width, "rectangle"),
          ) >= 0.7,
      )
    )
      throw new Error(
        "Printed grid has additional rows or columns near a configured block",
      );
  }
  return { cells, score: score / used.size };
}

export function detectGrid(image: RasterImage, data: Data, scale: number) {
  const prepared = prepareGrid(image, data, scale);
  return { ...matchGrid(image, data, scale, prepared), gray: prepared.gray };
}

/** Refine marker-derived scale only when the complete printed layout validates. */
export function refineGridScale(image: RasterImage, data: Data, scale: number) {
  const prepared = prepareGrid(image, data, scale);
  for (let step = 0; step <= 60; step++) {
    for (const direction of step === 0 ? [0] : [-1, 1]) {
      // Limit correction to 15%; a quarter-percent step stays within the cell-spacing tolerance.
      const candidate = scale * (1 + (direction * step) / 400);
      try {
        matchGrid(image, data, candidate, prepared);
        return candidate;
      } catch {
        // Geometry-only inspection must remain available for incomplete or incompatible grids.
      }
    }
  }
  return scale;
}
