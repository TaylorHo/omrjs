export type Point = { x: number; y: number };

/** Solve 8×8 linear system Ax = b via Gaussian elimination with partial pivoting. */
export function solveLinearSystem(
  A: Float64Array,
  b: Float64Array,
): Float64Array {
  const n = 8;
  const aug = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      aug[i * (n + 1) + j] = A[i * n + j]!;
    }
    aug[i * (n + 1) + n] = b[i]!;
  }

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col * (n + 1) + col]!);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row * (n + 1) + col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) {
      throw new Error("Singular matrix in homography computation");
    }
    if (maxRow !== col) {
      for (let j = col; j <= n; j++) {
        const tmp = aug[col * (n + 1) + j]!;
        aug[col * (n + 1) + j] = aug[maxRow * (n + 1) + j]!;
        aug[maxRow * (n + 1) + j] = tmp;
      }
    }
    const pivot = aug[col * (n + 1) + col]!;
    for (let j = col; j <= n; j++) {
      aug[col * (n + 1) + j]! /= pivot;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row * (n + 1) + col]!;
      for (let j = col; j <= n; j++) {
        aug[row * (n + 1) + j]! -= factor * aug[col * (n + 1) + j]!;
      }
    }
  }

  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = aug[i * (n + 1) + n]!;
  }
  return x;
}

/**
 * Compute 3×3 homography matrix (row-major) mapping src → dst using DLT.
 * Returns Float64Array[9] with H[8] = 1.
 */
export function computeHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): Float64Array {
  const A = new Float64Array(64);
  const b = new Float64Array(8);

  for (let i = 0; i < 4; i++) {
    const sx = src[i]!.x;
    const sy = src[i]!.y;
    const dx = dst[i]!.x;
    const dy = dst[i]!.y;
    const r0 = i * 2;
    const r1 = i * 2 + 1;

    A[r0 * 8 + 0] = -sx;
    A[r0 * 8 + 1] = -sy;
    A[r0 * 8 + 2] = -1;
    A[r0 * 8 + 6] = sx * dx;
    A[r0 * 8 + 7] = sy * dx;
    b[r0] = -dx;

    A[r1 * 8 + 3] = -sx;
    A[r1 * 8 + 4] = -sy;
    A[r1 * 8 + 5] = -1;
    A[r1 * 8 + 6] = sx * dy;
    A[r1 * 8 + 7] = sy * dy;
    b[r1] = -dy;
  }

  const h = solveLinearSystem(A, b);
  const H = new Float64Array(9);
  H[0] = h[0]!;
  H[1] = h[1]!;
  H[2] = h[2]!;
  H[3] = h[3]!;
  H[4] = h[4]!;
  H[5] = h[5]!;
  H[6] = h[6]!;
  H[7] = h[7]!;
  H[8] = 1;
  return H;
}

/** Invert a 3×3 matrix (row-major). Returns null if singular. */
export function invert3x3(m: Float64Array): Float64Array | null {
  const a = m[0]!,
    b = m[1]!,
    c = m[2]!;
  const d = m[3]!,
    e = m[4]!,
    f = m[5]!;
  const g = m[6]!,
    h = m[7]!,
    i = m[8]!;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  return new Float64Array([
    A * invDet,
    D * invDet,
    G * invDet,
    B * invDet,
    E * invDet,
    H * invDet,
    C * invDet,
    F * invDet,
    I * invDet,
  ]);
}

/** Apply inverse homography to a point. */
export function applyHomographyInverse(
  Hinv: Float64Array,
  x: number,
  y: number,
): { x: number; y: number } {
  const w = Hinv[6]! * x + Hinv[7]! * y + Hinv[8]!;
  return {
    x: (Hinv[0]! * x + Hinv[1]! * y + Hinv[2]!) / w,
    y: (Hinv[3]! * x + Hinv[4]! * y + Hinv[5]!) / w,
  };
}
