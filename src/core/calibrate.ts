import {
  applyHomographyInverse,
  computeHomography,
  invert3x3,
} from "../math/matrix.js";
import type { RasterImage } from "../types.js";
import type { detectMarkers, MarkerCandidate } from "./detect.js";
import { fitBullseye } from "./fit-bullseye.js";

/** Integrate original pixel coverage, rather than counting thresholded boundary pixels. */
function measureMarker(
  image: RasterImage,
  marker: MarkerCandidate,
  h: Float64Array,
) {
  const x0 = Math.max(0, Math.floor(marker.x - marker.width * 0.6));
  const y0 = Math.max(0, Math.floor(marker.y - marker.height * 0.6));
  const x1 = Math.min(image.width, Math.ceil(marker.x + marker.width * 0.6));
  const y1 = Math.min(image.height, Math.ceil(marker.y + marker.height * 0.6));
  const gray: number[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      gray.push(
        (0.299 * image.data[i]! +
          0.587 * image.data[i + 1]! +
          0.114 * image.data[i + 2]!) /
          255,
      );
    }
  const sorted = [...gray].sort((a, b) => a - b);
  const black = sorted[Math.floor(sorted.length * 0.05)]!;
  const white = sorted[Math.floor(sorted.length * 0.95)]!;
  if (!(white - black > 0.1))
    throw new Error("Marker contrast is too low to calibrate the layout");
  const det =
    h[0]! * (h[4]! * h[8]! - h[5]! * h[7]!) -
    h[1]! * (h[3]! * h[8]! - h[5]! * h[6]!) +
    h[2]! * (h[3]! * h[7]! - h[4]! * h[6]!);
  let area = 0,
    mx = 0,
    my = 0,
    index = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const darkness = Math.max(
        0,
        Math.min(1, (white - gray[index++]!) / (white - black)),
      );
      const px = x + 0.5,
        py = y + 0.5;
      const denominator = h[6]! * px + h[7]! * py + h[8]!;
      // The homography Jacobian converts each original pixel's ink area to rectified area.
      const weight = darkness * Math.abs(det / denominator ** 3);
      const p = applyHomographyInverse(h, px, py);
      area += weight;
      mx += weight * p.x;
      my += weight * p.y;
    }
  if (!(area > 0) || !Number.isFinite(area))
    throw new Error("Could not measure the reference marker ink");
  return { area, x: mx / area, y: my / area };
}

export function calibrateFrame(
  image: RasterImage,
  detection: ReturnType<typeof detectMarkers>,
  aspectRatio: number,
  cornerSize: number,
  rotation: number,
) {
  const shift = (4 - rotation / 90) % 4;
  const markers = [0, 1, 2, 3].map(
    (i) => detection.markers[(i + shift) % 4]!,
  ) as typeof detection.markers;
  const frameWidth = 1000 * aspectRatio;
  const destination = [
    { x: 0, y: 0 },
    { x: frameWidth, y: 0 },
    { x: frameWidth, y: 1000 },
    { x: 0, y: 1000 },
  ] as const;
  let widths: number[] = [];
  // Refine in the rectified plane so projective skew does not bias an ink centroid.
  for (let pass = 0; pass < 3; pass++) {
    const h = computeHomography(markers, [...destination]);
    const inverse = invert3x3(h);
    if (!inverse)
      throw new Error("Could not invert marker calibration homography");
    widths = [];
    const centers = markers.map((marker) => {
      const fit = detection.radii
        ? fitBullseye(image, marker, h, detection.radii)
        : null;
      const measured = fit ?? measureMarker(image, marker, h);
      const width =
        "width" in measured
          ? measured.width
          : Math.sqrt(measured.area / detection.ink.area);
      widths.push(width);
      let dx = (detection.ink.x - 0.5) * width;
      let dy = (detection.ink.y - 0.5 / detection.referenceAspectRatio) * width;
      const turns = (marker.referenceRotation + rotation / 90) % 4;
      for (let i = 0; i < turns; i++) [dx, dy] = [-dy, dx];
      const center = applyHomographyInverse(
        inverse,
        measured.x - dx,
        measured.y - dy,
      );
      if (
        Math.hypot(center.x - marker.x, center.y - marker.y) >
        Math.max(marker.width, marker.height) * 0.25
      )
        throw new Error(
          "Marker calibration moved outside the matched reference; check surrounding ink",
        );
      return center;
    });
    if (pass < 2) {
      markers.forEach((marker, i) => {
        Object.assign(marker, centers[i]);
      });
    }
  }
  const sorted = [...widths].sort((a, b) => a - b);
  const markerWidth = (sorted[1]! + sorted[2]!) / 2;
  return {
    corners: markers,
    logicalWidth: (frameWidth * cornerSize) / markerWidth,
    inconsistent: sorted[3]! / sorted[0]! > 1.15,
  };
}
