import { runPipeline } from "../dist/core/pipeline.js";

self.onmessage = async (event) => {
  const { id, pixels, width, height, data, config } = event.data;
  try {
    const result = await runPipeline(pixels, width, height, data, config);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
