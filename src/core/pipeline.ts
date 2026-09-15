import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import type { Answer, Result } from "../types.js";
import { analyzeAnswers } from "./analyze.js";
import { renderDebugGrid } from "./debug-render.js";
import { detectCorners } from "./detect.js";
import { preprocess } from "./preprocess.js";
import { warpPerspective } from "./warp.js";

const CHANNELS = 4;

type Rotation = 0 | 90 | 180 | 270;

function hasNoAnswers(answers: Answer[][][]): boolean {
  return answers.every((block) => block.every((row) => row.length === 0));
}

function needsAspectRotation(
  width: number,
  height: number,
  orientation: ResolvedConfig["orientation"],
): boolean {
  if (orientation === "portrait") {
    return width > height;
  }
  if (orientation === "landscape") {
    return height > width;
  }
  return false;
}

function rotateImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  degrees: 90 | 180 | 270,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  if (degrees === 180) {
    const out = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * CHANNELS;
        const dstX = width - 1 - x;
        const dstY = height - 1 - y;
        const dstIdx = (dstY * width + dstX) * CHANNELS;
        out[dstIdx] = pixels[srcIdx]!;
        out[dstIdx + 1] = pixels[srcIdx + 1]!;
        out[dstIdx + 2] = pixels[srcIdx + 2]!;
        out[dstIdx + 3] = pixels[srcIdx + 3]!;
      }
    }
    return { pixels: out, width, height };
  }

  const newWidth = height;
  const newHeight = width;
  const out = new Uint8ClampedArray(newWidth * newHeight * CHANNELS);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * CHANNELS;
      const dstX = degrees === 90 ? height - 1 - y : y;
      const dstY = degrees === 90 ? x : width - 1 - x;
      const dstIdx = (dstY * newWidth + dstX) * CHANNELS;
      out[dstIdx] = pixels[srcIdx]!;
      out[dstIdx + 1] = pixels[srcIdx + 1]!;
      out[dstIdx + 2] = pixels[srcIdx + 2]!;
      out[dstIdx + 3] = pixels[srcIdx + 3]!;
    }
  }

  return { pixels: out, width: newWidth, height: newHeight };
}

function addRotation(current: Rotation, delta: 90 | 180 | 270): Rotation {
  return ((current + delta) % 360) as Rotation;
}

async function runPipelineOnce(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<Result> {
  const preprocessed = await preprocess(pixels, width, height, config);

  const detectionImage = new Float32Array(preprocessed.binary.length);
  for (let i = 0; i < preprocessed.binary.length; i++) {
    detectionImage[i] = preprocessed.binary[i]!;
  }

  const { corners, scaleFactor } = detectCorners(
    detectionImage,
    preprocessed.width,
    preprocessed.height,
    data,
    config,
  );

  const warped = warpPerspective(
    preprocessed.gray,
    preprocessed.width,
    preprocessed.height,
    corners,
  );

  const answers = analyzeAnswers(
    warped.gray,
    warped.width,
    warped.height,
    data,
    scaleFactor,
    config,
  );

  const result: Result = { answers };

  if (config.debug) {
    result.debug = {
      corners: [...corners],
      scaleFactor,
      preprocessed: preprocessed.gray,
      gridImage: renderDebugGrid(
        warped.gray,
        warped.width,
        warped.height,
        data,
        scaleFactor,
        config.fillThreshold,
      ),
    };
  }

  return result;
}

export async function runPipeline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<Result> {
  let currentPixels = pixels;
  let currentWidth = width;
  let currentHeight = height;
  let appliedRotation: Rotation = 0;

  if (needsAspectRotation(currentWidth, currentHeight, config.orientation)) {
    const rotated = rotateImage(currentPixels, currentWidth, currentHeight, 90);
    currentPixels = rotated.pixels;
    currentWidth = rotated.width;
    currentHeight = rotated.height;
    appliedRotation = addRotation(appliedRotation, 90);
  }

  let result = await runPipelineOnce(
    currentPixels,
    currentWidth,
    currentHeight,
    data,
    config,
  );

  let autoFlipped = false;

  if (config.orientation !== "none" && hasNoAnswers(result.answers)) {
    const flipped = rotateImage(
      currentPixels,
      currentWidth,
      currentHeight,
      180,
    );
    const flippedResult = await runPipelineOnce(
      flipped.pixels,
      flipped.width,
      flipped.height,
      data,
      config,
    );

    if (!hasNoAnswers(flippedResult.answers)) {
      result = flippedResult;
      autoFlipped = true;
      appliedRotation = addRotation(appliedRotation, 180);
    }
  }

  if (appliedRotation !== 0 || autoFlipped) {
    result.orientation = { appliedRotation, autoFlipped };
  }

  return result;
}
