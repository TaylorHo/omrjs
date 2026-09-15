import type { ResolvedConfig } from "../config.js";
import type { PreprocessedImage } from "../types.js";

export function computeOtsuThreshold(gray: Float32Array): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const bin = Math.min(255, Math.floor(gray[i]! * 255));
    histogram[bin]!++;
  }

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i]!;
  }

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;

    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }

  return threshold / 255;
}

function toGrayscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  method: "luminance" | "average",
): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4]! / 255;
    const g = pixels[i * 4 + 1]! / 255;
    const b = pixels[i * 4 + 2]! / 255;
    gray[i] =
      method === "luminance"
        ? 0.299 * r + 0.587 * g + 0.114 * b
        : (r + g + b) / 3;
  }
  return gray;
}

function applyGamma(gray: Float32Array, gamma: number): void {
  const invGamma = 1 / gamma;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = gray[i]! ** invGamma;
  }
}

export function binarize(gray: Float32Array, threshold: number): Uint8Array {
  const thresholdBin = Math.round(threshold * 255);
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const bin = Math.min(255, Math.round(gray[i]! * 255));
    binary[i] = bin <= thresholdBin ? 1 : 0;
  }
  return binary;
}

export function preprocess(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  config: ResolvedConfig,
): PreprocessedImage {
  const gray = toGrayscale(pixels, width, height, config.grayscale);
  applyGamma(gray, config.exposureGamma);
  const threshold = computeOtsuThreshold(gray);
  const binary = binarize(gray, threshold);
  return { gray, binary, width, height };
}
