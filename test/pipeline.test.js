import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { process } from "../dist/index.js";
import { generateBullseyeTemplate } from "../dist/patterns/bullseye.js";
import {
  createSyntheticSheet,
  sampleData,
  templateToImageMarker,
} from "./synthetic.js";

describe("pipeline", () => {
  it("detects marked answers on a synthetic sheet", async () => {
    const marks = [
      [[0], [1], [2], [3]],
      [[1], [1], [1], [1]],
    ];

    const { pixels, width, height } = createSyntheticSheet(
      600,
      800,
      sampleData,
      marks,
    );

    const result = await process(pixels, width, height, sampleData, {
      nccThreshold: 0.4,
      fillThreshold: 0.3,
      outputFormat: { type: "letter" },
    });

    assert.equal(result.answers.length, 2);
    assert.equal(result.answers[0].length, 4);
    assert.deepEqual(result.answers[0][0], ["a"]);
    assert.deepEqual(result.answers[0][1], ["b"]);
    assert.deepEqual(result.answers[0][2], ["c"]);
    assert.deepEqual(result.answers[0][3], ["d"]);
    assert.deepEqual(result.answers[1][0], ["b"]);
    assert.deepEqual(result.answers[1][1], ["b"]);
  });

  it("detects corners with a high-resolution image marker", async () => {
    const marks = [
      [[0], [1], [2], [3]],
      [[1], [1], [1], [1]],
    ];
    const { pixels, width, height } = createSyntheticSheet(
      600,
      800,
      sampleData,
      marks,
    );

    const { template, width: tw, height: th } = generateBullseyeTemplate(31);
    const cornerPattern = templateToImageMarker(template, tw, th, 100);

    const result = await process(
      pixels,
      width,
      height,
      { ...sampleData, cornerPattern },
      {
        nccThreshold: 0.4,
        fillThreshold: 0.3,
        outputFormat: { type: "letter" },
      },
    );

    assert.deepEqual(result.answers[0][0], ["a"]);
    assert.deepEqual(result.answers[0][3], ["d"]);
  });

  it("supports number output format", async () => {
    const marks = [[[2]], [[0]]];
    const { pixels, width, height } = createSyntheticSheet(
      600,
      800,
      sampleData,
      marks,
    );

    const result = await process(pixels, width, height, sampleData, {
      nccThreshold: 0.4,
      fillThreshold: 0.3,
      outputFormat: { type: "number", startAt: 1 },
    });

    assert.deepEqual(result.answers[0][0], [3]);
    assert.deepEqual(result.answers[1][0], [1]);
  });
});
