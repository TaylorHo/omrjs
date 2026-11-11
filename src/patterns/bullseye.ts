import {
  computeTemplateStats,
  type TemplateStats,
} from "../math/correlation.js";
import { BULLSEYE_BITMAP, BULLSEYE_INK } from "./bullseye-bitmap.js";

/** Generate a binary bullseye template at baseSize (must be odd). */
export function generateBullseyeTemplate(baseSize: number): {
  template: Float32Array;
  width: number;
  height: number;
  stats: TemplateStats;
  ink: { area: number; x: number; y: number };
} {
  const size = baseSize % 2 === 0 ? baseSize + 1 : baseSize;
  const template = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sy = Math.min(64, Math.floor(((y + 0.5) * 65) / size));
      const sx = Math.min(64, Math.floor(((x + 0.5) * 65) / size));
      template[y * size + x] = BULLSEYE_BITMAP[sy]![sx] === "1" ? 1 : 0;
    }
  }

  return {
    template,
    width: size,
    height: size,
    stats: computeTemplateStats(template),
    ink: BULLSEYE_INK,
  };
}
