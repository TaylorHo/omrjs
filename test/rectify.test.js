import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPage } from "../dist/core/page.js";
import {
  OMR,
  RectificationError,
  rectify,
  resolveConfig,
} from "../dist/index.js";
import {
  applyHomographyInverse,
  computeHomography,
  invert3x3,
} from "../dist/math/matrix.js";
import { handleWorkerRequest } from "../dist/worker/worker.js";
import { createSyntheticSheet, sampleData } from "../example/synthetic.js";

const layout = {
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 150,
      startY: 220,
      rows: 3,
      columns: 4,
      width: 65,
      height: 50,
      gaps: { columns: 25, rows: 40 },
    },
  ],
};
const pixel = (image, x, y) => [
  ...image.data.slice(
    (Math.round(y) * image.width + Math.round(x)) * 4,
    (Math.round(y) * image.width + Math.round(x)) * 4 + 3,
  ),
];

// Independent printed fixture: analytic rings, known physical coordinates, no detector helpers.
function printedSheet({ missing = false, color = [255, 255, 255] } = {}) {
  const width = 320,
    height = 440;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([...color, 255], i * 4);
  const centers = [
    [40, 40],
    [280, 40],
    [280, 400],
    [40, 400],
  ];
  for (const [index, [cx, cy]] of centers.entries()) {
    if (missing && index === 2) continue;
    for (let y = cy - 18; y < cy + 18; y++)
      for (let x = cx - 18; x < cx + 18; x++) {
        const radius = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (
          (radius < 16.66 && radius > 12.5) ||
          (radius < 8.33 && radius > 4.16)
        )
          pixels.set([0, 0, 0, 255], (y * width + x) * 4);
      }
  }
  // Colored landmarks check rectification separately from marker scores and grid drawing.
  for (const [x0, y0, rgb] of [
    [100, 120, [230, 20, 30]],
    [220, 320, [20, 160, 50]],
  ]) {
    for (let y = y0 - 4; y <= y0 + 4; y++)
      for (let x = x0 - 4; x <= x0 + 4; x++)
        pixels.set([...rgb, 255], (y * width + x) * 4);
  }
  return { pixels, width, height };
}

function photograph(
  sheet,
  { perspective = true, turn = 0, color = [255, 255, 255] } = {},
) {
  const width = 500,
    height = 650;
  const dst = perspective
    ? [
        { x: 70, y: 30 },
        { x: 440, y: 90 },
        { x: 420, y: 610 },
        { x: 25, y: 550 },
      ]
    : [
        { x: 70, y: 60 },
        { x: 390, y: 60 },
        { x: 390, y: 500 },
        { x: 70, y: 500 },
      ];
  const source = [
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height },
  ];
  const h = computeHomography(source, dst);
  const inverse = invert3x3(h);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = applyHomographyInverse(inverse, x + 0.5, y + 0.5);
      const i = (y * width + x) * 4;
      if (p.x >= 0 && p.y >= 0 && p.x < sheet.width && p.y < sheet.height) {
        const j = (Math.floor(p.y) * sheet.width + Math.floor(p.x)) * 4;
        pixels.set(sheet.pixels.subarray(j, j + 4), i);
      } else pixels.set([35, 45, 55, 255], i);
    }
  // A disconnected patch of the same paper color must not expand the crop.
  for (let y = 5; y < 20; y++)
    for (let x = 460; x < 495; x++)
      pixels.set([...color, 255], (y * width + x) * 4);
  if (!turn)
    return {
      pixels,
      width,
      height,
      h,
      centers: [
        [40, 40],
        [280, 40],
        [280, 400],
        [40, 400],
      ].map(([x, y]) => applyHomographyInverse(h, x, y)),
    };
  const rotated = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rx = height - 1 - y,
        ry = x;
      rotated.set(
        pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
        (ry * height + rx) * 4,
      );
    }
  return { pixels: rotated, width: height, height: width };
}

