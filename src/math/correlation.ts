import { buildIntegral, rectSum } from "./integral.js";

export type TemplateStats = {
  mean: number;
  std: number;
  size: number;
};

export function computeTemplateStats(template: Float32Array): TemplateStats {
  const n = template.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += template[i]!;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = template[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  return { mean, std, size: n };
}

export type NccMatch = {
  x: number;
  y: number;
  score: number;
  size: number;
};

/**
 * Find best NCC match of template in image region using integral image.
 * image is grayscale Float32Array [0,1], template is binary-ish Float32Array.
 */
export function findBestNccMatch(
  image: Float32Array,
  width: number,
  height: number,
  template: Float32Array,
  templateWidth: number,
  templateHeight: number,
  templateStats: TemplateStats,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): NccMatch | null {
  const sat = buildIntegral(image, width, height);
  const tw = templateWidth;
  const th = templateHeight;
  const n = tw * th;

  let bestScore = -Infinity;
  let bestX = 0;
  let bestY = 0;

  const searchX1 = Math.min(x1, width - tw);
  const searchY1 = Math.min(y1, height - th);

  for (let y = y0; y <= searchY1; y++) {
    for (let x = x0; x <= searchX1; x++) {
      const sum = rectSum(sat, x, y, x + tw, y + th, width);
      const mean = sum / n;

      let cross = 0;
      let varSum = 0;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const imgVal = image[(y + ty) * width + (x + tx)]!;
          const tVal = template[ty * tw + tx]!;
          cross += tVal * imgVal;
          const d = imgVal - mean;
          varSum += d * d;
        }
      }

      const std = Math.sqrt(varSum / n);
      if (std < 1e-6 || templateStats.std < 1e-6) continue;

      const score =
        (cross - n * templateStats.mean * mean) / (templateStats.std * std * n);

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestScore === -Infinity) return null;
  return { x: bestX, y: bestY, score: bestScore, size: tw };
}
