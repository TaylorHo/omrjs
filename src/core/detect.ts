import type { Data } from "../data.js";
import { generateBullseyeTemplate } from "../patterns/bullseye.js";
import { BULLSEYE_RADII } from "../patterns/bullseye-bitmap.js";
import { prepareImageMarkerTemplate } from "../patterns/image-marker.js";
import type { Marker, Point } from "../types.js";
import { type Component, connectedComponents } from "./components.js";

export type MarkerCandidate = Marker & {
  support: Point[];
  referenceRotation: number;
};

function prepareReference(data: Data) {
  const pattern = data.cornerPattern ?? "bullseye";
  const prepared =
    pattern === "bullseye"
      ? generateBullseyeTemplate(65)
      : prepareImageMarkerTemplate(pattern);
  let x0 = prepared.width,
    y0 = prepared.height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < prepared.height; y++) {
    for (let x = 0; x < prepared.width; x++) {
      if (prepared.template[y * prepared.width + x]! > 0.5) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  if (x1 <= x0 || y1 <= y0 || prepared.stats.std < 0.01)
    throw new Error("Marker reference must contain both ink and background");
  const size = 25;
  const samples = new Float32Array(size * size);
  let sum = 0,
    squared = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(
        x1 - 1,
        Math.floor(x0 + ((x + 0.5) * (x1 - x0)) / size),
      );
      const sy = Math.min(
        y1 - 1,
        Math.floor(y0 + ((y + 0.5) * (y1 - y0)) / size),
      );
      const value = prepared.template[sy * prepared.width + sx]!;
      samples[y * size + x] = value;
      sum += value;
      squared += value * value;
    }
  }
  return {
    samples,
    sum,
    variance: squared - (sum * sum) / samples.length,
    size,
    width: prepared.width,
    height: prepared.height,
    x0,
    y0,
    inkWidth: x1 - x0,
    inkHeight: y1 - y0,
    ink: prepared.ink,
    radii: pattern === "bullseye" ? BULLSEYE_RADII : null,
  };
}

function matchScore(
  image: Float32Array,
  width: number,
  box: Component,
  reference: ReturnType<typeof prepareReference>,
) {
  // shortcut: bounds normalization handles moderate skew; add affine refinement if real custom-marker photos require it.
  const { samples, size } = reference;
  let best = { score: -1, rotation: 0 };
  // Rotate the reference, not the photograph; custom markers need all four directions.
  for (let rotation = 0; rotation < 4; rotation++) {
    let sum = 0,
      squared = 0,
      cross = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = Math.min(
          box.x1 - 1,
          Math.floor(box.x0 + ((x + 0.5) * (box.x1 - box.x0)) / size),
        );
        const sy = Math.min(
          box.y1 - 1,
          Math.floor(box.y0 + ((y + 0.5) * (box.y1 - box.y0)) / size),
        );
        const value = image[sy * width + sx]!;
        const tx =
          rotation === 0
            ? x
            : rotation === 1
              ? y
              : rotation === 2
                ? size - 1 - x
                : size - 1 - y;
        const ty =
          rotation === 0
            ? y
            : rotation === 1
              ? size - 1 - x
              : rotation === 2
                ? size - 1 - y
                : x;
        sum += value;
        squared += value * value;
        cross += value * samples[ty * size + tx]!;
      }
    }
    const denominator = Math.sqrt(
      reference.variance * (squared - (sum * sum) / samples.length),
    );
    const score =
      denominator > 1e-8
        ? (cross - (sum * reference.sum) / samples.length) / denominator
        : -1;
    if (score > best.score) best = { score, rotation };
  }
  return best;
}

function ordered(
  markers: MarkerCandidate[],
): [MarkerCandidate, MarkerCandidate, MarkerCandidate, MarkerCandidate] {
  const cx = markers.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = markers.reduce((sum, p) => sum + p.y, 0) / 4;
  const sorted = [...markers].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const first = sorted.reduce(
    (best, p, i) => (p.x + p.y < sorted[best]!.x + sorted[best]!.y ? i : best),
    0,
  );
  return [
    sorted[first]!,
    sorted[(first + 1) % 4]!,
    sorted[(first + 2) % 4]!,
    sorted[(first + 3) % 4]!,
  ];
}

