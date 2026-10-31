// Module statistique paramétrable : statistiques descriptives complètes,
// matrices de corrélation (Pearson / Spearman), statistiques par groupe,
// tableaux de fréquences et tests d'hypothèse (t de Welch, ANOVA à un facteur,
// khi² d'indépendance) avec de vraies p-values. Moteur pur et testable.

import type { CellValue, Dataset } from "@/lib/types";
import { isEmpty, toNumber } from "@/lib/stats";

// ---------------------------------------------------------------------------
// Fonctions spéciales (p-values) — algorithmes classiques (Numerical Recipes).
// ---------------------------------------------------------------------------

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// P(s, x) régularisé (fonction gamma incomplète inférieure).
function lowerGammaP(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    let ap = s;
    let sum = 1 / s;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - gammaln(s));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - s;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - gammaln(s)) * h;
  return 1 - q;
}

// Khi² : probabilité de la queue supérieure.
export function chiSquarePValue(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 1;
  return 1 - lowerGammaP(df / 2, x / 2);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

// Fonction bêta incomplète régularisée I_x(a, b).
function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// t de Student : p-value bilatérale pour la statistique t et df degrés de liberté.
export function studentTwoTailedP(t: number, df: number): number {
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  return regIncBeta(x, df / 2, 0.5);
}

// Fisher-Snedecor : probabilité de la queue supérieure (P(F > f)).
export function fDistPValue(f: number, df1: number, df2: number): number {
  if (f <= 0) return 1;
  const x = df2 / (df2 + df1 * f);
  return regIncBeta(x, df2 / 2, df1 / 2);
}

// ---------------------------------------------------------------------------
// Statistiques descriptives
// ---------------------------------------------------------------------------

function numericValues(dataset: Dataset, column: string): number[] {
  const out: number[] = [];
  for (const row of dataset.rows) {
    const n = toNumber(row[column]);
    if (n !== null) out.push(n);
  }
  return out;
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export interface Describe {
  column: string;
  n: number;
  missing: number;
  mean: number;
  std: number;
  variance: number;
  sum: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  range: number;
  cv: number | null; // coefficient de variation std/mean
  skewness: number | null;
  kurtosis: number | null; // kurtosis d'excès
  sem: number | null; // erreur-type de la moyenne
  ci95Low: number | null;
  ci95High: number | null;
}

export function describe(dataset: Dataset, column: string): Describe {
  const xs = numericValues(dataset, column);
  const missing = dataset.rows.length - xs.length;
  const n = xs.length;
  if (n === 0) {
    return {
      column, n: 0, missing, mean: NaN, std: NaN, variance: NaN, sum: 0,
      min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, iqr: NaN, range: NaN,
      cv: null, skewness: null, kurtosis: null, sem: null, ci95Low: null, ci95High: null,
    };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const sem = n > 1 ? std / Math.sqrt(n) : null;

  let skewness: number | null = null;
  let kurtosis: number | null = null;
  if (n > 2 && std > 0) {
    const m2 = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const m3 = xs.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
    const m4 = xs.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
    skewness = m3 / m2 ** 1.5;
    kurtosis = m4 / (m2 * m2) - 3;
  }

  return {
    column, n, missing, mean, std, variance, sum,
    min: sorted[0], q1, median, q3, max: sorted[n - 1],
    iqr: q3 - q1, range: sorted[n - 1] - sorted[0],
    cv: mean !== 0 ? std / Math.abs(mean) : null,
    skewness, kurtosis, sem,
    ci95Low: sem !== null ? mean - 1.959964 * sem : null,
    ci95High: sem !== null ? mean + 1.959964 * sem : null,
  };
}

// ---------------------------------------------------------------------------
// Corrélations
// ---------------------------------------------------------------------------

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const rank = (i + j) / 2 + 1; // moyenne des rangs en cas d'ex æquo
    for (let k = i; k <= j; k++) r[idx[k].i] = rank;
    i = j + 1;
  }
  return r;
}

export interface CorrelationMatrix {
  columns: string[];
  method: "pearson" | "spearman";
  matrix: (number | null)[][];
  n: number[][]; // nombre de paires complètes
}

export function correlationMatrix(
  dataset: Dataset,
  columns: string[],
  method: "pearson" | "spearman" = "pearson",
): CorrelationMatrix {
  const k = columns.length;
  const matrix: (number | null)[][] = Array.from({ length: k }, () => new Array(k).fill(null));
  const nMat: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of dataset.rows) {
        const x = toNumber(row[columns[a]]);
        const y = toNumber(row[columns[b]]);
        if (x !== null && y !== null) {
          xs.push(x);
          ys.push(y);
        }
      }
      let r: number;
      if (method === "spearman") r = pearson(ranks(xs), ranks(ys));
      else r = pearson(xs, ys);
      const val = Number.isFinite(r) ? r : null;
      matrix[a][b] = val;
      matrix[b][a] = val;
      nMat[a][b] = nMat[b][a] = xs.length;
    }
  }
  return { columns, method, matrix, n: nMat };
}

