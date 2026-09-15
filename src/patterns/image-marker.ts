import { computeOtsuThreshold } from "../core/preprocess.js";
import type { ImageMarker } from "../data.js";
import {
  computeTemplateStats,
  findBestNccMatch,
  type NccMatch,
  type TemplateStats,
} from "../math/correlation.js";

/** Reference template size at scale 1 — matches bullseye corner search. */
const REFERENCE_SIZE = 15;

export type PreparedImageTemplate = {
  template: Float32Array;
  width: number;
  height: number;
  stats: TemplateStats;
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
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
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

  return {
    template,
    width,
    height,
    stats: computeTemplateStats(template),
  };
}

function resizeTemplate(
  template: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstSize: number,
): Float32Array {
  const dst = new Float32Array(dstSize * dstSize);
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(
        srcWidth - 1,
        Math.floor(((x + 0.5) * srcWidth) / dstSize),
      );
      const sy = Math.min(
        srcHeight - 1,
        Math.floor(((y + 0.5) * srcHeight) / dstSize),
      );
      dst[y * dstSize + x] = template[sy * srcWidth + sx]!;
    }
  }
  return dst;
}

export function findImageMarkerMatch(
  image: Float32Array,
  width: number,
  height: number,
  prepared: PreparedImageTemplate,
  scale: number,
  nccThreshold: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fixedSize?: number,
): NccMatch | null {
  const targetSize =
    fixedSize ?? Math.max(7, Math.round(REFERENCE_SIZE * scale));

  const template =
    targetSize === prepared.width && targetSize === prepared.height
      ? prepared.template
      : resizeTemplate(
          prepared.template,
          prepared.width,
          prepared.height,
          targetSize,
        );

  const stats =
    template === prepared.template
      ? prepared.stats
      : computeTemplateStats(template);

  const match = findBestNccMatch(
    image,
    width,
    height,
    template,
    targetSize,
    targetSize,
    stats,
    x0,
    y0,
    x1,
    y1,
  );

  if (!match || match.score < nccThreshold) return null;
  return match;
}
