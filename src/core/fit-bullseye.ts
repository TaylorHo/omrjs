import { applyHomographyInverse, invert3x3 } from "../math/matrix.js";
import type { RasterImage } from "../types.js";
import type { MarkerCandidate } from "./detect.js";

function sample(
  image: RasterImage,
  inverse: Float64Array,
  x: number,
  y: number,
) {
  const p = applyHomographyInverse(inverse, x, y);
  const px = p.x - 0.5,
    py = p.y - 0.5;
  if (px < 0 || py < 0 || px >= image.width - 1 || py >= image.height - 1)
    return NaN;
  const x0 = Math.floor(px),
    y0 = Math.floor(py),
    fx = px - x0,
    fy = py - y0;
  let value = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const i = ((y0 + dy) * image.width + x0 + dx) * 4;
      value +=
        ((0.299 * image.data[i]! +
          0.587 * image.data[i + 1]! +
          0.114 * image.data[i + 2]!) /
          255) *
        (dx ? fx : 1 - fx) *
        (dy ? fy : 1 - fy);
    }
  return value;
}

/** Fit both reference ring midlines; ink area changes under JPEG resampling. */
export function fitBullseye(
  image: RasterImage,
  marker: MarkerCandidate,
  h: Float64Array,
  radii: number[],
) {
  const inverse = invert3x3(h);
  if (!inverse)
    throw new Error("Could not invert bullseye calibration homography");
  let center = applyHomographyInverse(h, marker.x, marker.y);
  const edgeX = applyHomographyInverse(
    h,
    marker.x + marker.width / 2,
    marker.y,
  );
  const edgeY = applyHomographyInverse(
    h,
    marker.x,
    marker.y + marker.height / 2,
  );
  let width =
    Math.hypot(edgeX.x - center.x, edgeX.y - center.y) +
    Math.hypot(edgeY.x - center.x, edgeY.y - center.y);
  let residual = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    const normal = new Float64Array(9),
      rhs = new Float64Array(3);
    let count = 0,
      squared = 0;
    for (let direction = 0; direction < 32; direction++) {
      const angle = (direction * 2 * Math.PI) / 32;
      const nx = Math.cos(angle),
        ny = Math.sin(angle);
      for (let ring = 0; ring + 1 < radii.length; ring += 2) {
        const inner = radii[ring]!,
          outer = radii[ring + 1]!;
        const start = (inner - 0.05) * width,
          step = width * 0.002;
        const profileCount = Math.ceil((outer - inner + 0.1) / 0.002) + 1;
        const profile = Array.from({ length: profileCount }, (_, i) =>
          sample(
            image,
            inverse,
            center.x + nx * (start + i * step),
            center.y + ny * (start + i * step),
          ),
        );
        const valid = profile.filter(Number.isFinite);
        if (valid.length < profileCount * 0.8) continue;
        const black = Math.min(...valid),
          white = Math.max(...valid);
        if (white - black < 0.3) continue;
        let weight = 0,
          moment = 0;
        for (let i = 0; i < profile.length; i++) {
          if (!Number.isFinite(profile[i]!)) continue;
          const darkness = Math.max(0, (white - profile[i]!) / (white - black));
          weight += darkness;
          moment += darkness * (start + i * step);
        }
        if (weight < 5) continue;
        // A black ring's radial centroid survives edge sharpening and antialiasing better than its thickness.
        const position = moment / weight;
        const radius = (inner + outer) / 2;
        const row = [nx, ny, radius];
        const target = nx * center.x + ny * center.y + position;
        squared += target * target;
        for (let i = 0; i < 3; i++) {
          rhs[i]! += row[i]! * target;
          for (let j = 0; j < 3; j++) normal[i * 3 + j]! += row[i]! * row[j]!;
        }
        count++;
      }
    }
    const solved = invert3x3(normal);
    if (count < 32 || !solved) return null;
    const values = [0, 1, 2].map(
      (i) =>
        solved[i * 3]! * rhs[0]! +
        solved[i * 3 + 1]! * rhs[1]! +
        solved[i * 3 + 2]! * rhs[2]!,
    );
    center = { x: values[0]!, y: values[1]! };
    width = values[2]!;
    if (!(width > 0) || !Number.isFinite(width))
      throw new Error("Invalid bullseye reference width");
    residual =
      Math.sqrt(
        Math.max(
          0,
          squared - values.reduce((sum, value, i) => sum + value * rhs[i]!, 0),
        ) / count,
      ) / width;
  }
  // shortcut: pixel stair-steps can defeat ring fitting; use area calibration until higher-detail input supports the model.
  return residual <= 0.0015 ? { x: center.x, y: center.y, width } : null;
}
