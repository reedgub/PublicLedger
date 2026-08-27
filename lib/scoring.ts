export const WILSON_80_Z = 1.2815515655446004;

export function accuracy(correct: number, incorrect: number): number | null {
  const resolved = correct + incorrect;
  return resolved > 0 ? correct / resolved : null;
}

export function wilsonLowerBound(correct: number, total: number, z = WILSON_80_Z): number {
  if (total <= 0) return 0;
  if (correct < 0 || correct > total) throw new RangeError("correct must be between 0 and total");
  const p = correct / total;
  const z2 = z * z;
  const numerator = p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, numerator / (1 + z2 / total));
}

export function brierScore(items: ReadonlyArray<{ probability: number; outcome: 0 | 1 }>): number | null {
  if (items.length === 0) return null;
  for (const item of items) {
    if (item.probability < 0 || item.probability > 1) throw new RangeError("probability must be in [0, 1]");
  }
  return items.reduce((sum, item) => sum + (item.probability - item.outcome) ** 2, 0) / items.length;
}

export type CalibrationBucket = {
  label: string;
  min: number;
  max: number;
  count: number;
  predictedAverage: number | null;
  observedRate: number | null;
};

export function calibrationBuckets(
  items: ReadonlyArray<{ probability: number; outcome: 0 | 1 }>,
): CalibrationBucket[] {
  const buckets = Array.from({ length: 5 }, (_, index) => ({
    label: `${index * 20}–${(index + 1) * 20}%`,
    min: index * 0.2,
    max: (index + 1) * 0.2,
    values: [] as Array<{ probability: number; outcome: 0 | 1 }>,
  }));

  for (const item of items) {
    if (item.probability < 0 || item.probability > 1) throw new RangeError("probability must be in [0, 1]");
    buckets[Math.min(4, Math.floor(item.probability * 5))].values.push(item);
  }

  return buckets.map(({ label, min, max, values }) => ({
    label,
    min,
    max,
    count: values.length,
    predictedAverage: values.length
      ? values.reduce((sum, item) => sum + item.probability, 0) / values.length
      : null,
    observedRate: values.length
      ? values.reduce((sum, item) => sum + item.outcome, 0) / values.length
      : null,
  }));
}
