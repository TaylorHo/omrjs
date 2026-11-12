import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import {
  RectificationError,
  type RectificationResult,
  type Result,
} from "../types.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

const workers = new Map<string, Worker>();
let nextId = 0;
const pending = new Map<
  number,
  {
    url: string;
    resolve: (value: Result | RectificationResult) => void;
    reject: (reason: Error) => void;
  }
>();

function getWorker(url: string): Worker {
  let worker = workers.get(url);
  if (!worker) {
    worker = new Worker(url, { type: "module" });
    workers.set(url, worker);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const handler = pending.get(msg.id);
      if (!handler || handler.url !== url) return;
      pending.delete(msg.id);
      if (msg.ok) handler.resolve(msg.result);
      else
        handler.reject(
          msg.stage
            ? new RectificationError(
                msg.stage,
                msg.error,
                msg.page,
                msg.inspection,
              )
            : new Error(msg.error),
        );
    };
    const fail = (message: string) => {
      for (const [id, handler] of pending) {
        if (handler.url !== url) continue;
        pending.delete(id);
        handler.reject(new Error(message));
      }
      workers.get(url)?.terminate();
      workers.delete(url);
    };
    worker.onerror = (event) => fail(event.message || "Worker failed");
    worker.onmessageerror = () => fail("Could not decode worker response");
  }
  return worker;
}

function dispatch(
  operation: "process" | "rectify",
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
) {
  if (!config.worker.enabled)
    throw new Error("Worker is not enabled in config");
  const id = nextId++;
  const url = config.worker.url;
  const worker = getWorker(url);
  // The caller retains its pixels for inspection and repeated processing.
  const copy = new Uint8ClampedArray(pixels);
  return new Promise<Result | RectificationResult>((resolve, reject) => {
    pending.set(id, { url, resolve, reject });
    const request: WorkerRequest = {
      id,
      operation,
      pixels: copy,
      width,
      height,
      data,
      config,
    };
    try {
      worker.postMessage(request, [copy.buffer]);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export function processInWorker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<Result> {
  return dispatch(
    "process",
    pixels,
    width,
    height,
    data,
    config,
  ) as Promise<Result>;
}

export function rectifyInWorker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<RectificationResult> {
  return dispatch(
    "rectify",
    pixels,
    width,
    height,
    data,
    config,
  ) as Promise<RectificationResult>;
}
