import assert from "node:assert/strict";
import { it } from "node:test";
import { detectGrid } from "../dist/core/grid.js";
import { process, RectificationError, resolveConfig } from "../dist/index.js";
import { handleWorkerRequest } from "../dist/worker/worker.js";
import {
  createSyntheticSheet,
  sampleData,
  sampleMarks,
} from "../example/synthetic.js";

const config = { aspectRatio: 0.75 };
function rotate(sheet) {
  const pixels = new Uint8ClampedArray(sheet.pixels.length);
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const i = (y * sheet.width + x) * 4;
      pixels.set(
        sheet.pixels.subarray(i, i + 4),
        (x * sheet.height + sheet.height - 1 - y) * 4,
      );
    }
  return { pixels, width: sheet.height, height: sheet.width };
}
async function read(sheet, data = sampleData, options = {}) {
  return process(sheet.pixels, sheet.width, sheet.height, data, {
    ...config,
    ...options,
  });
}
const expected = sampleMarks.map((b) =>
  b.map((row) => row.map((col) => "abcde"[col])),
);

it("keeps the camera layout stable across marker resolutions and tone curves", async () => {
  const data = {
    cornerPattern: "bullseye",
    cornerSize: 100,
    answersBlocks: [174, 990].map((startX) => ({
      startX,
      startY: 337.5,
      rows: 20,
      columns: 5,
      width: 50,
      gaps: { columns: 21, rows: 29.75 },
    })),
  };
  const marks = data.answersBlocks.map((block) =>
    Array.from({ length: block.rows }, (_, row) => [row % block.columns]),
  );
  const options = {
    aspectRatio: 0.75,
    page: { backgroundColor: [255, 255, 255], colorTolerance: 0.5 },
    nccThreshold: 0.75,
    fillThreshold: 0.6,
    outputFormat: { type: "number", startAt: 0 },
    debug: true,
  };
  for (const [width, height] of [
    [480, 640],
    [600, 800],
    [1200, 1600],
  ]) {
    const sheet = createSyntheticSheet(width, height, data, marks);
    for (const gamma of [1, 1.8]) {
      const pixels = Uint8ClampedArray.from(sheet.pixels, (value, i) =>
        i % 4 === 3 ? value : 255 * (value / 255) ** gamma,
      );
      const result = await read({ pixels, width, height }, data, options);
      assert.deepEqual(result.answers, marks, `${width}px, gamma ${gamma}`);
      assert.equal(result.debug.cells.flat(2).length, 200);
      assert.ok(Math.abs(result.debug.logicalSize.width / 1600 - 1) < 0.005);
      const response = await handleWorkerRequest({
        id: width,
        pixels,
        width,
        height,
        data,
        config: resolveConfig(options),
      });
      assert.equal(response.ok, true, response.error);
      assert.deepEqual(response.result, result);
    }
  }
});

// User-reported frontend configuration: low-resolution markers used to skew the entire 20-row grid.
const denseData = {
  cornerPattern: "bullseye",
  cornerSize: 100,
  answersBlocks: [178, 1370].map((startX) => ({
    startX,
    startY: 388,
    rows: 20,
    columns: 5,
    width: 81,
    gaps: { columns: 36, rows: 54 },
  })),
};
it("reads the user's generated 200-cell layout at preview resolution and at a larger size", async () => {
  const marks = denseData.answersBlocks.map((block) =>
    Array.from({ length: block.rows }, (_, row) => [row % block.columns]),
  );
  const expected = marks.map((block) =>
    block.map((row) => row.map((col) => "abcde"[col])),
  );
  for (const [width, height, shape] of [
    [600, 800, "circle"],
    [600, 800, "rectangle"],
    [1200, 1600, "circle"],
  ]) {
    const sheet = createSyntheticSheet(width, height, denseData, marks, {
      shape,
    });
    const result = await read(sheet, denseData, { debug: true });
    assert.deepEqual(result.answers, expected, `${width}px ${shape}`);
    assert.equal(result.debug.cells.flat(2).length, 200);
    assert.ok(
      result.debug.scaleFactor < 1,
      "the reported layout must exercise the output cap",
    );
    const expectedFrame = (388 + 19 * 135 + 81 + 100) * 0.75;
    assert.ok(
      Math.abs(result.debug.logicalSize.width / expectedFrame - 1) < 0.005,
    );
    const response = structuredClone(
      await handleWorkerRequest({
        id: width,
        pixels: sheet.pixels,
        width,
        height,
        data: denseData,
        config: resolveConfig(config),
      }),
    );
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(response.result.answers, expected);
  }
});

