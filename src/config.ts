/** Simple config — covers the most common tuning needs. */
export type ProcessConfig = {
  /** 0–1 correlation score to accept a corner match. Default: 0.5 */
  nccThreshold?: number;
  /** 0–1 ink fill ratio to mark a cell as checked. Default: 0.5 */
  fillThreshold?: number;
  /**
   * Format for answer values in the result.
   * Default: { type: 'letter' }
   */
  outputFormat?: { type: "letter" } | { type: "number"; startAt?: 0 | 1 };
  /** Return extra info in result.debug. Default: false */
  debug?: boolean;
  /**
   * Expected sheet orientation. Auto-rotates landscape inputs to portrait (A4 upright)
   * and tries a 180° flip when no answers are found. Default: 'portrait'
   */
  orientation?: "portrait" | "landscape" | "none";
};

/** Advanced config — extends ProcessConfig with fine-grained control. */
export type AdvancedConfig = ProcessConfig & {
  improvements?: {
    /** Grayscale conversion method. Default: 'luminance' */
    grayscale?: "luminance" | "average";
    /** Gamma value for exposure brightening. Default: 2.2 */
    exposureGamma?: number;
    /** Template scales tried during corner search. Default: [0.5, 1, 1.5, 2] */
    detectionScales?: number[];
    /** Search window as a fraction of image size when locating corners 2–4. Default: 0.2 */
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
  nccThreshold: number;
  fillThreshold: number;
  outputFormat: { type: "letter" } | { type: "number"; startAt: 0 | 1 };
  debug: boolean;
  orientation: "portrait" | "landscape" | "none";
  grayscale: "luminance" | "average";
  exposureGamma: number;
  detectionScales: number[];
  cornerSearchMargin: number;
  worker: { enabled: false } | { enabled: true; url: string };
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  nccThreshold: 0.5,
  fillThreshold: 0.5,
  outputFormat: { type: "letter" },
  debug: false,
  orientation: "portrait",
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
  return resolved;
}
