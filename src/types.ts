export type Corner = { x: number; y: number; size: number };

/**
 * A single matched alternative value.
 * - letter mode: 'a' | 'b' | 'c' | ...
 * - number mode: 1 | 2 | 3 | ... (or 0-based if configured)
 */
export type Answer = string | number;

/**
 * result.answers[blockIndex][rowIndex] = Answer[]
 *
 * Each inner array holds all checked alternatives for that question row.
 * Mirrors the shape of answersBlocks[] 1-to-1.
 */
export type Result = {
  answers: Answer[][][];
  orientation?: {
    /** Total rotation applied to the input (0, 90, 180, or 270 degrees clockwise). */
    appliedRotation: 0 | 90 | 180 | 270;
    /** True when a 180° flip was needed because the first attempt found no answers. */
    autoFlipped: boolean;
  };
  debug?: {
    corners: Corner[];
    scaleFactor: number;
    preprocessed?: Float32Array;
    gridImage?: {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    };
  };
};

export type PreprocessedImage = {
  gray: Float32Array;
  binary: Uint8Array;
  width: number;
  height: number;
};

export type DetectedCorners = {
  corners: [Corner, Corner, Corner, Corner];
  scaleFactor: number;
};