// ---------------------------------------------------------------------------
// Statistiques par groupe
// ---------------------------------------------------------------------------

function groupKey(v: CellValue): string | null {
  if (isEmpty(v)) return null;
  return String(v).trim();
}

export interface GroupStat {
  group: string;
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  sum: number;
}

export function groupStats(dataset: Dataset, groupCol: string, valueCol: string): GroupStat[] {
  const groups = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const g = groupKey(row[groupCol]);
    const v = toNumber(row[valueCol]);
    if (g === null || v === null) continue;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(v);
  }
  return [...groups.entries()]
    .map(([group, xs]) => {
      const n = xs.length;
      const sum = xs.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const std = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
      return { group, n, mean, std, min: Math.min(...xs), max: Math.max(...xs), sum };
    })
    .sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------------------
// Tableau de fréquences
// ---------------------------------------------------------------------------

export interface FreqRow {
  value: string;
  count: number;
  pct: number; // 0..100 sur les valeurs renseignées
}
export interface FrequencyTable {
  column: string;
  total: number; // valeurs renseignées
  missing: number;
  rows: FreqRow[];
}

export function frequencies(dataset: Dataset, column: string, topN = 50): FrequencyTable {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const row of dataset.rows) {
    const g = groupKey(row[column]);
    if (g === null) {
      missing++;
      continue;
    }
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = dataset.rows.length - missing;
  let rows = [...counts.entries()]
    .map(([value, count]) => ({ value, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
  if (rows.length > topN) {
    const kept = rows.slice(0, topN);
    const rest = rows.slice(topN);
    const restCount = rest.reduce((s, r) => s + r.count, 0);
    kept.push({ value: `Autres (${rest.length})`, count: restCount, pct: total ? (restCount / total) * 100 : 0 });
    rows = kept;
  }
  return { column, total, missing, rows };
}

// ---------------------------------------------------------------------------
// Tests d'hypothèse
// ---------------------------------------------------------------------------

export interface TTestResult {
  valueCol: string;
  groupCol: string;
  group1: string;
  group2: string;
  n1: number;
  n2: number;
  mean1: number;
  mean2: number;
  t: number;
  df: number;
  p: number;
  error?: undefined;
}
export interface StatError {
  error: string;
}

function meanVar(xs: number[]): { mean: number; variance: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, variance };
}

// t de Welch entre les deux groupes les plus fréquents de groupCol.
export function welchTTest(
  dataset: Dataset,
  valueCol: string,
  groupCol: string,
): TTestResult | StatError {
  const g = groupStats(dataset, groupCol, valueCol);
  if (g.length < 2) return { error: "Il faut au moins deux groupes avec des valeurs numériques." };
  const [a, b] = g.slice(0, 2).map((x) => x.group);
  const xs1: number[] = [];
  const xs2: number[] = [];
  for (const row of dataset.rows) {
    const gk = groupKey(row[groupCol]);
    const v = toNumber(row[valueCol]);
    if (v === null) continue;
    if (gk === a) xs1.push(v);
    else if (gk === b) xs2.push(v);
  }
  if (xs1.length < 2 || xs2.length < 2) return { error: "Chaque groupe doit avoir au moins 2 valeurs." };
  const s1 = meanVar(xs1);
  const s2 = meanVar(xs2);
  const se = Math.sqrt(s1.variance / xs1.length + s2.variance / xs2.length);
  if (se === 0) return { error: "Variance nulle : test impossible." };
  const t = (s1.mean - s2.mean) / se;
  const num = (s1.variance / xs1.length + s2.variance / xs2.length) ** 2;
  const den =
    (s1.variance / xs1.length) ** 2 / (xs1.length - 1) +
    (s2.variance / xs2.length) ** 2 / (xs2.length - 1);
  const df = num / den;
  return {
    valueCol, groupCol, group1: a, group2: b,
    n1: xs1.length, n2: xs2.length, mean1: s1.mean, mean2: s2.mean,
    t, df, p: studentTwoTailedP(Math.abs(t), df),
  };
}

export interface AnovaResult {
  valueCol: string;
  groupCol: string;
  k: number;
  nTotal: number;
  fStat: number;
  df1: number;
  df2: number;
  p: number;
  groups: { group: string; n: number; mean: number }[];
  error?: undefined;
}

export function oneWayAnova(
  dataset: Dataset,
  valueCol: string,
  groupCol: string,
): AnovaResult | StatError {
  const groups = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const g = groupKey(row[groupCol]);
    const v = toNumber(row[valueCol]);
    if (g === null || v === null) continue;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(v);
  }
  const entries = [...groups.entries()].filter(([, xs]) => xs.length >= 1);
  const k = entries.length;
  if (k < 2) return { error: "Il faut au moins deux groupes." };
  const all = entries.flatMap(([, xs]) => xs);
  const nTotal = all.length;
  if (nTotal <= k) return { error: "Trop peu d'observations pour l'ANOVA." };
  const grand = all.reduce((a, b) => a + b, 0) / nTotal;
  let ssb = 0;
  let ssw = 0;
  const groupInfo: { group: string; n: number; mean: number }[] = [];
  for (const [group, xs] of entries) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    ssb += xs.length * (m - grand) ** 2;
    for (const v of xs) ssw += (v - m) ** 2;
    groupInfo.push({ group, n: xs.length, mean: m });
  }
  const df1 = k - 1;
  const df2 = nTotal - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  if (msw === 0) return { error: "Variance intra-groupe nulle : test impossible." };
  const fStat = msb / msw;
  return {
    valueCol, groupCol, k, nTotal, fStat, df1, df2,
    p: fDistPValue(fStat, df1, df2), groups: groupInfo,
  };
}

