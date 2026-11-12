import type { ResolvedConfig } from "../config.js";
import type { Answer, CellMeasurement, RasterImage } from "../types.js";

function columnToAnswer(
  column: number,
  columns: number,
  format: ResolvedConfig["outputFormat"],
): Answer {
  if (format.type === "number") return column + format.startAt;
  return columns > 26 ? column + 1 : String.fromCharCode(97 + column);
}

export function analyzeAnswers(
  gray: Float32Array,
  image: RasterImage,
  cells: CellMeasurement[][][],
  config: ResolvedConfig,
) {
  for (const block of cells)
    for (const row of block)
      for (const cell of row) {
        const patch: number[] = [];
        for (
          let y = Math.max(0, cell.y - 2);
          y < Math.min(image.height, cell.y + cell.height + 2);
          y++
        )
          for (
            let x = Math.max(0, cell.x - 2);
            x < Math.min(image.width, cell.x + cell.width + 2);
            x++
          )
            patch.push(gray[y * image.width + x]!);
        patch.sort((a, b) => a - b);
        const white = patch[Math.floor(patch.length * 0.9)]!,
          black = patch[Math.floor(patch.length * 0.05)]!;
        if (white - black < 0.15)
          throw new Error("Cell contrast is too low to read marks");
        let ink = 0,
          area = 0;
        // Inset excludes printed borders; remaining letter ink is compensated per column below.
        for (let y = cell.y; y < cell.y + cell.height; y++)
          for (let x = cell.x; x < cell.x + cell.width; x++) {
            const dx = (x + 0.5 - cell.x - cell.width / 2) / (cell.width / 2);
            const dy = (y + 0.5 - cell.y - cell.height / 2) / (cell.height / 2);
            if (
              (cell.shape === "ellipse"
                ? Math.hypot(dx, dy)
                : Math.max(Math.abs(dx), Math.abs(dy))) > 0.65
            )
              continue;
            area++;
            if ((white - gray[y * image.width + x]!) / (white - black) > 0.12)
              ink++;
          }
        cell.inkRatio = ink / area;
      }
  for (const block of cells)
    for (let col = 0; col < block[0]!.length; col++) {
      const ratios = block
        .map((row) => row[col]!.inkRatio)
        .sort((a, b) => a - b);
      // shortcut: infer letter ink from low-coverage rows, use a blank reference template for dense printed interiors.
      const low = ratios[Math.floor((ratios.length - 1) * 0.2)]!;
      const baseline = low < 0.35 ? low : 0;
      for (const row of block) {
        const cell = row[col]!;
        cell.fillRatio = Math.max(
          0,
          (cell.inkRatio - baseline) / (1 - baseline),
        );
        cell.status =
          Math.abs(cell.fillRatio - config.fillThreshold) <= 0.1
            ? "uncertain"
            : cell.fillRatio > config.fillThreshold
              ? "marked"
              : "blank";
      }
    }
  return cells.map((block) =>
    block.map((row) =>
      row.flatMap((cell, col) =>
        cell.status === "marked"
          ? [columnToAnswer(col, row.length, config.outputFormat)]
          : [],
      ),
    ),
  );
}
