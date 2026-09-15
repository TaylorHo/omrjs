# omrjs

Answer sheet parsing and data extraction using Optical Mark Recognition (OMR) in pure JavaScript. Works in the browser and in Node.js, with no native dependencies.

## Install

```bash
npm install omrjs
```

## Quick start

Define your sheet layout, pass image pixels, and read the marked answers. All processing options use library defaults:

```js
import { OMR } from "omrjs";

const data = {
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 200,
      startY: 300,
      rows: 10,
      columns: 5,
      width: 80,
      gaps: { columns: 20, rows: 15 },
    },
  ],
};

const omr = new OMR(data);

const result = await omr.process(imagePixels, imageWidth, imageHeight);
// result.answers[blockIndex][rowIndex] → checked values for that row
```

With this default configuration, the algorithm will search for the [bullseye markers](https://github.com/TaylorHo/omrjs/blob/main/marker.png) in the four corners of the document. Make sure to add this marker to your document, or use a different one (see below for more information about how to set this up).

## Configuration reference

The first argument to `OMR` (or the `data` argument to `process()`) describes the physical sheet layout. The optional second argument tunes detection and output behavior.

### Sheet layout (`Data`)

All layout distances are expressed in the same unit system, scaled by `cornerSize`.

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `cornerSize` | yes | — | Reference unit for the sheet. Every other distance (`startX`, `width`, gaps, etc.) is relative to this value. If `cornerSize` is `100` and a bubble `width` is `80`, the bubble is 80% of the corner marker width. |
| `cornerPattern` | no | `"bullseye"` | Corner marker used to locate and warp the sheet. Use `"bullseye"` for the built-in pattern, or an `ImageMarker` object for a custom image. |
| `answersBlocks` | yes | — | Array of answer regions on the sheet. Each block is a grid of bubbles to read. |

Each entry in `answersBlocks`:

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `startX` | yes | — | Horizontal offset of the block's top-left bubble, in layout units. |
| `startY` | yes | — | Vertical offset of the block's top-left bubble, in layout units. |
| `rows` | yes | — | Number of question rows in the block. |
| `columns` | yes | — | Number of alternatives (bubbles) per row. |
| `width` | yes | — | Width of each bubble, in layout units. |
| `height` | no | `width` | Height of each bubble. Omit for square bubbles. |
| `gaps.columns` | yes | — | Horizontal gap between bubble borders (not centers), in layout units. |
| `gaps.rows` | yes | — | Vertical gap between bubble borders, in layout units. |

Custom corner marker (`ImageMarker`):

```js
cornerPattern: {
  type: "image",
  pixels, // Uint8ClampedArray — RGBA, same format as ImageData.data
  width,
  height,
}
```

### Processing options (`ProcessConfig`)

Pass as the second argument to `OMR` or `process()`:

| Option | Default | Description |
| --- | --- | --- |
| `nccThreshold` | `0.5` | Normalized cross-correlation score (0–1) required to accept a corner match. Lower values are more permissive; higher values reduce false positives on noisy scans. |
| `fillThreshold` | `0.5` | Ink fill ratio (0–1) above which a bubble is considered marked. Lower values detect lighter marks; higher values require darker fills. |
| `outputFormat` | `{ type: "letter" }` | Shape of values in `result.answers`. `"letter"` returns `"a"`, `"b"`, `"c"`, … per column. `"number"` returns `1`, `2`, `3`, … with optional `startAt: 0` for zero-based numbering. |
| `debug` | `false` | When `true`, includes `result.debug` with detected corners, scale factor, and a rendered grid overlay image. |
| `orientation` | `"portrait"` | Expected sheet orientation. `"portrait"` auto-rotates landscape photos to upright A4 and retries with a 180° flip when no answers are found. `"landscape"` skips the portrait correction. `"none"` disables all automatic rotation. |

### Advanced processing (`improvements`)

Nested under the config object for fine-grained image pipeline control:

| Option | Default | Description |
| --- | --- | --- |
| `improvements.grayscale` | `"luminance"` | Method used to convert the input to grayscale before thresholding. `"luminance"` uses weighted RGB channels; `"average"` uses a simple mean. |
| `improvements.exposureGamma` | `2.2` | Gamma correction applied to brighten underexposed scans before binarization. |
| `improvements.detectionScales` | `[0.5, 1, 1.5, 2]` | Template scales tried when searching for corner markers. Wider ranges help with scans at unexpected resolutions. |
| `improvements.cornerSearchMargin` | `0.2` | Fraction of image width/height used as the search window when locating corners 2–4 (after the first corner is found). |

### Web Worker

Offload processing to a background thread in the browser:

| Option | Default | Description |
| --- | --- | --- |
| `worker.enabled` | `false` | When `true`, runs the pipeline inside a Web Worker instead of the main thread. |
| `worker.url` | — | URL to a worker script the browser can load. Required when `worker.enabled` is `true`. The package exports a ready-made worker at `omrjs/worker` — resolve it through your bundler (e.g. Vite's `?worker&url` import). |

### Full example

```js
import { OMR } from "omrjs";
import workerUrl from "omrjs/worker?worker&url"; // Vite; see example/ for setup

const data = {
  cornerPattern: "bullseye",
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 200,
      startY: 300,
      rows: 10,
      columns: 5,
      width: 80,
      height: 80,
      gaps: { columns: 20, rows: 15 },
    },
  ],
};

const config = {
  nccThreshold: 0.5,
  fillThreshold: 0.5,
  outputFormat: { type: "number", startAt: 1 },
  debug: true,
  orientation: "portrait",
  improvements: {
    grayscale: "luminance",
    exposureGamma: 2.2,
    detectionScales: [0.5, 1, 1.5, 2],
    cornerSearchMargin: 0.2,
  },
  worker: {
    enabled: true,
    url: workerUrl,
  },
};

const omr = new OMR(data, config);
const result = await omr.process(imagePixels, imageWidth, imageHeight);

// result.answers[blockIndex][rowIndex] → Answer[]
// result.orientation?.appliedRotation → 0 | 90 | 180 | 270
// result.debug?.corners → detected corner positions (when debug: true)
```

## Example app

The `example/` folder is a browser demo for trying layouts and tuning detection settings.

```bash
git clone https://github.com/TaylorHo/omrjs.git
cd omrjs
npm install
npm run example
```

This builds the library and starts a Vite dev server (opens at `http://localhost:5173`).

In the demo:

1. Adjust the **sheet layout** — corner size, answer blocks, gaps, and corner pattern.
2. Load a sheet image with **Upload image**, or click **Generate sample** to create a synthetic sheet.
3. Tune **detection settings** (thresholds, orientation, debug mode) as needed.
4. Click **Process sheet** to run OMR and inspect the JSON results. Enable debug mode to see detected corners and the answer grid.

Layout and config are saved in the browser's local storage between sessions.

## Development

```bash
npm test       # run tests
npm run build  # compile TypeScript to dist/
npm run format # format code
```

## License

[MIT](https://github.com/TaylorHo/omrjs/blob/main/LICENSE)
