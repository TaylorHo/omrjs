/** Simple config — covers the most common tuning needs. */
export type ProcessConfig = {
  /** Page color and normalized RGB distance tolerance (0–1). */
  page?: {
    backgroundColor?: [number, number, number];
    colorTolerance?: number;
  };
  /** Width / height between marker centers. Required by process() and rectify(). */
  aspectRatio?: number;
  /** Clockwise rotation for rectify(), or for process() when orientation is "none". */
  rotation?: 0 | 90 | 180 | 270;
  /** 0–1 correlation score to accept a corner match. Default: 0.5 */
  nccThreshold?: number;
  /** 0–1 letter-compensated interior ink coverage to mark a cell as checked. Default: 0.5 */
  fillThreshold?: number;
  /**
   * Format for answer values in the result.
   * Default: { type: 'letter' }
   */
  outputFormat?: { type: "letter" } | { type: "number"; startAt?: 0 | 1 };
  /** Return extra info in result.debug. Default: false */
  debug?: boolean;
  /**
   * "auto" (default), "portrait", and "landscape" test all four grid orientations.
   * "none" uses only rotation; use it for a symmetric printed layout.
   */
  orientation?: "auto" | "portrait" | "landscape" | "none";
};

/** Advanced config — extends ProcessConfig with fine-grained control. */
export type AdvancedConfig = ProcessConfig & {
  improvements?: {
    /** @deprecated Ignored; geometry and recognition use unbrightened luminance. Previously: 'luminance' */
    grayscale?: "luminance" | "average";
    /** @deprecated Ignored; cell-local contrast replaces exposure brightening. Previously: 2.2 */
    exposureGamma?: number;
    /** @deprecated Ignored by component-based marker detection. */
    detectionScales?: number[];
    /** @deprecated Ignored; markers are searched throughout the page. */
    cornerSearchMargin?: number;
  };
  worker?: {
    /** Offload the full pipeline to a Web Worker. Default: false */
    enabled: boolean;
    /** URL to the standalone worker bundle (required when enabled: true). */
    url: string;
  };
};

export type ResolvedConfig = {
  page: { backgroundColor: [number, number, number]; colorTolerance: number };
  aspectRatio: number | null;
  rotation: 0 | 90 | 180 | 270;
  nccThreshold: number;
  fillThreshold: number;
  outputFormat: { type: "letter" } | { type: "number"; startAt: 0 | 1 };
  debug: boolean;
  orientation: "auto" | "portrait" | "landscape" | "none";
  grayscale: "luminance" | "average";
  exposureGamma: number;
  detectionScales: number[];
  cornerSearchMargin: number;
  worker: { enabled: false } | { enabled: true; url: string };
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  page: { backgroundColor: [255, 255, 255], colorTolerance: 0.15 },
  aspectRatio: null,
  rotation: 0,
  nccThreshold: 0.5,
  fillThreshold: 0.5,
  outputFormat: { type: "letter" },
  debug: false,
  orientation: "auto",
  grayscale: "luminance",
  exposureGamma: 2.2,
  detectionScales: [0.5, 1, 1.5, 2],
  cornerSearchMargin: 0.2,
  worker: { enabled: false },
};

export function resolveConfig(
  config?: ProcessConfig | AdvancedConfig,
): ResolvedConfig {
  const advanced = config as AdvancedConfig | undefined;
  const outputFormat = config?.outputFormat ?? DEFAULT_CONFIG.outputFormat;
  const resolved: ResolvedConfig = {
    page: {
      backgroundColor: [
        ...(config?.page?.backgroundColor ??
          DEFAULT_CONFIG.page.backgroundColor),
      ],
      colorTolerance:
        config?.page?.colorTolerance ?? DEFAULT_CONFIG.page.colorTolerance,
    },
    aspectRatio: config?.aspectRatio ?? null,
    rotation: config?.rotation ?? 0,
    nccThreshold: config?.nccThreshold ?? DEFAULT_CONFIG.nccThreshold,
    fillThreshold: config?.fillThreshold ?? DEFAULT_CONFIG.fillThreshold,
    outputFormat:
      outputFormat.type === "number"
        ? { type: "number", startAt: outputFormat.startAt ?? 1 }
        : { type: "letter" },
    debug: config?.debug ?? DEFAULT_CONFIG.debug,
    orientation: config?.orientation ?? DEFAULT_CONFIG.orientation,
    grayscale: advanced?.improvements?.grayscale ?? DEFAULT_CONFIG.grayscale,
    exposureGamma:
      advanced?.improvements?.exposureGamma ?? DEFAULT_CONFIG.exposureGamma,
    detectionScales:
      advanced?.improvements?.detectionScales ?? DEFAULT_CONFIG.detectionScales,
    cornerSearchMargin:
      advanced?.improvements?.cornerSearchMargin ??
      DEFAULT_CONFIG.cornerSearchMargin,
    worker: advanced?.worker?.enabled
      ? { enabled: true, url: advanced.worker.url }
      : { enabled: false },
  };
  if (
    resolved.page.backgroundColor.length !== 3 ||
    resolved.page.backgroundColor.some(
      (v) => !Number.isFinite(v) || v < 0 || v > 255,
    )
  ) {
    throw new Error(
      "Page backgroundColor must contain three RGB values from 0 to 255",
    );
  }
  for (const [name, value] of [
    ["Page colorTolerance", resolved.page.colorTolerance],
    ["NCC threshold", resolved.nccThreshold],
    ["Fill threshold", resolved.fillThreshold],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`${name} must be between 0 and 1`);
  }
  if (
    resolved.aspectRatio !== null &&
    (!Number.isFinite(resolved.aspectRatio) || resolved.aspectRatio <= 0)
  )
    throw new Error("aspectRatio must be positive and finite");
  if (![0, 90, 180, 270].includes(resolved.rotation))
    throw new Error("rotation must be 0, 90, 180, or 270");
  if (!["auto", "portrait", "landscape", "none"].includes(resolved.orientation))
    throw new Error("orientation must be auto, portrait, landscape, or none");
  if (
    !["letter", "number"].includes(outputFormat.type) ||
    (resolved.outputFormat.type === "number" &&
      ![0, 1].includes(resolved.outputFormat.startAt))
  )
    throw new Error("Invalid output format");
  return resolved;
}
