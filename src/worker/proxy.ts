import type { ResolvedConfig } from "../config.js";
import type { Data } from "../data.js";
import type { Result } from "../types.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: Result) => void; reject: (reason: Error) => void }
>();

function getWorker(url: string): Worker {
  if (!worker) {
    worker = new Worker(url, { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const handler = pending.get(msg.id);
      if (!handler) return;
      pending.delete(msg.id);
      if (msg.ok) {
        handler.resolve(msg.result);
      } else {
        handler.reject(new Error(msg.error));
      }
    };
    worker.onerror = (event) => {
      for (const [, handler] of pending) {
        handler.reject(new Error(event.message));
      }
      pending.clear();
    };
  }
  return worker;
}

export function processInWorker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: Data,
  config: ResolvedConfig,
): Promise<Result> {
  if (!config.worker.enabled) {
    throw new Error("Worker is not enabled in config");
  }

  const id = nextId++;
  const w = getWorker(config.worker.url);

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = {
      id,
      pixels,
      width,
      height,
      data,
      config,
    };
    w.postMessage(request, [pixels.buffer]);
  });
}
