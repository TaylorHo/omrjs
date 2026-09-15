import type { Data } from "../data.js";
import { buildIntegral, rectSum } from "../math/integral.js";
import { binarize, computeOtsuThreshold } from "./preprocess.js";

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

function grayToRgba(
  gray: Float32Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, gray[i]!)) * 255);
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  return data;
}

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
  if (x < 0 || y < 0) return;
  const o = (y * width + x) * 4;
  if (o >= data.length) return;
  const inv = 1 - alpha;
  data[o] = Math.round(data[o]! * inv + r * alpha);
  data[o + 1] = Math.round(data[o + 1]! * inv + g * alpha);
  data[o + 2] = Math.round(data[o + 2]! * inv + b * alpha);
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
) {
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(width, x1);
  const bottom = Math.min(height, y1);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      blendPixel(data, width, x, y, r, g, b, alpha);
    }
  }
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

export function renderDebugGrid(
  warpedGray: Float32Array,
  width: number,
  height: number,
  data: Data,
  scaleFactor: number,
  fillThreshold: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const rgba = grayToRgba(warpedGray, width, height);

  const threshold = computeOtsuThreshold(warpedGray);
  const binary = binarize(warpedGray, threshold);
  const sat = buildIntegral(binary, width, height);

  for (
    let blockIndex = 0;
    blockIndex < data.answersBlocks.length;
    blockIndex++
  ) {
    const block = data.answersBlocks[blockIndex]!;
    const [r, g, b] = BLOCK_COLORS[blockIndex % BLOCK_COLORS.length]!;

    const cellW = block.width * scaleFactor;
    const cellH = (block.height ?? block.width) * scaleFactor;
    const gapCol = block.gaps.columns * scaleFactor;
    const gapRow = block.gaps.rows * scaleFactor;
    const startX = block.startX * scaleFactor;
    const startY = block.startY * scaleFactor;

    for (let row = 0; row < block.rows; row++) {
      const y = Math.round(startY + row * (cellH + gapRow));
      const y1 = Math.min(Math.round(y + cellH), height);

      for (let col = 0; col < block.columns; col++) {
        const x = Math.round(startX + col * (cellW + gapCol));
        const x1 = Math.min(Math.round(x + cellW), width);

        if (x >= width || y >= height || x1 <= x || y1 <= y) continue;

        drawRectBorder(rgba, width, x, y, x1, y1, r, g, b);

        const inkSum = rectSum(sat, x, y, x1, y1, width);
        const area = (x1 - x) * (y1 - y);
        const fillRatio = inkSum / area;

        if (fillRatio > fillThreshold) {
          fillRect(rgba, width, height, x, y, x1, y1, r, g, b, MARKED_ALPHA);
        }
      }
    }
  }

  return { data: rgba, width, height };
}
