import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import { buildIntegral, rectSum } from "../math/integral.js";
import type { Answer } from "../types.js";
import { binarize, computeOtsuThreshold } from "./preprocess.js";

function columnToAnswer(
  columnIndex: number,
  columns: number,
  outputFormat: ResolvedConfig["outputFormat"],
): Answer {
  if (outputFormat.type === "number") {
    return columnIndex + outputFormat.startAt;
  }
  if (columns > 26) {
    return columnIndex + 1;
  }
  return String.fromCharCode(97 + columnIndex);
}

export function analyzeAnswers(
  gray: Float32Array,
  width: number,
  height: number,
  data: Data,
  scaleFactor: number,
  config: ResolvedConfig,
): Answer[][][] {
  const threshold = computeOtsuThreshold(gray);
  const binary = binarize(gray, threshold);
  const sat = buildIntegral(binary, width, height);

  const results: Answer[][][] = [];

  for (const block of data.answersBlocks) {
    const cellW = block.width * scaleFactor;
    const cellH = (block.height ?? block.width) * scaleFactor;
    const gapCol = block.gaps.columns * scaleFactor;
    const gapRow = block.gaps.rows * scaleFactor;
    const startX = block.startX * scaleFactor;
    const startY = block.startY * scaleFactor;

    const blockAnswers: Answer[][] = [];

    for (let row = 0; row < block.rows; row++) {
      const rowAnswers: Answer[] = [];
      const y = Math.round(startY + row * (cellH + gapRow));
      const y1 = Math.min(Math.round(y + cellH), height);

      for (let col = 0; col < block.columns; col++) {
        const x = Math.round(startX + col * (cellW + gapCol));
        const x1 = Math.min(Math.round(x + cellW), width);

        if (x >= width || y >= height || x1 <= x || y1 <= y) continue;

        const inkSum = rectSum(sat, x, y, x1, y1, width);
        const area = (x1 - x) * (y1 - y);
        const fillRatio = inkSum / area;

        if (fillRatio > config.fillThreshold) {
          rowAnswers.push(
            columnToAnswer(col, block.columns, config.outputFormat),
          );
        }
      }

      blockAnswers.push(rowAnswers);
    }

    results.push(blockAnswers);
  }

  return results;
}
