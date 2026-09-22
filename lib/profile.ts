import type {
  CategoricalStats,
  ColumnProfile,
  Dataset,
  DatasetProfile,
  NumericStats,
} from "./types";
import {
  inferColumnType,
  isEmpty,
  mean,
  median,
  quantile,
  round,
  std,
  toNumber,
} from "./stats";

function numericStats(values: (number | null)[]): NumericStats {
  const xs = values.filter((v): v is number => v !== null);
  const missing = values.length - xs.length;
  if (xs.length === 0) {
    return {
      count: 0,
      missing,
      mean: NaN,
      median: NaN,
      std: NaN,
      min: NaN,
      max: NaN,
      q1: NaN,
      q3: NaN,
      iqr: NaN,
    };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    count: xs.length,
    missing,
    mean: round(mean(xs)),
    median: round(median(xs)),
    std: round(std(xs)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    q1: round(q1),
    q3: round(q3),
    iqr: round(q3 - q1),
  };
}

function categoricalStats(values: string[]): CategoricalStats {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return {
    count: values.length,
    missing: 0,
    unique: counts.size,
    top,
  };
}

function countOutliers(values: (number | null)[], stats: NumericStats): number {
  if (!Number.isFinite(stats.iqr) || stats.iqr === 0) return 0;
  const low = stats.q1 - 1.5 * stats.iqr;
  const high = stats.q3 + 1.5 * stats.iqr;
  let n = 0;
  for (const v of values) {
    if (v !== null && (v < low || v > high)) n++;
  }
  return n;
}

export function profileColumn(dataset: Dataset, col: string): ColumnProfile {
  const raw = dataset.rows.map((r) => r[col]);
  const type = inferColumnType(raw);
  const missing = raw.filter((v) => isEmpty(v)).length;
  const count = raw.length - missing;
  const nonEmpty = raw.filter((v) => !isEmpty(v));
  const unique = new Set(nonEmpty.map((v) => String(v))).size;

  const profile: ColumnProfile = {
    name: col,
    type,
    count,
    missing,
    missingPct: raw.length ? round((missing / raw.length) * 100, 2) : 0,
    unique,
  };

  if (type === "number") {
    const nums = raw.map((v) => (isEmpty(v) ? null : toNumber(v)));
    const stats = numericStats(nums);
    profile.numeric = stats;
    profile.outliers = countOutliers(nums, stats);
  } else {
    profile.categorical = categoricalStats(
      nonEmpty.map((v) => String(v)),
    );
    profile.categorical.missing = missing;
  }

  return profile;
}

export function countDuplicates(dataset: Dataset): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of dataset.rows) {
    const key = dataset.columns.map((c) => String(r[c] ?? "")).join("\u0001");
    if (seen.has(key)) dupes++;
    else seen.add(key);
  }
  return dupes;
}

export function profileDataset(dataset: Dataset): DatasetProfile {
  const columns = dataset.columns.map((c) => profileColumn(dataset, c));
  const totalMissing = columns.reduce((a, c) => a + c.missing, 0);
  return {
    rowCount: dataset.rows.length,
    columnCount: dataset.columns.length,
    duplicateRows: countDuplicates(dataset),
    totalMissing,
    columns,
  };
}