export function detectMarkers(
  image: Float32Array,
  width: number,
  height: number,
  data: Data,
  threshold: number,
) {
  const reference = prepareReference(data);
  const mask = Uint8Array.from(image, (v) => (v > 0.5 ? 1 : 0));
  const { components } = connectedComponents(mask, width, height);
  const regions = components
    .filter(
      (c) =>
        c.count >= 8 &&
        c.x1 - c.x0 >= 5 &&
        c.y1 - c.y0 >= 5 &&
        c.x1 - c.x0 < width * 0.45 &&
        c.y1 - c.y0 < height * 0.45,
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, 300);
  const boxes = [...regions];
  // Nearby pieces allow a supplied reference to contain disconnected ink shapes.
  for (const region of regions) {
    const nearby = regions
      .filter(
        (c) =>
          c !== region &&
          Math.hypot(
            (c.x0 + c.x1 - region.x0 - region.x1) / 2,
            (c.y0 + c.y1 - region.y0 - region.y1) / 2,
          ) <
            Math.max(region.x1 - region.x0, region.y1 - region.y0) * 2,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x0 - region.x0, a.y0 - region.y0) -
          Math.hypot(b.x0 - region.x0, b.y0 - region.y0),
      )
      .slice(0, 4);
    let merged = { ...region };
    for (const c of nearby) {
      merged = {
        ...merged,
        x0: Math.min(merged.x0, c.x0),
        y0: Math.min(merged.y0, c.y0),
        x1: Math.max(merged.x1, c.x1),
        y1: Math.max(merged.y1, c.y1),
      };
      boxes.push(merged);
    }
  }
  const candidates: MarkerCandidate[] = [];
  for (const box of boxes) {
    const bw = box.x1 - box.x0,
      bh = box.y1 - box.y0;
    const ratio = bw / bh;
    const expected = reference.inkWidth / reference.inkHeight;
    if (
      Math.min(
        Math.abs(Math.log(ratio / expected)),
        Math.abs(Math.log(ratio * expected)),
      ) > 0.65
    )
      continue;
    const { score, rotation } = matchScore(image, width, box, reference);
    if (score < threshold) continue;
    const turned = rotation % 2 === 1;
    const rw = turned ? reference.height : reference.width;
    const rh = turned ? reference.width : reference.height;
    const iw = turned ? reference.inkHeight : reference.inkWidth;
    const ih = turned ? reference.inkWidth : reference.inkHeight;
    const rx =
      rotation === 0
        ? reference.x0
        : rotation === 1
          ? reference.height - reference.y0 - reference.inkHeight
          : rotation === 2
            ? reference.width - reference.x0 - reference.inkWidth
            : reference.y0;
    const ry =
      rotation === 0
        ? reference.y0
        : rotation === 1
          ? reference.x0
          : rotation === 2
            ? reference.height - reference.y0 - reference.inkHeight
            : reference.width - reference.x0 - reference.inkWidth;
    const fullWidth = (bw * rw) / iw;
    const fullHeight = (bh * rh) / ih;
    const support: Point[] = [];
    for (let y = box.y0; y < box.y1; y++) {
      let left = box.x1,
        right = -1;
      for (let x = box.x0; x < box.x1; x++) {
        if (mask[y * width + x]) {
          left = Math.min(left, x);
          right = x;
        }
      }
      if (right >= 0)
        support.push(
          { x: left + 0.5, y: y + 0.5 },
          { x: right + 0.5, y: y + 0.5 },
        );
    }
    candidates.push({
      x: box.x0 - (rx / iw) * bw + fullWidth / 2,
      y: box.y0 - (ry / ih) * bh + fullHeight / 2,
      width: fullWidth,
      height: fullHeight,
      size: fullWidth,
      score,
      support,
      referenceRotation: rotation,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const distinct: MarkerCandidate[] = [];
  for (const c of candidates) {
    if (
      !distinct.some(
        (p) =>
          Math.hypot(p.x - c.x, p.y - c.y) < Math.max(p.size, c.size) * 0.6,
      )
    )
      distinct.push(c);
    if (distinct.length === 20) break;
  }
  let best: ReturnType<typeof ordered> | null = null;
  let bestScore = 0;
  for (let a = 0; a < distinct.length - 3; a++)
    for (let b = a + 1; b < distinct.length - 2; b++)
      for (let c = b + 1; c < distinct.length - 1; c++)
        for (let d = c + 1; d < distinct.length; d++) {
          const quad = ordered([
            distinct[a]!,
            distinct[b]!,
            distinct[c]!,
            distinct[d]!,
          ]);
          let area = 0,
            valid = true;
          for (let i = 0; i < 4; i++) {
            const p = quad[i]!,
              q = quad[(i + 1) % 4]!,
              r = quad[(i + 2) % 4]!;
            area += p.x * q.y - q.x * p.y;
            if (
              (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) <= 0 ||
              Math.hypot(q.x - p.x, q.y - p.y) < Math.max(p.size, q.size) * 2
            )
              valid = false;
          }
          area /= 2;
          const quality = area * Math.min(...quad.map((p) => p.score)) ** 2;
          if (valid && area > width * height * 0.05 && quality > bestScore) {
            best = quad;
            bestScore = quality;
          }
        }
  if (!best)
    throw new Error(
      `Could not detect four distinct reference markers (found ${distinct.length} candidates)`,
    );
  return {
    markers: best,
    inkWidthFraction: reference.inkWidth / reference.width,
    inkHeightFraction: reference.inkHeight / reference.height,
    referenceAspectRatio: reference.width / reference.height,
    ink: reference.ink,
    radii: reference.radii,
  };
}
