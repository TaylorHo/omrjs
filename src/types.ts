export type Corner = { x: number; y: number; size: number };

export type RasterImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};
export type Point = { x: number; y: number };
export type DetectedPage = {
  /** Coordinates in the original input image. */
  bounds: { x: number; y: number; width: number; height: number };
  outline: Point[];
  image: RasterImage;
};
export type Marker = Corner & { width: number; height: number; score: number };
export type RectificationResult = {
  page: DetectedPage;
  /** TL, TR, BR, BL in the page crop, before the requested rotation. */
  markers: [Marker, Marker, Marker, Marker];
  rectified: RasterImage;
  /** Marker-center frame in layout units, before pixel rounding and the output cap. */
  logicalSize: { width: number; height: number };
  /** Configured cell bounds, not detected cells or recognized answers. */
  gridImage: RasterImage;
  /** Normally 1: the full reference width is normalized to cornerSize pixels. Lower only at the output resolution cap. */
  scaleFactor: number;
  rotation: 0 | 90 | 180 | 270;
  warnings: string[];
};

export class RectificationError extends Error {
  constructor(
    public readonly stage: "input" | "page" | "markers" | "warp",
    message: string,
    public readonly page?: DetectedPage,
  ) {
    super(message);
    this.name = "RectificationError";
  }
}

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
