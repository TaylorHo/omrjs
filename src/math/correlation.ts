export type TemplateStats = {
  mean: number;
  std: number;
  size: number;
};

export function computeTemplateStats(template: Float32Array): TemplateStats {
  const n = template.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += template[i]!;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = template[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  return { mean, std, size: n };
}
