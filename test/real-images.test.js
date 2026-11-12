import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import jpeg from "jpeg-js";
import { connectedComponents } from "../dist/core/components.js";
import { process, resolveConfig } from "../dist/index.js";
import { handleWorkerRequest } from "../dist/worker/worker.js";

// The user's configuration is deliberately shared by all three original JPEGs.
const data = {
  cornerPattern: "bullseye",
  cornerSize: 100,
  answersBlocks: [172, 990].map((startX) => ({
    startX,
    startY: 336,
    rows: 20,
    columns: 5,
    width: 50,
    gaps: { columns: 21, rows: 30 },
  })),
};
const config = resolveConfig({
  page: { backgroundColor: [255, 255, 255], colorTolerance: 0.15 },
  aspectRatio: 0.75,
  rotation: 0,
  nccThreshold: 0.5,
  worker: { enabled: true, url: "./worker-entry.js" },
});

it("retains geometry diagnostics when rejecting an incompatible saved layout", async () => {
  const decoded = jpeg.decode(
    readFileSync(
      new URL("../example/example-images/answers-sheet-0.jpg", import.meta.url),
    ),
    { useTArray: true },
  );
  const wrongData = {
    ...data,
    answersBlocks: [178, 1370].map((startX) => ({
      startX,
      startY: 388,
      rows: 20,
      columns: 5,
      width: 81,
      gaps: { columns: 36, rows: 54 },
    })),
  };
  const pixels = new Uint8ClampedArray(decoded.data);
  const request = {
    id: 88,
    pixels,
    width: decoded.width,
    height: decoded.height,
    data: wrongData,
    config: resolveConfig({ aspectRatio: 0.75 }),
  };
  const response = structuredClone(await handleWorkerRequest(request));
  assert.equal(response.ok, false);
  assert.equal(response.stage, "grid");
  assert.match(response.error, /Markers were detected/);
  assert.equal(response.inspection.markers.length, 4);
  assert.ok(response.inspection.rectified.data instanceof Uint8ClampedArray);
  assert.ok(response.inspection.gridImage.width > 0);
  await assert.rejects(
    process(pixels, decoded.width, decoded.height, wrongData, {
      aspectRatio: 0.75,
    }),
    (e) => {
      assert.equal(e.stage, "grid");
      assert.equal(e.inspection.markers.length, 4);
      assert.deepEqual(e.inspection.gridImage, response.inspection.gridImage);
      assert.ok(!e.message.includes("0°:"));
      return true;
    },
  );
});

function cellCenters(result) {
  const { data: pixels, width, height } = result.rectified;
  const scale = result.scaleFactor;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4] < 128 ? 1 : 0;
  const { components } = connectedComponents(mask, width, height);
  const circles = components.filter((c) => {
    const w = (c.x1 - c.x0) / scale,
      h = (c.y1 - c.y0) / scale;
    return w > 35 && w < 75 && h > 35 && h < 75 && c.y0 / scale > 200;
  });
  const centers = [];
  for (const [index, block] of data.answersBlocks.entries()) {
    const cells = circles
      .filter((c) => {
        const x = (c.x0 + c.x1) / 2 / scale;
        return x > (index === 0 ? 50 : 800) && x < (index === 0 ? 700 : 1450);
      })
      .sort((a, b) => a.y0 - b.y0);
    assert.equal(
      cells.length,
      100,
      `block ${index + 1} must retain every bubble outline`,
    );
    for (let row = 0; row < 20; row++) {
      const line = cells
        .slice(row * 5, row * 5 + 5)
        .sort((a, b) => a.x0 - b.x0);
      for (let col = 0; col < 5; col++) {
        const cell = line[col];
        const x = (cell.x0 + cell.x1) / 2 / scale,
          y = (cell.y0 + cell.y1) / 2 / scale;
        assert.ok(
          Math.abs(x - (block.startX + col * 71 + 25)) <= 1.5,
          `block ${index + 1}, row ${row + 1}, column ${col + 1}: x=${x}`,
        );
        assert.ok(
          Math.abs(y - (block.startY + row * 80 + 25)) <= 1.5,
          `block ${index + 1}, row ${row + 1}, column ${col + 1}: y=${y}`,
        );
        centers.push({ x, y });
      }
    }
  }
  return centers;
}

it("aligns all 600 cells in the original, reduced/background, and rotated/warped JPEGs with the user's unchanged configuration", async () => {
  const results = [];
  const centers = [];
  for (const index of [0, 1, 2]) {
    const image = jpeg.decode(
      readFileSync(
        new URL(
          `../example/example-images/answers-sheet-${index}.jpg`,
          import.meta.url,
        ),
      ),
      { useTArray: true, maxResolutionInMP: 25, maxMemoryUsageInMB: 256 },
    );
    const response = await handleWorkerRequest({
      id: index,
      operation: "rectify",
      pixels: new Uint8ClampedArray(image.data),
      width: image.width,
      height: image.height,
      data,
      config,
    });
    assert.equal(response.ok, true, response.error);
    const result = response.result;
    assert.equal(result.rotation, 0);
    assert.equal(result.scaleFactor, 1);
    assert.deepEqual(result.warnings, []);
    results.push(result.logicalSize);
    centers.push(cellCenters(result));
  }
  assert.ok(
    Math.max(...results.map((s) => s.width)) -
      Math.min(...results.map((s) => s.width)) <
      1,
    JSON.stringify(results),
  );
  assert.ok(
    Math.max(...results.map((s) => s.height)) -
      Math.min(...results.map((s) => s.height)) <
      1,
    JSON.stringify(results),
  );
  for (let image = 1; image < centers.length; image++)
    for (let i = 0; i < 200; i++) {
      assert.ok(
        Math.abs(centers[image][i].x - centers[0][i].x) <= 1.5,
        `image ${image}, cell ${i}: x drift`,
      );
      assert.ok(
        Math.abs(centers[image][i].y - centers[0][i].y) <= 1.5,
        `image ${image}, cell ${i}: y drift`,
      );
    }
});

// All three photos show the same independently inspected repeating A–E answer key.
it("reads all 120 real-image answers identically on the main thread and worker protocol", async () => {
  const expected = Array.from({ length: 2 }, () =>
    Array.from({ length: 20 }, (_, row) => ["abcde"[row % 5]]),
  );
  for (const index of [0, 1, 2]) {
    const image = jpeg.decode(
      readFileSync(
        new URL(
          `../example/example-images/answers-sheet-${index}.jpg`,
          import.meta.url,
        ),
      ),
      { useTArray: true },
    );
    const pixels = new Uint8ClampedArray(image.data);
    const result = await process(pixels, image.width, image.height, data, {
      ...config,
      worker: { enabled: false },
    });
    assert.deepEqual(result.answers, expected, `JPEG ${index}`);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(Object.keys(result).sort(), ["answers", "warnings"]);
    const response = await handleWorkerRequest({
      id: index,
      operation: "process",
      pixels,
      width: image.width,
      height: image.height,
      data,
      config,
    });
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(response.result, result);
  }
});
