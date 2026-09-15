import {
  computeTemplateStats,
  findBestNccMatch,
  type NccMatch,
  type TemplateStats,
} from "../math/correlation.js";

const RING_RATIOS = [1, 0.75, 0.5, 0.25];

/** Generate a binary bullseye template at baseSize (must be odd). */
export function generateBullseyeTemplate(baseSize: number): {
  template: Float32Array;
  width: number;
  height: number;
  stats: TemplateStats;
} {
  const size = baseSize % 2 === 0 ? baseSize + 1 : baseSize;
  const template = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      let val = 0;
      for (let i = 0; i < RING_RATIOS.length; i++) {
        const outer = RING_RATIOS[i]!;
        const inner = i + 1 < RING_RATIOS.length ? RING_RATIOS[i + 1]! : 0;
        if (r <= outer && r > inner) {
          val = i % 2 === 0 ? 1 : 0;
          break;
        }
      }
      template[y * size + x] = val;
    }
  }

  return {
    template,
    width: size,
    height: size,
    stats: computeTemplateStats(template),
  };
}

export function findBullseyeMatch(
  image: Float32Array,
  width: number,
  height: number,
  scale: number,
  nccThreshold: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fixedSize?: number,
): NccMatch | null {
  const baseSize = fixedSize ?? Math.max(7, Math.round(15 * scale));
  const {
    template,
    width: tw,
    height: th,
    stats,
  } = generateBullseyeTemplate(baseSize);

  const match = findBestNccMatch(
    image,
    width,
    height,
    template,
    tw,
    th,
    stats,
    x0,
    y0,
    x1,
    y1,
  );

  if (!match || match.score < nccThreshold) return null;
  return match;
}
