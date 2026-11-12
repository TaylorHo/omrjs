import { BULLSEYE_RADII } from "../dist/patterns/bullseye-bitmap.js";

export const sampleData = {
  cornerPattern: "bullseye",
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 200,
      startY: 200,
      rows: 4,
      columns: 5,
      width: 80,
      gaps: { columns: 20, rows: 20 },
    },
    {
      startX: 800,
      startY: 200,
      rows: 4,
      columns: 5,
      width: 80,
      gaps: { columns: 20, rows: 20 },
    },
  ],
};
export const sampleMarks = [
  [[0], [1], [2], [3]],
  [[1], [1], [1], [1]],
];

/** Printable outlines and actual reference markers on paper against a dark backdrop. */
export function createSyntheticSheet(
  width,
  height,
  data = sampleData,
  marks = sampleMarks,
  options = {},
) {
  const ratio = options.aspectRatio ?? 0.75;
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw new Error("Set a positive marker-frame aspect ratio");
  const color = options.page?.backgroundColor ?? [255, 255, 255];
  const pixels = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) pixels[i + c] = rgb[c];
    pixels[i + 3] = 255;
  };
  const paper = 20;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      put(
        x,
        y,
        x >= paper && y >= paper && x < width - paper && y < height - paper
          ? color
          : [35, 45, 55],
      );
  let frameUnits = data.cornerSize * 16;
  for (const block of data.answersBlocks) {
    const right =
      block.startX +
      (block.columns - 1) * (block.width + block.gaps.columns) +
      block.width;
    const bottom =
      block.startY +
      (block.rows - 1) * ((block.height ?? block.width) + block.gaps.rows) +
      (block.height ?? block.width);
    frameUnits = Math.max(
      frameUnits,
      right + data.cornerSize,
      (bottom + data.cornerSize) * ratio,
    );
  }
  const availableW = width - paper * 2 - 60;
  const availableH = height - paper * 2 - 60;
  const frameW = Math.min(availableW, availableH * ratio);
  const frameH = frameW / ratio;
  const left = (width - frameW) / 2,
    top = (height - frameH) / 2;
  const scale = frameW / frameUnits;
  const markerW = Math.max(9, Math.round(data.cornerSize * scale));
  const custom =
    typeof data.cornerPattern === "object" ? data.cornerPattern : null;
  const markerH = Math.max(
    7,
    Math.round(markerW * (custom ? custom.height / custom.width : 1)),
  );
  for (const [cx, cy] of [
    [left, top],
    [left + frameW, top],
    [left + frameW, top + frameH],
    [left, top + frameH],
  ]) {
    if (!custom) {
      // Preserve fractional marker size and ink coverage; rounded binary stamps bias layout calibration.
      const markerSize = data.cornerSize * scale;
      for (
        let y = Math.floor(cy - markerSize / 2);
        y < cy + markerSize / 2;
        y++
      )
        for (
          let x = Math.floor(cx - markerSize / 2);
          x < cx + markerSize / 2;
          x++
        ) {
          let ink = 0;
          for (let sy = 0; sy < 8; sy++)
            for (let sx = 0; sx < 8; sx++) {
              const r =
                Math.hypot(x + (sx + 0.5) / 8 - cx, y + (sy + 0.5) / 8 - cy) /
                markerSize;
              if (
                (r >= BULLSEYE_RADII[0] && r <= BULLSEYE_RADII[1]) ||
                (r >= BULLSEYE_RADII[2] && r <= BULLSEYE_RADII[3])
              )
                ink++;
            }
          put(
            x,
            y,
            color.map((v) => v * (1 - ink / 64)),
          );
        }
    } else
      for (let y = 0; y < markerH; y++)
        for (let x = 0; x < markerW; x++) {
          const sx = Math.floor(((x + 0.5) * custom.width) / markerW);
          const sy = Math.floor(((y + 0.5) * custom.height) / markerH);
          const i = (sy * custom.width + sx) * 4;
          const a = custom.pixels[i + 3] / 255;
          const rgb = color.map(
            (v, c) => custom.pixels[i + c] * a + v * (1 - a),
          );
          put(
            Math.round(cx - markerW / 2) + x,
            Math.round(cy - markerH / 2) + y,
            rgb,
          );
        }
  }
  data.answersBlocks.forEach((block, bi) => {
    const cw = block.width * scale,
      ch = (block.height ?? block.width) * scale;
    for (let row = 0; row < block.rows; row++)
      for (let col = 0; col < block.columns; col++) {
        const x0 =
          left +
          (block.startX + col * (block.width + block.gaps.columns)) * scale;
        const y0 =
          top +
          (block.startY +
            row * ((block.height ?? block.width) + block.gaps.rows)) *
            scale;
        const marked = marks[bi]?.[row]?.includes(col) ?? false;
        for (let y = Math.floor(y0); y < y0 + ch; y++)
          for (let x = Math.floor(x0); x < x0 + cw; x++) {
            const dx = Math.abs((x + 0.5 - x0 - cw / 2) / (cw / 2));
            const dy = Math.abs((y + 0.5 - y0 - ch / 2) / (ch / 2));
            const outer =
              options.shape === "rectangle"
                ? Math.max(dx, dy)
                : Math.hypot(dx, dy);
            const inner =
              options.shape === "rectangle"
                ? Math.max(
                    (dx * cw) / Math.max(1, cw - 3),
                    (dy * ch) / Math.max(1, ch - 3),
                  )
                : Math.hypot(
                    (dx * cw) / Math.max(1, cw - 3),
                    (dy * ch) / Math.max(1, ch - 3),
                  );
            if (outer <= 1 && inner >= 1) put(x, y, [15, 15, 15]);
            else if (marked && outer < 0.75 && dx < (options.markWidth ?? 1))
              put(x, y, options.markColor ?? [15, 15, 15]);
          }
      }
  });
  return { pixels, width, height };
}
