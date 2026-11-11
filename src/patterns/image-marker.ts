import { computeOtsuThreshold } from "../core/preprocess.js";
import type { ImageMarker } from "../data.js";
import {
  computeTemplateStats,
  type TemplateStats,
} from "../math/correlation.js";

export type PreparedImageTemplate = {
  template: Float32Array;
  width: number;
  height: number;
  stats: TemplateStats;
  /** Area and centroid in coordinates normalized by the full reference width. */
  ink: { area: number; x: number; y: number };
};

function grayscaleFromRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4]!;
    const g = pixels[i * 4 + 1]!;
    const b = pixels[i * 4 + 2]!;
    const alpha = pixels[i * 4 + 3]! / 255;
    gray[i] =
      ((0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha)) / 255;
  }
  return gray;
}

/** Binarize to match the preprocessed detection image (dark pixels = 1). */
function binarizeTemplate(gray: Float32Array): Float32Array {
  const threshold = computeOtsuThreshold(gray);
  const binary = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i]! <= threshold ? 1 : 0;
  }
  return binary;
}

/** Convert RGBA marker pixels to a binary template ready for NCC matching. */
export function prepareImageMarkerTemplate(
  marker: ImageMarker,
): PreparedImageTemplate {
  const { pixels, width, height } = marker;
  const gray = grayscaleFromRgba(pixels, width, height);
  const template = binarizeTemplate(gray);
  let black = 1,
    white = 0;
  for (const value of gray) {
    black = Math.min(black, value);
    white = Math.max(white, value);
  }
  let area = 0,
    mx = 0,
    my = 0;
  if (white > black) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const weight = (white - gray[y * width + x]!) / (white - black);
        area += weight;
        mx += weight * (x + 0.5);
        my += weight * (y + 0.5);
      }
  }

  return {
    template,
    width,
    height,
    stats: computeTemplateStats(template),
    ink: {
      area: area / (width * width),
      x: mx / area / width,
      y: my / area / width,
    },
  };
}
