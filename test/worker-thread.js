// Run the shipped browser-worker entry in a real isolated Node worker for transport checks.
import { parentPort } from "node:worker_threads";

globalThis.self = { postMessage: (message) => parentPort.postMessage(message) };
await import("../dist/worker/worker.js");
parentPort.on("message", (data) => self.onmessage({ data }));
