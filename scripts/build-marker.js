import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// Decode the repository's non-interlaced RGBA PNG without a runtime image dependency.
const png = readFileSync(new URL("../marker.png", import.meta.url));
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0)
  throw new Error("marker.png must be an 8-bit, non-interlaced RGBA PNG");
const chunks = [];
for (let p = 8; p < png.length; ) {
  const length = png.readUInt32BE(p);
  if (png.toString("ascii", p + 4, p + 8) === "IDAT")
    chunks.push(png.subarray(p + 8, p + 8 + length));
  p += length + 12;
}
const raw = inflateSync(Buffer.concat(chunks));
const stride = width * 4;
if (raw.length !== (stride + 1) * height)
  throw new Error("Invalid marker PNG data");
const pixels = Buffer.alloc(stride * height);
const paeth = (a, b, c) => {
  const p = a + b - c;
  const da = Math.abs(p - a),
    db = Math.abs(p - b),
    dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  if (filter > 4) throw new Error("Unsupported PNG filter");
  for (let x = 0; x < stride; x++) {
    const i = y * stride + x;
    const a = x >= 4 ? pixels[i - 4] : 0;
    const b = y > 0 ? pixels[i - stride] : 0;
    const c = x >= 4 && y > 0 ? pixels[i - stride - 4] : 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
    pixels[i] = raw[y * (stride + 1) + x + 1] + predictor;
  }
}
const size = 65;
const rows = [];
const radii = [];
const center = width / 2;
const grayAt = (x) => {
  const i = (Math.floor(height / 2) * width + x) * 4;
  return (
    1 -
    ((1 -
      (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) /
        255) *
      pixels[i + 3]) /
      255
  );
};
for (let x = Math.floor(center) + 1; x < width; x++) {
  const before = grayAt(x - 1),
    after = grayAt(x);
  if (before < 0.5 !== after < 0.5)
    radii.push((x - 0.5 + (0.5 - before) / (after - before) - center) / width);
}
if (radii.length !== 4)
  throw new Error("Expected four bullseye ring boundaries in marker.png");
let ink = 0,
  inkX = 0,
  inkY = 0;
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const weight =
      ((1 -
        (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) /
          255) *
        pixels[i + 3]) /
      255;
    ink += weight;
    inkX += weight * (x + 0.5);
    inkY += weight * (y + 0.5);
  }
for (let y = 0; y < size; y++) {
  let row = "";
  for (let x = 0; x < size; x++) {
    const i =
      (Math.floor(((y + 0.5) * height) / size) * width +
        Math.floor(((x + 0.5) * width) / size)) *
      4;
    const alpha = pixels[i + 3] / 255;
    const gray =
      (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) *
        alpha +
      255 * (1 - alpha);
    row += gray < 128 ? "1" : "0";
  }
  rows.push(row);
}
const output = `// Generated from marker.png by scripts/build-marker.js.\nexport const BULLSEYE_RADII = [\n${[radii.slice(0, 3), radii.slice(3)].map((values) => `  ${values.join(", ")},`).join("\n")}\n];\nexport const BULLSEYE_INK = {\n  area: ${ink / (width * width)},\n  x: ${inkX / ink / width},\n  y: ${inkY / ink / width},\n};\nexport const BULLSEYE_BITMAP = [\n${rows.map((row) => `  "${row}",`).join("\n")}\n];\n`;
const target = new URL("../src/patterns/bullseye-bitmap.ts", import.meta.url);
let previous;
try {
  previous = readFileSync(target, "utf8");
} catch {}
if (previous !== output) writeFileSync(target, output);