it("recognizes all four orientations from original pixels, with worker parity", async () => {
  let sheet = createSyntheticSheet(600, 800);
  for (const turn of [0, 90, 180, 270]) {
    const result = await read(sheet, sampleData, { debug: true });
    assert.deepEqual(result.answers, expected);
    assert.equal(result.debug.orientation.appliedRotation, (360 - turn) % 360);
    assert.equal(result.debug.orientation.candidates.length, 4);
    const response = await handleWorkerRequest({
      id: turn,
      pixels: sheet.pixels,
      width: sheet.width,
      height: sheet.height,
      data: sampleData,
      config: resolveConfig({ ...config, debug: true }),
    });
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(response.result, result);
    sheet = rotate(sheet);
  }
});

it("validates blank outlines without relying on selected answers", async () => {
  let sheet = createSyntheticSheet(600, 800, sampleData, []);
  for (const turn of [0, 90, 180, 270]) {
    const result = await read(sheet, sampleData, { debug: true });
    assert.ok(result.answers.flat().every((row) => row.length === 0));
    assert.ok(
      result.debug.cells
        .flat(2)
        .every((cell) => cell.status === "blank" && cell.outlineScore >= 0.7),
    );
    assert.equal(result.debug.orientation.appliedRotation, (360 - turn) % 360);
    sheet = rotate(sheet);
  }
});

it("reads rectangular cells, multiple marks, blank rows, numeric outputs, and light pencil under a smooth shadow", async () => {
  const data = {
    ...sampleData,
    answersBlocks: sampleData.answersBlocks.map((b) => ({ ...b, height: 60 })),
  };
  const marks = [
    [[0, 2], [], [4], [1]],
    [[0], [2, 3], [], [4]],
  ];
  const sheet = createSyntheticSheet(800, 1100, data, marks, {
    shape: "rectangle",
    markColor: [185, 185, 185],
  });
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const shade = 0.6 + (0.4 * x) / sheet.width;
      for (let c = 0; c < 3; c++)
        sheet.pixels[(y * sheet.width + x) * 4 + c] *= shade;
    }
  const result = await read(sheet, data, {
    outputFormat: { type: "number", startAt: 0 },
    page: { colorTolerance: 0.45 },
    debug: true,
  });
  assert.deepEqual(result.answers, marks);
  assert.deepEqual(result.warnings, []);
  assert.ok(
    result.debug.cells.flat(2).some((cell) => cell.shape === "rectangle"),
  );
  for (const cell of result.debug.cells.flat(2)) {
    const i =
      (cell.y * result.debug.gridImage.width +
        Math.floor(cell.x + cell.width / 2)) *
      4;
    assert.deepEqual(
      [...result.debug.gridImage.data.slice(i, i + 3)],
      cell.status === "marked" ? [0, 190, 90] : [0, 160, 255],
    );
  }
  assert.equal(sheet.pixels.byteLength, sheet.width * sheet.height * 4);
});

it("reports uncertain partial marks without silently selecting them", async () => {
  const sheet = createSyntheticSheet(800, 1100, sampleData, sampleMarks, {
    markWidth: 0.24,
  });
  const result = await read(sheet, sampleData, { debug: true });
  const compact = await read(sheet);
  assert.deepEqual(compact.answers, result.answers);
  assert.deepEqual(compact.warnings, result.warnings);
  assert.equal(compact.debug, undefined);
  assert.ok(
    result.debug.cells.flat(2).some((cell) => cell.status === "uncertain"),
  );
  assert.ok(result.warnings.some((w) => w.includes("uncertain")));
  for (const [bi, block] of result.debug.cells.entries())
    for (const [ri, row] of block.entries())
      assert.deepEqual(
        result.answers[bi][ri],
        row.flatMap((c, col) => (c.status === "marked" ? ["abcde"[col]] : [])),
      );
});

it("requires explicit orientation for a symmetric blank layout", async () => {
  const data = {
    cornerSize: 100,
    answersBlocks: [
      {
        startX: 660,
        startY: (1600 / 0.75 - 380) / 2,
        rows: 4,
        columns: 3,
        width: 80,
        gaps: { columns: 20, rows: 20 },
      },
    ],
  };
  const sheet = createSyntheticSheet(800, 1100, data, []);
  await assert.rejects(
    read(sheet, data),
    (e) => e instanceof RectificationError && e.stage === "orientation",
  );
  const result = await read(sheet, data, {
    orientation: "none",
    rotation: 180,
    debug: true,
  });
  assert.equal(result.debug.orientation.appliedRotation, 180);
  assert.ok(result.answers.flat().every((row) => row.length === 0));
});

