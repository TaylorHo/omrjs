import type { ResolvedConfig } from "../config.js";
import type { Data, ImageMarker } from "../data.js";
import type { NccMatch } from "../math/correlation.js";
import { findBullseyeMatch } from "../patterns/bullseye.js";
import {
  findImageMarkerMatch,
  type PreparedImageTemplate,
  prepareImageMarkerTemplate,
} from "../patterns/image-marker.js";
import type { Corner, DetectedCorners } from "../types.js";

type SearchRegion = { x0: number; y0: number; x1: number; y1: number };
type CornerPattern = "bullseye" | ImageMarker;

function isImageMarker(pattern: CornerPattern): pattern is ImageMarker {
  return typeof pattern === "object" && pattern.type === "image";
}

function findMatchInRegion(
  image: Float32Array,
  width: number,
  height: number,
  pattern: CornerPattern,
  config: ResolvedConfig,
  scale: number,
  region: SearchRegion,
  fixedSize?: number,
  imageTemplate?: PreparedImageTemplate,
): NccMatch | null {
  const { x0, y0, x1, y1 } = region;

  if (isImageMarker(pattern)) {
    if (!imageTemplate) {
      throw new Error("Image marker template was not prepared");
    }
    return findImageMarkerMatch(
      image,
      width,
      height,
      imageTemplate,
      scale,
      config.nccThreshold,
      x0,
      y0,
      x1,
      y1,
      fixedSize,
    );
  }

  return findBullseyeMatch(
    image,
    width,
    height,
    scale,
    config.nccThreshold,
    x0,
    y0,
    x1,
    y1,
    fixedSize,
  );
}

function findBestMatch(
  image: Float32Array,
  width: number,
  height: number,
  pattern: CornerPattern,
  config: ResolvedConfig,
  region: SearchRegion,
  fixedSize?: number,
  imageTemplate?: PreparedImageTemplate,
): NccMatch | null {
  if (fixedSize !== undefined) {
    return findMatchInRegion(
      image,
      width,
      height,
      pattern,
      config,
      1,
      region,
      fixedSize,
      imageTemplate,
    );
  }

  let best: NccMatch | null = null;
  for (const scale of config.detectionScales) {
    const match = findMatchInRegion(
      image,
      width,
      height,
      pattern,
      config,
      scale,
      region,
      undefined,
      imageTemplate,
    );
    if (
      match &&
      (!best ||
        match.score > best.score + 1e-6 ||
        (match.score >= best.score - 0.05 && match.size > best.size))
    ) {
      best = match;
    }
  }
  return best;
}

function matchToCorner(match: NccMatch): Corner {
  return {
    x: match.x + match.size / 2,
    y: match.y + match.size / 2,
    size: match.size,
  };
}

function cornerSearchRegions(
  width: number,
  height: number,
  margin: number,
  anchorSize: number,
): SearchRegion[] {
  const mx = Math.max(Math.floor(width * margin), Math.ceil(anchorSize));
  const my = Math.max(Math.floor(height * margin), Math.ceil(anchorSize));
  const pad = Math.ceil(anchorSize);

  return [
    { x0: 0, y0: 0, x1: mx + pad, y1: my + pad },
    { x0: width - mx - pad, y0: 0, x1: width, y1: my + pad },
    { x0: width - mx - pad, y0: height - my - pad, x1: width, y1: height },
    { x0: 0, y0: height - my - pad, x1: mx + pad, y1: height },
  ];
}

function orderCorners(corners: Corner[]): [Corner, Corner, Corner, Corner] {
  const sorted = [...corners].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0]!, top[1]!, bottom[1]!, bottom[0]!];
}

export function detectCorners(
  image: Float32Array,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): DetectedCorners {
  const pattern: CornerPattern = data.cornerPattern ?? "bullseye";
  const imageTemplate = isImageMarker(pattern)
    ? prepareImageMarkerTemplate(pattern)
    : undefined;

  const fullRegion: SearchRegion = { x0: 0, y0: 0, x1: width, y1: height };
  const anchorMatch = findBestMatch(
    image,
    width,
    height,
    pattern,
    config,
    fullRegion,
    undefined,
    imageTemplate,
  );

  if (!anchorMatch) {
    throw new Error("Could not detect any corner markers");
  }

  const regions = cornerSearchRegions(
    width,
    height,
    config.cornerSearchMargin,
    anchorMatch.size,
  );

  const found: Corner[] = [];
  for (const region of regions) {
    const match = findBestMatch(
      image,
      width,
      height,
      pattern,
      config,
      region,
      anchorMatch.size,
      imageTemplate,
    );
    if (!match) {
      throw new Error("Could not detect all four corner markers");
    }
    found.push(matchToCorner(match));
  }

  const corners = orderCorners(found);
  const avgSize =
    (corners[0].size + corners[1].size + corners[2].size + corners[3].size) / 4;
  const scaleFactor = avgSize / data.cornerSize;

  return {
    corners,
    scaleFactor,
  };
}
