import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import {
  type OrientationCandidate,
  RectificationError,
  type Result,
} from "../types.js";
import { analyzeAnswers } from "./analyze.js";
import { renderRecognitionGrid } from "./debug-render.js";
import { detectGrid } from "./grid.js";
import { prepareRectification, rectifyPrepared } from "./rectify.js";

export async function runPipeline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<Result> {
  const prepared = prepareRectification(pixels, width, height, data, config);
  const candidates: OrientationCandidate[] = [];
  let inspection: ReturnType<typeof rectifyPrepared> | undefined;
  const warpFailures: RectificationError[] = [];
  const valid: {
    geometry: ReturnType<typeof rectifyPrepared>;
    grid: ReturnType<typeof detectGrid>;
  }[] = [];
  const rotations =
    config.orientation === "none"
      ? [config.rotation]
      : ([0, 90, 180, 270] as const);
  for (const rotation of rotations) {
    try {
      // Each warp samples the original page, never another orientation's resampled pixels.
      const geometry = rectifyPrepared(prepared, data, { ...config, rotation });
      if (!inspection || rotation === config.rotation) inspection = geometry;
      const grid = detectGrid(geometry.rectified, data, geometry.scaleFactor);
      candidates.push({ rotation, valid: true, score: grid.score });
      valid.push({ geometry, grid });
    } catch (error) {
      if (error instanceof RectificationError) warpFailures.push(error);
      candidates.push({
        rotation,
        valid: false,
        score: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (warpFailures.length === rotations.length) throw warpFailures[0]!;
  valid.sort((a, b) => b.grid.score - a.grid.score);
  if (!valid.length)
    throw new RectificationError(
      "grid",
      `Markers were detected and the page was rectified, but the printed cells do not match the configured positions, sizes, or spacing. Inspect the configured grid overlay to adjust the sheet layout.${config.debug ? ` ${candidates.map((c) => `${c.rotation}°: ${c.reason}`).join("; ")}` : ""}`,
      prepared.page,
      inspection,
    );
  if (valid.length > 1 && valid[0]!.grid.score - valid[1]!.grid.score < 0.08)
    throw new RectificationError(
      "orientation",
      "Printed grid orientation is ambiguous. Set orientation: 'none' and an explicit rotation for this layout.",
      prepared.page,
      valid[0]!.geometry,
    );
  const { geometry, grid } = valid[0]!;
  let answers: Result["answers"];
  try {
    answers = analyzeAnswers(grid.gray, geometry.rectified, grid.cells, config);
  } catch (error) {
    throw new RectificationError(
      "grid",
      error instanceof Error ? error.message : String(error),
      prepared.page,
      geometry,
    );
  }
  const warnings = [...geometry.warnings];
  const uncertain = grid.cells
    .flat(2)
    .filter((c) => c.status === "uncertain").length;
  if (uncertain)
    warnings.push(
      `${uncertain} uncertain cell(s) require review; they are excluded from answers.`,
    );
  const result: Result = { answers, warnings };
  if (config.debug)
    result.debug = {
      ...geometry,
      corners: geometry.markers,
      cells: grid.cells,
      orientation: {
        appliedRotation: geometry.rotation,
        autoFlipped: (geometry.rotation - config.rotation + 360) % 360 === 180,
        candidates,
      },
      gridImage: renderRecognitionGrid(geometry.rectified, grid.cells),
    };
  return result;
}