it("rejects wrong dimensions, counts, spacing, missing cells, and missing geometry on both execution paths", async () => {
  const sheet = createSyntheticSheet(600, 800);
  for (const patch of [
    { rows: 5 },
    { rows: 3 },
    { columns: 4 },
    { width: 50 },
    { gaps: { rows: 30, columns: 20 } },
  ]) {
    const data = {
      ...sampleData,
      answersBlocks: sampleData.answersBlocks.map((b) => ({ ...b, ...patch })),
    };
    await assert.rejects(read(sheet, data), (e) => e.stage === "grid");
  }
  const response = await handleWorkerRequest({
    id: 1,
    pixels: sheet.pixels,
    width: sheet.width,
    height: sheet.height,
    data: { ...sampleData, answersBlocks: [] },
    config: resolveConfig(config),
  });
  assert.equal(response.ok, false);
  assert.equal(response.stage, "grid");
  assert.ok(response.page);
  await assert.rejects(
    read(sheet, sampleData, { aspectRatio: undefined }),
    (e) => e.stage === "input",
  );
  await assert.rejects(
    read(sheet, sampleData, { aspectRatio: 1e100 }),
    (e) => e.stage === "warp",
  );
  assert.throws(() => resolveConfig({ fillThreshold: NaN }));
  const pixels = new Uint8ClampedArray(sheet.pixels.length).fill(255);
  await assert.rejects(read({ ...sheet, pixels }), (e) =>
    ["page", "markers"].includes(e.stage),
  );
});

it("accepts small block alignment corrections and rejects ink without cell outlines", () => {
  const width = 220,
    height = 160,
    pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const data = {
    cornerSize: 30,
    answersBlocks: [
      {
        startX: 40,
        startY: 40,
        rows: 2,
        columns: 3,
        width: 24,
        gaps: { columns: 20, rows: 20 },
      },
    ],
  };
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const x0 = 43 + col * 44,
        y0 = 42 + row * 44;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++)
          if (x < 2 || y < 2 || x >= 22 || y >= 22)
            pixels.set([0, 0, 0, 255], ((y0 + y) * width + x0 + x) * 4);
    }
  const result = detectGrid({ data: pixels, width, height }, data, 1);
  assert.equal(result.cells[0][0][0].x, 43);
  assert.equal(result.cells[0][0][0].y, 42);
  pixels.fill(255);
  assert.throws(
    () => detectGrid({ data: pixels, width, height }, data, 1),
    /outline/,
  );
});

it("returns compact results by default and debug diagnostics on demand through an isolated worker", async () => {
  const { Worker } = await import("node:worker_threads");
  const { once } = await import("node:events");
  const worker = new Worker(new URL("./worker-thread.js", import.meta.url));
  const sheet = createSyntheticSheet(600, 800);
  const request = {
    id: 1,
    operation: "process",
    pixels: sheet.pixels,
    width: sheet.width,
    height: sheet.height,
    data: sampleData,
    config: resolveConfig({ ...config, debug: true }),
  };
  try {
    for (const debug of [undefined, false, true]) {
      const options = debug === undefined ? {} : { debug };
      const main = await read(sheet, sampleData, options);
      assert.deepEqual(main.answers, expected);
      assert.deepEqual(
        Object.keys(main).sort(),
        debug ? ["answers", "debug", "warnings"] : ["answers", "warnings"],
      );
      if (debug) {
        assert.equal(main.debug.cells.flat(2).length, 40);
        assert.equal(main.debug.orientation.candidates.length, 4);
        assert.equal(main.debug.markers.length, 4);
      }
      const message = once(worker, "message");
      worker.postMessage({
        ...request,
        config: resolveConfig({ ...config, ...options }),
      });
      const [response] = await message;
      assert.equal(response.ok, true, response.error);
      assert.deepEqual(response.result, main);
      assert.equal(sheet.pixels.length, sheet.width * sheet.height * 4);
    }
    const failure = once(worker, "message");
    worker.postMessage({
      ...request,
      id: 2,
      config: resolveConfig(config),
      data: { ...sampleData, answersBlocks: [] },
    });
    const [error] = await failure;
    assert.equal(error.ok, false);
    assert.equal(error.stage, "grid");
    assert.ok(error.page);
    assert.equal(error.inspection.markers.length, 4);
    assert.ok(error.inspection.rectified.data instanceof Uint8ClampedArray);
  } finally {
    await worker.terminate();
  }
});
