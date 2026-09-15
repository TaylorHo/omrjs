import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOtsuThreshold } from "../dist/core/preprocess.js";
import { buildIntegral, rectSum } from "../dist/math/integral.js";
import {
  applyHomographyInverse,
  computeHomography,
  invert3x3,
} from "../dist/math/matrix.js";

describe("integral", () => {
  it("computes rectangle sums", () => {
    const w = 4;
    const img = new Float32Array([1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
    const sat = buildIntegral(img, w, 3);
    assert.equal(rectSum(sat, 1, 1, 3, 2, w), 0);
    assert.equal(rectSum(sat, 0, 0, 4, 3, w), 10);
  });
});

describe("homography", () => {
  it("maps source corners to destination", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const H = computeHomography(src, dst);
    const Hinv = invert3x3(H);
    assert.ok(Hinv);
    const mapped = applyHomographyInverse(Hinv, 25, 50);
    assert.ok(Math.abs(mapped.x - 50) < 1);
    assert.ok(Math.abs(mapped.y - 100) < 1);
  });
});

describe("otsu", () => {
  it("separates bimodal grayscale", () => {
    const gray = new Float32Array(200);
    for (let i = 0; i < 100; i++) gray[i] = 0.1;
    for (let i = 100; i < 200; i++) gray[i] = 0.9;
    const t = computeOtsuThreshold(gray);
    assert.ok(t > 0 && t < 0.5);
  });
});
