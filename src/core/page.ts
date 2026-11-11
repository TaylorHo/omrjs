import type { ResolvedConfig } from "../config.js";
import { type DetectedPage, type Point, RectificationError } from "../types.js";
import { connectedComponents } from "./components.js";

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function convexHull(points: Point[]): Point[] {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0
      )
        out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

export function detectPage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  config: ResolvedConfig,
): DetectedPage {
  // Bound segmentation cost; final crop and warp still use original-resolution pixels.
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 1200));
  const sw = Math.ceil(width / step);
  const sh = Math.ceil(height / step);
  const mask = new Uint8Array(sw * sh);
  const color = config.page.backgroundColor;
  const limit = config.page.colorTolerance ** 2 * 3 * 255 ** 2;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i =
        (Math.min(height - 1, y * step) * width +
          Math.min(width - 1, x * step)) *
        4;
      const alpha = pixels[i + 3]! / 255;
      let distance = 0;
      for (let c = 0; c < 3; c++)
        distance +=
          (pixels[i + c]! * alpha + color[c]! * (1 - alpha) - color[c]!) ** 2;
      mask[y * sw + x] = distance <= limit ? 1 : 0;
    }
  }
  const { components, labels } = connectedComponents(mask, sw, sh);
  const largest = components.reduce<(typeof components)[number] | null>(
    (best, c) => (!best || c.count > best.count ? c : best),
    null,
  );
  if (!largest || largest.count < Math.max(16, mask.length * 0.01))
    throw new RectificationError(
      "page",
      "Could not detect a page matching the background color",
    );
  const boundary: Point[] = [];
  for (let y = largest.y0; y < largest.y1; y++) {
    let left = sw;
    let right = -1;
    for (let x = largest.x0; x < largest.x1; x++) {
      if (labels[y * sw + x] === largest.id) {
        left = Math.min(left, x);
        right = x;
      }
    }
    if (right < 0) continue;
    boundary.push(
      { x: left * step, y: y * step },
      { x: Math.min(width, (right + 1) * step), y: y * step },
      { x: left * step, y: Math.min(height, (y + 1) * step) },
      {
        x: Math.min(width, (right + 1) * step),
        y: Math.min(height, (y + 1) * step),
      },
    );
  }
  // A convex paper boundary retains ink and holes without admitting disconnected color regions.
  const outline = convexHull(boundary);
  const x0 = largest.x0 * step;
  const y0 = largest.y0 * step;
  const cw = Math.min(width, largest.x1 * step) - x0;
  const ch = Math.min(height, largest.y1 * step) - y0;
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const py = y + y0 + 0.5;
    const intersections: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py))
        intersections.push(a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    const left = Math.min(...intersections) - step;
    const right = Math.max(...intersections) + step;
    for (let x = 0; x < cw; x++) {
      const dst = (y * cw + x) * 4;
      const src = ((y + y0) * width + x + x0) * 4;
      const inside = x + x0 + 0.5 >= left && x + x0 + 0.5 <= right;
      const alpha = pixels[src + 3]! / 255;
      for (let c = 0; c < 3; c++)
        data[dst + c] = inside
          ? pixels[src + c]! * alpha + color[c]! * (1 - alpha)
          : color[c]!;
      data[dst + 3] = 255;
    }
  }
  return {
    bounds: { x: x0, y: y0, width: cw, height: ch },
    outline,
    image: { data, width: cw, height: ch },
  };
}
