import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import { applyHomographyInverse } from "../math/matrix.js";
import {
  type DetectedPage,
  type Marker,
  RectificationError,
  type RectificationResult,
} from "../types.js";
import { calibrateFrame } from "./calibrate.js";
import { renderLayoutGrid } from "./debug-render.js";
import { detectMarkers } from "./detect.js";
import { detectPage } from "./page.js";
import { preprocess } from "./preprocess.js";
import { warpRgba } from "./warp.js";

function validateInput(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
) {
  if (
    !(pixels instanceof Uint8ClampedArray) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 8 ||
    height < 8 ||
    width * height > 25_000_000 ||
    pixels.length !== width * height * 4
  )
    throw new RectificationError(
      "input",
      "Expected RGBA pixels matching integer dimensions (8 pixels minimum, 25 megapixels maximum)",
    );
  if (config.aspectRatio === null)
    throw new RectificationError(
      "input",
      "Set aspectRatio to the width / height between marker centers",
    );
  if (
    !data ||
    !Number.isFinite(data.cornerSize) ||
    data.cornerSize <= 0 ||
    !Array.isArray(data.answersBlocks)
  )
    throw new RectificationError(
      "input",
      "Expected a positive cornerSize and answersBlocks array",
    );
  let cells = 0;
  for (const block of data.answersBlocks) {
    if (
      !block?.gaps ||
      ![block.startX, block.startY, block.gaps.columns, block.gaps.rows].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) ||
      ![block.width, block.height ?? block.width].every(
        (v) => Number.isFinite(v) && v > 0,
      ) ||
      ![block.rows, block.columns].every(
        (v) => Number.isSafeInteger(v) && v > 0,
      )
    )
      throw new RectificationError(
        "input",
        "Blocks require nonnegative positions/gaps, positive dimensions, and positive integer rows/columns",
      );
    cells += block.rows * block.columns;
  }
  if (cells > 100_000)
    throw new RectificationError(
      "input",
      "Configured grid exceeds 100,000 cells",
    );
  const marker = data.cornerPattern;
  if (marker !== undefined && marker !== "bullseye") {
    if (
      marker?.type !== "image" ||
      !(marker.pixels instanceof Uint8ClampedArray) ||
      !Number.isSafeInteger(marker.width) ||
      !Number.isSafeInteger(marker.height) ||
      marker.width < 2 ||
      marker.height < 2 ||
      marker.width * marker.height > 25_000_000 ||
      marker.pixels.length !== marker.width * marker.height * 4
    )
      throw new RectificationError(
        "input",
        "Custom marker must contain valid RGBA pixels and dimensions",
      );
  }
}

export function runRectification(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): RectificationResult {
  validateInput(pixels, width, height, data, config);
  let page: DetectedPage | undefined;
  let stage: "page" | "markers" | "warp" = "page";
  try {
    page = detectPage(pixels, width, height, config);
    stage = "markers";
    const image = page.image;
    // Geometry uses unbrightened luminance; page-color detection already used original RGB.
    const factor = Math.min(1, 1600 / Math.max(image.width, image.height));
    const dw = Math.round(image.width * factor),
      dh = Math.round(image.height * factor);
    const detectionPixels =
      factor === 1 ? image.data : new Uint8ClampedArray(dw * dh * 4);
    if (factor !== 1) {
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const src =
            (Math.min(
              image.height - 1,
              Math.floor(((y + 0.5) * image.height) / dh),
            ) *
              image.width +
              Math.min(
                image.width - 1,
                Math.floor(((x + 0.5) * image.width) / dw),
              )) *
            4;
          detectionPixels.set(
            image.data.subarray(src, src + 4),
            (y * dw + x) * 4,
          );
        }
    }
    const prepared = preprocess(detectionPixels, dw, dh, {
      ...config,
      grayscale: "luminance",
      exposureGamma: 1,
    });
    const detection = detectMarkers(
      Float32Array.from(prepared.binary),
      dw,
      dh,
      data,
      config.nccThreshold,
    );
    for (const marker of detection.markers) {
      marker.x *= image.width / dw;
      marker.y *= image.height / dh;
      marker.width *= image.width / dw;
      marker.height *= image.height / dh;
      marker.size = marker.width;
      for (const p of marker.support) {
        p.x *= image.width / dw;
        p.y *= image.height / dh;
      }
    }
    stage = "warp";
    const calibration = calibrateFrame(
      image,
      detection,
      config.aspectRatio!,
      data.cornerSize,
      config.rotation,
    );
    const warped = warpRgba(
      image,
      calibration.corners,
      config.aspectRatio!,
      calibration.logicalWidth,
    );
    const horizontal: number[] = [],
      vertical: number[] = [];
    for (const marker of detection.markers) {
      const support = marker.support.map((p) =>
        applyHomographyInverse(warped.homography, p.x, p.y),
      );
      const xs = support.map((p) => p.x),
        ys = support.map((p) => p.y);
      const turned =
        (marker.referenceRotation + config.rotation / 90) % 2 === 1;
      const xFraction = turned
        ? detection.inkHeightFraction
        : detection.inkWidthFraction;
      const yFraction = turned
        ? detection.inkWidthFraction
        : detection.inkHeightFraction;
      const sx =
        ((Math.max(...xs) - Math.min(...xs) + 1) /
          xFraction /
          data.cornerSize) *
        (turned ? detection.referenceAspectRatio : 1);
      const sy =
        ((Math.max(...ys) - Math.min(...ys) + 1) /
          yFraction /
          data.cornerSize) *
        (turned ? 1 : detection.referenceAspectRatio);
      horizontal.push(sx);
      vertical.push(sy);
    }
    const scaleFactor = warped.scaleFactor;
    const grid = renderLayoutGrid(warped.image, data, scaleFactor);
    const warnings = [...grid.warnings];
    const sx = horizontal.reduce((a, b) => a + b) / 4,
      sy = vertical.reduce((a, b) => a + b) / 4;
    if (Math.max(sx, sy) / Math.min(sx, sy) > 1.15)
      warnings.push(
        "Rectified marker proportions disagree; check the marker-frame aspect ratio or reference image.",
      );
    if (calibration.inconsistent)
      warnings.push(
        "Marker scale varies across the frame; inspect marker matches and perspective correction.",
      );
    return {
      page,
      markers: detection.markers.map(
        ({ support: _, referenceRotation: _rotation, ...marker }) => marker,
      ) as [Marker, Marker, Marker, Marker],
      rectified: warped.image,
      logicalSize: {
        width: calibration.logicalWidth,
        height: calibration.logicalWidth / config.aspectRatio!,
      },
      gridImage: grid.image,
      scaleFactor,
      rotation: config.rotation,
      warnings,
    };
  } catch (error) {
    if (error instanceof RectificationError) throw error;
    throw new RectificationError(
      stage,
      error instanceof Error ? error.message : String(error),
      page,
    );
  }
}
