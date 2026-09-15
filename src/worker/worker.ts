import type { ResolvedConfig } from "../config.js";
import { runPipeline } from "../core/pipeline.js";
import type { Data } from "../data.js";

export type WorkerRequest = {
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  data: Data;
  config: ResolvedConfig;
};

export type WorkerResponse =
  | { id: number; ok: true; result: Awaited<ReturnType<typeof runPipeline>> }
  | { id: number; ok: false; error: string };

declare const self: WorkerGlobalScope & typeof globalThis;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, pixels, width, height, data, config } = event.data;
  try {
    const result = await runPipeline(pixels, width, height, data, config);
    const response: WorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
