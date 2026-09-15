import {
  applyHomographyInverse,
  computeHomography,
  invert3x3,
  type Point,
} from "../math/matrix.js";
import type { Corner } from "../types.js";

function sampleBilinear(
  image: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;

  if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) {
    return 1;
  }

  const v00 = image[y0 * width + x0]!;
  const v10 = image[y0 * width + x1]!;
  const v01 = image[y1 * width + x0]!;
  const v11 = image[y1 * width + x1]!;

  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

export function warpPerspective(
  image: Float32Array,
  width: number,
  height: number,
  corners: [Corner, Corner, Corner, Corner],
): { gray: Float32Array; width: number; height: number } {
  const [tl, tr, br, bl] = corners;

  const src: [Point, Point, Point, Point] = [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y },
  ];

  const dstWidth = Math.round(
    Math.max(
      Math.hypot(tr.x - tl.x, tr.y - tl.y),
      Math.hypot(br.x - bl.x, br.y - bl.y),
    ),
  );
  const dstHeight = Math.round(
    Math.max(
      Math.hypot(bl.x - tl.x, bl.y - tl.y),
      Math.hypot(br.x - tr.x, br.y - tr.y),
    ),
  );

  const dst: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];

  const H = computeHomography(src, dst);
  const Hinv = invert3x3(H);
  if (!Hinv) {
    throw new Error("Failed to compute inverse homography");
  }

  const warped = new Float32Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcPt = applyHomographyInverse(Hinv, x, y);
      warped[y * dstWidth + x] = sampleBilinear(
        image,
        width,
        height,
        srcPt.x,
        srcPt.y,
      );
    }
  }

  return { gray: warped, width: dstWidth, height: dstHeight };
}
