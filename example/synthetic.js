import { generateBullseyeTemplate } from "../dist/patterns/bullseye.js";

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

/** Default marks for the generated sample sheet. */
export const sampleMarks = [
  [[0], [1], [2], [3]],
  [[1], [1], [1], [1]],
];

function createWhiteImage(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 255;
    pixels[i * 4 + 1] = 255;
    pixels[i * 4 + 2] = 255;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function stampTemplate(pixels, width, height, template, tw, th, cx, cy) {
  const x0 = Math.round(cx - tw / 2);
  const y0 = Math.round(cy - th / 2);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const x = x0 + tx;
      const y = y0 + ty;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const val = template[ty * tw + tx];
      const idx = (y * width + x) * 4;
      const color = val > 0.5 ? 0 : 255;
      pixels[idx] = color;
      pixels[idx + 1] = color;
      pixels[idx + 2] = color;
    }
  }
}

function fillRect(pixels, width, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const idx = (py * width + px) * 4;
      pixels[idx] = color;
      pixels[idx + 1] = color;
      pixels[idx + 2] = color;
    }
  }
}

export function createSyntheticSheet(
  width,
  height,
  data = sampleData,
  marks = sampleMarks,
) {
  const pixels = createWhiteImage(width, height);
  const { template, width: tw, height: th } = generateBullseyeTemplate(31);
  const cornerPx = tw;

  const corners = [
    { x: cornerPx / 2, y: cornerPx / 2 },
    { x: width - cornerPx / 2, y: cornerPx / 2 },
    { x: width - cornerPx / 2, y: height - cornerPx / 2 },
    { x: cornerPx / 2, y: height - cornerPx / 2 },
  ];

  for (const c of corners) {
    stampTemplate(pixels, width, height, template, tw, th, c.x, c.y);
  }

  const scaleFactor = cornerPx / data.cornerSize;

  data.answersBlocks.forEach((block, blockIndex) => {
    const cellW = block.width * scaleFactor;
    const cellH = (block.height ?? block.width) * scaleFactor;
    const gapCol = block.gaps.columns * scaleFactor;
    const gapRow = block.gaps.rows * scaleFactor;
    const startX = cornerPx / 2 + block.startX * scaleFactor;
    const startY = cornerPx / 2 + block.startY * scaleFactor;

    for (let row = 0; row < block.rows; row++) {
      for (let col = 0; col < block.columns; col++) {
        const marked = marks[blockIndex]?.[row]?.includes(col) ?? false;
        if (!marked) continue;
        const x = Math.round(startX + col * (cellW + gapCol));
        const y = Math.round(startY + row * (cellH + gapRow));
        fillRect(
          pixels,
          width,
          x + 2,
          y + 2,
          Math.max(1, Math.round(cellW) - 4),
          Math.max(1, Math.round(cellH) - 4),
          0,
        );
      }
    }
  });

  return { pixels, width, height };
}
