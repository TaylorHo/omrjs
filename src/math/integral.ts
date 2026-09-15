/** Build a summed-area table (integral image) for O(1) rectangle sums. */
export function buildIntegral(
  image: Float32Array | Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += image[y * width + x]!;
      const idx = (y + 1) * (width + 1) + (x + 1);
      sat[idx] = rowSum + sat[y * (width + 1) + (x + 1)]!;
    }
  }
  return sat;
}

/** Sum of values in rectangle [x0,y0)–[x1,y1) using SAT. */
export function rectSum(
  sat: Float64Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
): number {
  const stride = width + 1;
  const a = sat[y0 * stride + x0]!;
  const b = sat[y0 * stride + x1]!;
  const c = sat[y1 * stride + x0]!;
  const d = sat[y1 * stride + x1]!;
  return d - b - c + a;
}
