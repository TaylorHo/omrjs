import type { AdvancedConfig, ProcessConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import { runPipeline } from "./core/pipeline.js";
import type { Data } from "./data.js";
import type { Result } from "./types.js";
import { processInWorker } from "./worker/proxy.js";

export type {
  AdvancedConfig,
  ProcessConfig,
  ResolvedConfig,
} from "./config.js";
export { DEFAULT_CONFIG, resolveConfig } from "./config.js";
export type { Data, ImageMarker } from "./data.js";
export type { Answer, Corner, Result } from "./types.js";

export class OMR {
  private readonly data: Data;
  private readonly config: ReturnType<typeof resolveConfig>;

  constructor(data: Data, config?: ProcessConfig | AdvancedConfig) {
    this.data = data;
    this.config = resolveConfig(config);
  }

  async process(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<Result> {
    if (this.config.worker.enabled) {
      return processInWorker(pixels, width, height, this.data, this.config);
    }
    return runPipeline(pixels, width, height, this.data, this.config);
  }
}

export async function process(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config?: ProcessConfig | AdvancedConfig,
): Promise<Result> {
  const resolved = resolveConfig(config);
  if (resolved.worker.enabled) {
    return processInWorker(pixels, width, height, data, resolved);
  }
  return runPipeline(pixels, width, height, data, resolved);
}
