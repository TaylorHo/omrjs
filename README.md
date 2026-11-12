# omrjs

Answer sheet parsing and data extraction using Optical Mark Recognition (OMR) in pure JavaScript. Works in the browser and in Node.js, with no native dependencies.

## Install

```bash
npm install omrjs
```

## Quick start

Define your sheet layout, set the marker-frame aspect ratio, and pass RGBA image pixels:

```js
import { OMR } from "omrjs";

const data = {
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 172,
      startY: 336,
      rows: 20,
      columns: 5,
      width: 50,
      gaps: { columns: 21, rows: 30 },
    },
    {
      startX: 990,
      startY: 336,
      rows: 20,
      columns: 5,
      width: 50,
      gaps: { columns: 21, rows: 30 },
    },
  ],
};

const omr = new OMR(data, { aspectRatio: 0.75 });

const result = await omr.process(imagePixels, imageWidth, imageHeight);
// result.answers[blockIndex][rowIndex] → checked values for that row
```

Print four [bullseye markers](https://github.com/TaylorHo/omrjs/blob/main/marker.png) and circular or rectangular cell outlines, including blank cells. The layout above matches the JPEGs in `example/example-images/`; adjust it for your sheet. `aspectRatio` is the width / height **between marker centers**, not page edges.

`result.answers[blockIndex][rowIndex]` contains all marked alternatives. Blank and uncertain cells are excluded; check `result.warnings` for required review. Set `debug: true` for measurements and images under `result.debug`.

For geometry only, use `await omr.rectify(pixels, width, height)`; it returns the cropped page, markers, rectified image, and configured grid overlay without reading answers.

## Configuration reference

The first argument to `OMR` (or the `data` argument to `process()`) describes the physical sheet layout. The second argument supplies `aspectRatio` and optional processing settings.

### Sheet layout (`Data`)

All distances use `cornerSize` units. Block positions start at the rectified top-left marker center.

| Option          | Required | Default      | Description                                                                                                                                |
| --------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cornerSize`    | yes      | —            | Full reference-image width, including white margins. Keep layout values unchanged when resizing the same sheet.                            |
| `cornerPattern` | no       | `"bullseye"` | Corner marker used to locate and warp the sheet. Use `"bullseye"` for the built-in pattern, or an `ImageMarker` object for a custom image. |
| `answersBlocks` | yes      | —            | Array of answer regions on the sheet. Each block is a grid of bubbles to read.                                                             |

Each entry in `answersBlocks`:

| Option         | Required | Default | Description                                                           |
| -------------- | -------- | ------- | --------------------------------------------------------------------- |
| `startX`       | yes      | —       | Horizontal offset of the block's top-left bubble, in layout units.    |
| `startY`       | yes      | —       | Vertical offset of the block's top-left bubble, in layout units.      |
| `rows`         | yes      | —       | Number of question rows in the block.                                 |
| `columns`      | yes      | —       | Number of alternatives (bubbles) per row.                             |
| `width`        | yes      | —       | Width of each bubble, in layout units.                                |
| `height`       | no       | `width` | Height of each bubble. Omit for square bubbles.                       |
| `gaps.columns` | yes      | —       | Horizontal gap between bubble borders (not centers), in layout units. |
| `gaps.rows`    | yes      | —       | Vertical gap between bubble borders, in layout units.                 |

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

Pass as the second argument to `OMR` or the fifth argument to `process()`:

| Option                 | Default              | Description                                                                                                                                                                         |
| ---------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aspectRatio`          | required             | Width / height between marker centers. Required by `process()` and `rectify()`.                                                                                                     |
| `page.backgroundColor` | `[255, 255, 255]`    | Page RGB color used for cropping.                                                                                                                                                   |
| `page.colorTolerance`  | `0.15`               | Page-color similarity tolerance (0–1).                                                                                                                                              |
| `rotation`             | `0`                  | Clockwise rotation: `0`, `90`, `180`, or `270`. Used by `rectify()` or manual orientation.                                                                                          |
| `nccThreshold`         | `0.5`                | Minimum marker correlation score (0–1).                                                                                                                                             |
| `fillThreshold`        | `0.5`                | Interior ink coverage after letter compensation. Cells within ±0.1 of this threshold are uncertain.                                                                                 |
| `outputFormat`         | `{ type: "letter" }` | Shape of values in `result.answers`. `"letter"` returns `"a"`, `"b"`, `"c"`, … per column. `"number"` returns `1`, `2`, `3`, … with optional `startAt: 0` for zero-based numbering. |
| `debug`                | `false`              | Include cell measurements, orientation decisions, markers, and inspection images in `result.debug`.                                                                                 |
| `orientation`          | `"auto"`             | Match the printed grid at all four quarter turns. Use `"none"` with `rotation` for symmetric layouts. `"portrait"` and `"landscape"` remain aliases for auto.                       |

### Web Worker

Offload processing to a background thread in the browser:

| Option           | Default | Description                                                                                                                                                                                                            |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker.enabled` | `false` | When `true`, runs the pipeline inside a Web Worker instead of the main thread.                                                                                                                                         |
| `worker.url`     | —       | URL to a worker script the browser can load. Required when `worker.enabled` is `true`. The package exports a ready-made worker at `omrjs/worker` — resolve it through your bundler (e.g. Vite's `?worker&url` import). |

### Full example

```js
import { OMR } from "omrjs";
import workerUrl from "omrjs/worker?worker&url"; // Vite; see example/ for setup

const data = {
  cornerSize: 100,
  answersBlocks: [
    {
      startX: 172,
      startY: 336,
      rows: 20,
      columns: 5,
      width: 50,
      gaps: { columns: 21, rows: 30 },
    },
    {
      startX: 990,
      startY: 336,
      rows: 20,
      columns: 5,
      width: 50,
      gaps: { columns: 21, rows: 30 },
    },
  ],
};

const config = {
  aspectRatio: 0.75,
  nccThreshold: 0.5,
  fillThreshold: 0.5,
  outputFormat: { type: "number", startAt: 1 },
  debug: true,
  orientation: "auto",
  worker: {
    enabled: true,
    url: workerUrl,
  },
};

const omr = new OMR(data, config);
const result = await omr.process(imagePixels, imageWidth, imageHeight);

// result.answers[blockIndex][rowIndex] → Answer[]
// result.debug?.orientation.appliedRotation → 0 | 90 | 180 | 270
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

1. Set the sheet layout, page color, and marker-frame aspect ratio.
2. Click **Upload Image** to preview your sheet, then **Process sheet**.
3. Use **Inspect stage** to view the uploaded image, markers, rectified page, or extracted-answer overlay.
4. Adjust blocks visually: configured bounds remain visible on failures and update as you edit. Process again to validate.

JSON output stays compact unless **Debug measurements in JSON output** is checked. Layout and settings are saved between sessions.

## Development

```bash
npm test       # run tests
npm run build  # compile TypeScript to dist/
npm run format # format code
```

## License

[MIT](https://github.com/TaylorHo/omrjs/blob/main/LICENSE)