export interface ChiSquareResult {
  colA: string;
  colB: string;
  chi2: number;
  df: number;
  p: number;
  rowLabels: string[];
  colLabels: string[];
  observed: number[][];
  error?: undefined;
}

export function chiSquareIndependence(
  dataset: Dataset,
  colA: string,
  colB: string,
): ChiSquareResult | StatError {
  const rowLabels: string[] = [];
  const colLabels: string[] = [];
  const rowIndex = new Map<string, number>();
  const colIndex = new Map<string, number>();
  const cells = new Map<string, number>();
  for (const row of dataset.rows) {
    const a = groupKey(row[colA]);
    const b = groupKey(row[colB]);
    if (a === null || b === null) continue;
    if (!rowIndex.has(a)) {
      rowIndex.set(a, rowLabels.length);
      rowLabels.push(a);
    }
    if (!colIndex.has(b)) {
      colIndex.set(b, colLabels.length);
      colLabels.push(b);
    }
    const key = `${a}\u0001${b}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const R = rowLabels.length;
  const C = colLabels.length;
  if (R < 2 || C < 2) return { error: "Chaque variable doit avoir au moins 2 modalités." };
  const observed: number[][] = Array.from({ length: R }, () => new Array(C).fill(0));
  const rowTot = new Array(R).fill(0);
  const colTot = new Array(C).fill(0);
  let total = 0;
  for (const [key, n] of cells) {
    const [a, b] = key.split("\u0001");
    const i = rowIndex.get(a)!;
    const j = colIndex.get(b)!;
    observed[i][j] = n;
    rowTot[i] += n;
    colTot[j] += n;
    total += n;
  }
  let chi2 = 0;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      const e = (rowTot[i] * colTot[j]) / total;
      if (e > 0) chi2 += (observed[i][j] - e) ** 2 / e;
    }
  }
  const df = (R - 1) * (C - 1);
  return { colA, colB, chi2, df, p: chiSquarePValue(chi2, df), rowLabels, colLabels, observed };
}

export function isStatError(x: unknown): x is StatError {
  return typeof x === "object" && x !== null && "error" in x && typeof (x as StatError).error === "string";
}
