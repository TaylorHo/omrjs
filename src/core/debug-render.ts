import type { Data } from "../data.js";
import type { CellMeasurement, RasterImage } from "../types.js";

const BLOCK_COLORS: [number, number, number][] = [
  [0, 200, 255],
  [255, 220, 0],
  [255, 80, 200],
  [120, 255, 80],
  [255, 140, 60],
  [180, 120, 255],
];

const BORDER_WIDTH = 2;
const MARKED_ALPHA = 0.3;

function blendPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
) {
  if (x < 0 || y < 0 || x >= width) return;
  const o = (y * width + x) * 4;
  if (o >= data.length) return;
  const inv = 1 - alpha;
  data[o] = Math.round(data[o]! * inv + r * alpha);
  data[o + 1] = Math.round(data[o + 1]! * inv + g * alpha);
  data[o + 2] = Math.round(data[o + 2]! * inv + b * alpha);
}

/** Draw the configuration only; no thresholding or answer classification. */
export function renderLayoutGrid(
  image: RasterImage,
  data: Data,
  scale: number,
) {
  const rgba = new Uint8ClampedArray(image.data);
  const warnings: string[] = [];
  data.answersBlocks.forEach((block, index) => {
    const [r, g, b] = BLOCK_COLORS[index % BLOCK_COLORS.length]!;
    const w = block.width * scale;
    const h = (block.height ?? block.width) * scale;
    const right =
      (block.startX +
        (block.columns - 1) * (block.width + block.gaps.columns) +
        block.width) *
      scale;
    const bottom =
      (block.startY +
        (block.rows - 1) * ((block.height ?? block.width) + block.gaps.rows) +
        (block.height ?? block.width)) *
      scale;
    if (right > image.width || bottom > image.height)
      warnings.push(
        `Block ${index + 1} extends outside the marker frame; check its layout, cornerSize, aspect ratio, or rotation.`,
      );
    for (let row = 0; row < block.rows; row++) {
      for (let col = 0; col < block.columns; col++) {
        const x = Math.round(
          (block.startX + col * (block.width + block.gaps.columns)) * scale,
        );
        const y = Math.round(
          (block.startY +
            row * ((block.height ?? block.width) + block.gaps.rows)) *
            scale,
        );
        const x1 = Math.round(x + w),
          y1 = Math.round(y + h);
        if (x >= image.width || y >= image.height) continue;
        drawRectBorder(
          rgba,
          image.width,
          x,
          y,
          Math.min(image.width, x1),
          Math.min(image.height, y1),
          r,
          g,
          b,
        );
      }
    }
  });
  return {
    image: { data: rgba, width: image.width, height: image.height },
    warnings,
  };
}

function drawRectBorder(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
) {
  for (let t = 0; t < BORDER_WIDTH; t++) {
    for (let x = x0; x < x1; x++) {
      blendPixel(data, width, x, y0 + t, r, g, b, 1);
      blendPixel(data, width, x, y1 - 1 - t, r, g, b, 1);
    }
    for (let y = y0; y < y1; y++) {
      blendPixel(data, width, x0 + t, y, r, g, b, 1);
      blendPixel(data, width, x1 - 1 - t, y, r, g, b, 1);
    }
  }
}

/** Render the returned measurements, without recomputing thresholds or decisions. */
export function renderRecognitionGrid(
  image: RasterImage,
  blocks: CellMeasurement[][][],
) {
  const rgba = new Uint8ClampedArray(image.data);
  for (const cell of blocks.flat(2)) {
    const color: [number, number, number] =
      cell.status === "marked"
        ? [0, 190, 90]
        : cell.status === "uncertain"
          ? [255, 150, 0]
          : [0, 160, 255];
    const { x, y, width: w, height: h } = cell;
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++) {
        const dx = Math.abs((px + 0.5 - x - w / 2) / (w / 2));
        const dy = Math.abs((py + 0.5 - y - h / 2) / (h / 2));
        const radius =
          cell.shape === "ellipse" ? Math.hypot(dx, dy) : Math.max(dx, dy);
        const insetX = (dx * w) / (w - BORDER_WIDTH * 2);
        const insetY = (dy * h) / (h - BORDER_WIDTH * 2);
        const insideBorder =
          cell.shape === "ellipse"
            ? Math.hypot(insetX, insetY)
            : Math.max(insetX, insetY);
        if (radius <= 1 && insideBorder >= 1)
          blendPixel(rgba, image.width, px, py, ...color, 1);
        else if (radius < 0.65 && cell.status !== "blank")
          blendPixel(rgba, image.width, px, py, ...color, MARKED_ALPHA);
      }
  }
  return { data: rgba, width: image.width, height: image.height };
}