function resizeSheet(sheet, factor, padding = 0, crop = 0) {
  const sw = sheet.width - crop * 2,
    sh = sheet.height - crop * 2;
  const width = Math.round(sw * factor) + padding * 2;
  const height = Math.round(sh * factor) + padding * 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        x < padding ||
        y < padding ||
        x >= width - padding ||
        y >= height - padding
      ) {
        pixels.set([35, 45, 55, 255], i);
        continue;
      }
      // Area averaging preserves the original ink coverage when reducing a PDF raster.
      const x0 = crop + (x - padding) / factor,
        y0 = crop + (y - padding) / factor;
      const x1 = x0 + 1 / factor,
        y1 = y0 + 1 / factor;
      const rgb = [0, 0, 0];
      let area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx < 0 || sy < 0 || sx >= sheet.width || sy >= sheet.height)
            continue;
          const weight =
            Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx)) *
            Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
          area += weight;
          for (let c = 0; c < 3; c++)
            rgb[c] += sheet.pixels[(sy * sheet.width + sx) * 4 + c] * weight;
        }
      pixels.set([...rgb.map((v) => Math.round(v / area)), 255], i);
    }
  return { pixels, width, height };
}

describe("page and marker rectification", () => {
  it("keeps the same layout coordinates across crops, resolutions, and added backgrounds", async () => {
    const sheet = printedSheet();
    const variants = [
      sheet,
      resizeSheet(sheet, 1, 0, 18),
      resizeSheet(sheet, 3),
      resizeSheet(sheet, 6),
      resizeSheet(sheet, 0.5, 90),
      resizeSheet(sheet, 0.75, 30),
    ];
    const results = [];
    for (const variant of variants)
      results.push(
        await rectify(variant.pixels, variant.width, variant.height, layout, {
          aspectRatio: 2 / 3,
        }),
      );
    const widths = results.map((r) => r.logicalSize.width);
    const heights = results.map((r) => r.logicalSize.height);
    assert.ok(
      Math.max(...widths) - Math.min(...widths) < 1,
      `frame widths in layout units: ${widths}`,
    );
    assert.ok(
      Math.max(...heights) - Math.min(...heights) < 1,
      `frame heights in layout units: ${heights}`,
    );
    assert.ok(
      results.every((r) => r.scaleFactor === 1),
      "cornerSize:100 should normalize the reference width to 100 output pixels",
    );
  });

  it("preserves landmark and grid positions across the same resized and cropped page", async () => {
    const sheet = printedSheet();
    const variants = [
      sheet,
      resizeSheet(sheet, 1, 0, 18),
      resizeSheet(sheet, 0.5, 90),
      resizeSheet(sheet, 0.75, 40),
      resizeSheet(sheet, 3),
    ];
    const landmarks = [];
    for (const variant of variants) {
      const result = await rectify(
        variant.pixels,
        variant.width,
        variant.height,
        layout,
        { aspectRatio: 2 / 3 },
      );
      let weight = 0,
        cx = 0,
        cy = 0;
      for (let y = 0; y < result.rectified.height; y++)
        for (let x = 0; x < result.rectified.width; x++) {
          const i = (y * result.rectified.width + x) * 4;
          const w = Math.max(
            0,
            result.rectified.data[i] -
              Math.max(
                result.rectified.data[i + 1],
                result.rectified.data[i + 2],
              ),
          );
          weight += w;
          cx += w * (x + 0.5);
          cy += w * (y + 0.5);
        }
      landmarks.push({
        x: cx / weight / result.scaleFactor,
        y: cy / weight / result.scaleFactor,
      });
      assert.deepEqual(pixel(result.gridImage, 150, 220), [0, 200, 255]);
      assert.deepEqual(pixel(result.gridImage, 240, 310), [0, 200, 255]);
    }
    assert.ok(
      Math.max(...landmarks.map((p) => p.x)) -
        Math.min(...landmarks.map((p) => p.x)) <
        0.5,
      JSON.stringify(landmarks),
    );
    assert.ok(
      Math.max(...landmarks.map((p) => p.y)) -
        Math.min(...landmarks.map((p) => p.y)) <
        0.5,
      JSON.stringify(landmarks),
    );
  });

  it("keeps calibration stable when a perspective photograph is resized", async () => {
    const photo = photograph(printedSheet());
    const sizes = [];
    for (const image of [
      photo,
      resizeSheet(photo, 0.5, 70),
      resizeSheet(photo, 2),
    ]) {
      const result = await rectify(
        image.pixels,
        image.width,
        image.height,
        layout,
        { aspectRatio: 2 / 3 },
      );
      sizes.push(result.logicalSize.width);
    }
    assert.ok(
      Math.max(...sizes) - Math.min(...sizes) < 1.5,
      `rectified frame widths: ${sizes}`,
    );
  });

  it("uses cornerSize as the normalized reference width and retains uniform scaling at the cap", async () => {
    const sheet = printedSheet();
    const normal = await rectify(sheet.pixels, 320, 440, layout, {
      aspectRatio: 2 / 3,
    });
    const doubled = await rectify(
      sheet.pixels,
      320,
      440,
      { ...layout, cornerSize: 200 },
      { aspectRatio: 2 / 3 },
    );
    const capped = await rectify(
      sheet.pixels,
      320,
      440,
      { ...layout, cornerSize: 1000 },
      { aspectRatio: 2 / 3 },
    );
    assert.equal(normal.scaleFactor, 1);
    assert.equal(doubled.scaleFactor, 1);
    assert.ok(
      Math.abs(doubled.rectified.width / normal.rectified.width - 2) < 0.003,
    );
    assert.ok(capped.scaleFactor < 1);
    assert.ok(
      Math.max(capped.rectified.width, capped.rectified.height) <= 2400,
    );
    assert.ok(
      Math.abs(
        capped.rectified.width / capped.scaleFactor / normal.rectified.width -
          10,
      ) < 0.03,
    );
  });

  it("selects the largest colored page while preserving ink and excluding a separate patch", async () => {
    const color = [245, 225, 170];
    const photo = photograph(printedSheet({ color }), {
      perspective: false,
      color,
    });
    const result = await rectify(
      photo.pixels,
      photo.width,
      photo.height,
      layout,
      {
        aspectRatio: 2 / 3,
        page: { backgroundColor: color, colorTolerance: 0.02 },
      },
    );
    assert.deepEqual(result.page.bounds, {
      x: 70,
      y: 60,
      width: 320,
      height: 440,
    });
    assert.deepEqual(pixel(result.page.image, 100, 120), [230, 20, 30]);
    assert.equal(result.markers.length, 4);
    assert.ok(result.warnings.length === 0, result.warnings.join("; "));
  });

  it("corrects perspective, keeps RGB content, and calibrates against rectified marker footprints", async () => {
    const photo = photograph(printedSheet());
    const result = await rectify(
      photo.pixels,
      photo.width,
      photo.height,
      layout,
      { aspectRatio: 2 / 3 },
    );
    for (let i = 0; i < 4; i++) {
      const marker = result.markers[i],
        expected = photo.centers[i];
      assert.ok(
        Math.hypot(
          marker.x + result.page.bounds.x - expected.x,
          marker.y + result.page.bounds.y - expected.y,
        ) < 3,
        `marker ${i}`,
      );
    }
    assert.ok(
      Math.abs(
        (result.rectified.width - 1) / (result.rectified.height - 1) - 2 / 3,
      ) < 0.003,
    );
    const expectedScale = ((result.rectified.width - 1) / 240) * 0.36;
    assert.ok(
      Math.abs(result.scaleFactor / expectedScale - 1) < 0.07,
      `${result.scaleFactor} vs ${expectedScale}`,
    );
    assert.deepEqual(
      pixel(
        result.rectified,
        ((result.rectified.width - 1) * 60) / 240,
        ((result.rectified.height - 1) * 80) / 360,
      ),
      [230, 20, 30],
    );
    assert.deepEqual(
      pixel(
        result.rectified,
        ((result.rectified.width - 1) * 180) / 240,
        ((result.rectified.height - 1) * 280) / 360,
      ),
      [20, 160, 50],
    );
    assert.notDeepEqual(result.gridImage.data, result.rectified.data);
    assert.equal(result.answers, undefined);
  });

  it("applies all four manual rotations by changing corner correspondence", async () => {
    const photo = photograph(printedSheet(), { perspective: false });
    for (const rotation of [0, 90, 180, 270]) {
      const ratio = rotation % 180 ? 3 / 2 : 2 / 3;
      const result = await new OMR(layout, {
        aspectRatio: ratio,
        rotation,
      }).rectify(photo.pixels, photo.width, photo.height);
      const nx = 60 / 240,
        ny = 80 / 360;
      const point =
        rotation === 0
          ? [nx, ny]
          : rotation === 90
            ? [1 - ny, nx]
            : rotation === 180
              ? [1 - nx, 1 - ny]
              : [ny, 1 - nx];
      assert.deepEqual(
        pixel(
          result.rectified,
          point[0] * (result.rectified.width - 1),
          point[1] * (result.rectified.height - 1),
        ),
        [230, 20, 30],
      );
      assert.equal(result.rotation, rotation);
    }
  });

  it("rectifies a sideways input into the original marker-frame ratio", async () => {
    const photo = photograph(printedSheet(), { perspective: false, turn: 90 });
    const result = await rectify(
      photo.pixels,
      photo.width,
      photo.height,
      layout,
      { aspectRatio: 2 / 3, rotation: 270 },
    );
    assert.deepEqual(
      pixel(
        result.rectified,
        ((result.rectified.width - 1) * 60) / 240,
        ((result.rectified.height - 1) * 80) / 360,
      ),
      [230, 20, 30],
    );
  });

  it("handles both outlined sample shapes without needing any filled answers", async () => {
    for (const shape of ["circle", "rectangle"]) {
      const sheet = createSyntheticSheet(600, 800, sampleData, [], {
        aspectRatio: 0.75,
        shape,
      });
      const result = await rectify(sheet.pixels, 600, 800, sampleData, {
        aspectRatio: 0.75,
      });
      assert.equal(result.markers.length, 4);
      assert.deepEqual(result.warnings, []);
      assert.ok(result.markers.every((p) => p.score > 0.75));
    }
  });

  it("matches transparent, non-square custom references at every quarter turn", async () => {
    const width = 41,
      height = 25;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        if (
          x < 5 ||
          x >= width - 5 ||
          y < 5 ||
          y >= height - 5 ||
          (x >= 10 && x < 14 && y < 17)
        )
          pixels.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    const data = {
      ...sampleData,
      cornerPattern: { type: "image", pixels, width, height },
    };
    const sheet = createSyntheticSheet(600, 800, data, [], {
      aspectRatio: 0.75,
    });
    for (const rotation of [0, 90, 180, 270]) {
      const result = await rectify(sheet.pixels, 600, 800, data, {
        aspectRatio: rotation % 180 ? 4 / 3 : 0.75,
        rotation,
      });
      assert.ok(result.markers.every((p) => p.width > p.height * 1.4));
      assert.equal(result.scaleFactor, 1);
      assert.ok(
        !result.warnings.some((w) => w.includes("proportions")),
        result.warnings.join("; "),
      );
    }
  });

  it("retains custom-marker layout scale after reducing the same image", async () => {
    const width = 31,
      height = 21;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        if (
          x < 5 ||
          y < 5 ||
          x >= width - 5 ||
          y >= height - 5 ||
          (x >= 9 && x < 12 && y < 14)
        )
          pixels.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    const data = {
      ...sampleData,
      cornerPattern: { type: "image", pixels, width, height },
    };
    const sheet = createSyntheticSheet(600, 800, data, [], {
      aspectRatio: 0.75,
    });
    const sizes = [];
    for (const image of [
      sheet,
      resizeSheet(sheet, 0.5, 40),
      resizeSheet(sheet, 2),
    ]) {
      const result = await rectify(
        image.pixels,
        image.width,
        image.height,
        data,
        { aspectRatio: 0.75 },
      );
      sizes.push(result.logicalSize.width);
    }
    assert.ok(
      Math.max(...sizes) - Math.min(...sizes) < 1,
      `custom frame widths: ${sizes}`,
    );
  });

  it("warns about a mismatched ratio and blocks outside the frame", async () => {
    const photo = photograph(printedSheet(), { perspective: false });
    const result = await rectify(
      photo.pixels,
      photo.width,
      photo.height,
      {
        ...layout,
        answersBlocks: [{ ...layout.answersBlocks[0], startX: 2000 }],
      },
      { aspectRatio: 1.5 },
    );
    assert.ok(result.warnings.some((w) => w.includes("proportions")));
    assert.ok(result.warnings.some((w) => w.includes("Block 1")));
  });

  it("bounds detection resolution while warping original-resolution RGB", async () => {
    const sheet = createSyntheticSheet(1800, 2400, sampleData, [], {
      aspectRatio: 0.75,
    });
    const result = await rectify(sheet.pixels, 1800, 2400, sampleData, {
      aspectRatio: 0.75,
    });
    assert.ok(result.page.bounds.width > 1700);
    assert.ok(
      Math.max(result.rectified.width, result.rectified.height) <= 2401,
    );
    assert.ok(result.markers.every((p) => p.width > 90));
    assert.deepEqual(result.warnings, []);
  });

  it("keeps caller pixels intact through the worker proxy and restores structured errors", async () => {
    const previous = globalThis.Worker;
    const urls = [];
    globalThis.Worker = class {
      constructor(url) {
        urls.push(url);
      }
      postMessage(request, transfer) {
        const copied = structuredClone(request, { transfer });
        void handleWorkerRequest(copied).then((response) =>
          this.onmessage({ data: structuredClone(response) }),
        );
      }
      terminate() {}
    };
    try {
      const sheet = printedSheet();
      const config = {
        aspectRatio: 2 / 3,
        worker: { enabled: true, url: "test-rectify-worker-a.js" },
      };
      const original = sheet.pixels.slice();
      const result = await new OMR(layout, config).rectify(
        sheet.pixels,
        sheet.width,
        sheet.height,
      );
      assert.equal(result.markers.length, 4);
      assert.deepEqual(sheet.pixels, original);
      const missing = photograph(printedSheet({ missing: true }), {
        perspective: false,
      });
      await assert.rejects(
        new OMR(layout, {
          ...config,
          worker: { enabled: true, url: "test-rectify-worker-b.js" },
        }).rectify(missing.pixels, missing.width, missing.height),
        (e) =>
          e instanceof RectificationError && e.stage === "markers" && !!e.page,
      );
      assert.deepEqual(urls, [
        "test-rectify-worker-a.js",
        "test-rectify-worker-b.js",
      ]);
    } finally {
      globalThis.Worker = previous;
    }
  });

  it("preserves a stage and page crop when markers are missing", async () => {
    const photo = photograph(printedSheet({ missing: true }), {
      perspective: false,
    });
    await assert.rejects(
      rectify(photo.pixels, photo.width, photo.height, layout, {
        aspectRatio: 2 / 3,
      }),
      (error) =>
        error instanceof RectificationError &&
        error.stage === "markers" &&
        !!error.page,
    );
  });

  it("rejects invalid inputs and configuration before processing", async () => {
    const sheet = printedSheet();
    await assert.rejects(
      rectify(sheet.pixels, 320, 440, layout, {}),
      /aspectRatio/,
    );
    await assert.rejects(
      rectify(sheet.pixels, 319, 440, layout, { aspectRatio: 2 / 3 }),
      /RGBA/,
    );
    await assert.rejects(
      rectify(
        sheet.pixels,
        320,
        440,
        { ...layout, cornerSize: 0 },
        { aspectRatio: 2 / 3 },
      ),
      /cornerSize/,
    );
    await assert.rejects(
      rectify(
        sheet.pixels,
        320,
        440,
        {
          ...layout,
          answersBlocks: [{ ...layout.answersBlocks[0], rows: 1.5 }],
        },
        { aspectRatio: 2 / 3 },
      ),
      /integer/,
    );
    assert.throws(
      () => resolveConfig({ page: { colorTolerance: NaN } }),
      /colorTolerance/,
    );
    assert.throws(
      () => resolveConfig({ page: { backgroundColor: [-1, 255, 255] } }),
      /backgroundColor/,
    );
    assert.throws(() => resolveConfig({ aspectRatio: 0 }), /aspectRatio/);
    assert.throws(() => resolveConfig({ rotation: 45 }), /rotation/);
    const dark = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 3; i < dark.length; i += 4) dark[i] = 255;
    assert.throws(
      () => detectPage(dark, 100, 100, resolveConfig()),
      (error) => error.stage === "page",
    );
  });

  it("transports rectification results and stage diagnostics through the worker protocol", async () => {
    const photo = photograph(printedSheet(), { perspective: false });
    const request = {
      id: 1,
      operation: "rectify",
      ...photo,
      data: layout,
      config: resolveConfig({ aspectRatio: 2 / 3 }),
    };
    const response = structuredClone(await handleWorkerRequest(request));
    assert.equal(response.ok, true);
    const direct = await rectify(
      photo.pixels,
      photo.width,
      photo.height,
      layout,
      { aspectRatio: 2 / 3 },
    );
    assert.deepEqual(response.result, direct);
    const missing = photograph(printedSheet({ missing: true }), {
      perspective: false,
    });
    const failed = structuredClone(
      await handleWorkerRequest({ ...request, ...missing }),
    );
    assert.equal(failed.ok, false);
    assert.equal(failed.stage, "markers");
    assert.ok(failed.page.image.data instanceof Uint8ClampedArray);
  });
});
