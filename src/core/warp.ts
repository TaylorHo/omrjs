import {
  applyHomographyInverse,
  computeHomography,
  invert3x3,
  type Point,
} from "../math/matrix.js";
import type { RasterImage } from "../types.js";

/** Map an ordered marker frame directly into the requested output proportions. */
export function warpRgba(
  image: RasterImage,
  corners: [Point, Point, Point, Point],
  aspectRatio: number,
  logicalWidth: number,
) {
  const scaleFactor = Math.min(
    1,
    2400 / Math.max(logicalWidth, logicalWidth / aspectRatio),
  );
  const spanWidth = logicalWidth * scaleFactor;
  const spanHeight = spanWidth / aspectRatio;
  const dw = Math.ceil(spanWidth),
    dh = Math.ceil(spanHeight);
  if (
    !Number.isFinite(dw) ||
    !Number.isFinite(dh) ||
    dw * dh > 6_000_000 ||
    Math.min(dw, dh) < 8
  )
    throw new Error(
      "Marker frame or aspectRatio produces an unusable output size",
    );
  const homography = computeHomography(corners, [
    { x: 0, y: 0 },
    { x: spanWidth, y: 0 },
    { x: spanWidth, y: spanHeight },
    { x: 0, y: spanHeight },
  ]);
  const inverse = invert3x3(homography);
  if (!inverse) throw new Error("Failed to invert the marker homography");
  const output = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const p = applyHomographyInverse(inverse, x + 0.5, y + 0.5);
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > image.width ||
        p.y > image.height
      )
        throw new Error("Marker homography samples outside the page");
      const px = Math.max(0, Math.min(image.width - 1, p.x - 0.5));
      const py = Math.max(0, Math.min(image.height - 1, p.y - 0.5));
      const x0 = Math.floor(px),
        y0 = Math.floor(py);
      const x1 = Math.min(image.width - 1, x0 + 1),
        y1 = Math.min(image.height - 1, y0 + 1);
      const fx = px - x0,
        fy = py - y0;
      const dst = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top =
          image.data[(y0 * image.width + x0) * 4 + c]! * (1 - fx) +
          image.data[(y0 * image.width + x1) * 4 + c]! * fx;
        const bottom =
          image.data[(y1 * image.width + x0) * 4 + c]! * (1 - fx) +
          image.data[(y1 * image.width + x1) * 4 + c]! * fx;
        output[dst + c] = top * (1 - fy) + bottom * fy;
      }
      output[dst + 3] = 255;
    }
  }
  return {
    image: { data: output, width: dw, height: dh },
    homography,
    scaleFactor,
  };
}
