import type { ResolvedConfig } from "../config.js";
import { runPipeline } from "../core/pipeline.js";
import { runRectification } from "../core/rectify.js";
import type { Data } from "../data.js";
import {
  type DetectedPage,
  RectificationError,
  type RectificationResult,
  type Result,
} from "../types.js";

export type WorkerRequest = {
  id: number;
  operation?: "process" | "rectify";
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  data: Data;
  config: ResolvedConfig;
};

export type WorkerResponse =
  | { id: number; ok: true; result: Result | RectificationResult }
  | {
      id: number;
      ok: false;
      error: string;
      stage?: RectificationError["stage"];
      page?: DetectedPage;
      inspection?: RectificationResult;
    };

export async function handleWorkerRequest(
  request: WorkerRequest,
): Promise<WorkerResponse> {
  const { id, pixels, width, height, data, config } = request;
  try {
    const result =
      request.operation === "rectify"
        ? runRectification(pixels, width, height, data, config)
        : await runPipeline(pixels, width, height, data, config);
    return { id, ok: true, result };
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof RectificationError
        ? {
            stage: error.stage,
            ...(error.page ? { page: error.page } : {}),
            ...(error.inspection ? { inspection: error.inspection } : {}),
          }
        : {}),
    };
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;
if (typeof self !== "undefined") {
  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    self.postMessage(await handleWorkerRequest(event.data));
  };
}
