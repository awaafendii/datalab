// Machine Learning côté navigateur : clustering (k-means) et régression
// linéaire (OLS, simple ou multiple). Aucune dépendance serveur — cohérent
// avec le reste de DataLab qui s'exécute entièrement dans le navigateur.

import type {
  Dataset,
  ElbowPoint,
  KMeansClusterStat,
  KMeansPoint,
  KMeansResult,
  RegressionCoefficient,
  RegressionPoint,
  RegressionResult,
} from "./types";
import { mean, round, std, toNumber } from "./stats";

// Au-delà de ce nombre de lignes complètes, le clustering est calculé sur un
// échantillon aléatoire pour rester réactif dans le navigateur.
const KMEANS_SAMPLE_CAP = 20000;

// =====================================================================
// Régression linéaire (moindres carrés ordinaires — OLS)
// =====================================================================

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const t = zeros(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) t[j][i] = m[i][j];
  }
  return t;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const k = b.length;
  const m = b[0]?.length ?? 0;
  const out = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += a[i][p] * b[p][j];
      out[i][j] = s;
    }
  }
  return out;
}

// Résout A·x = b (A carrée n×n) par élimination de Gauss-Jordan avec pivot
// partiel. Utilisé pour résoudre les équations normales de l'OLS.
function solveLinearSystem(A: number[][], b: number[][]): number[][] {
  const n = A.length;
  const bc = b[0]?.length ?? 0;
  const M = A.map((row, i) => [...row, ...b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-9) {
      throw new Error(
        "Impossible d'ajuster le modèle : les variables sélectionnées sont trop corrélées entre elles (colinéarité) ou il n'y a pas assez de données distinctes.",
      );
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivotVal = M[col][col];
    for (let c = 0; c < n + bc; c++) M[col][c] /= pivotVal;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < n + bc; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row) => row.slice(n));
}

function formatCoef(n: number): string {
  return String(Math.abs(round(n, 4)));
}

/**
 * Régression linéaire par moindres carrés ordinaires. Fonctionne pour un
 * prédicteur (régression simple) ou plusieurs (régression multiple).
 */
export function runLinearRegression(
  dataset: Dataset,
  target: string,
  predictors: string[],
): RegressionResult {
  if (predictors.length === 0) {
    throw new Error("Choisissez au moins une variable prédictive numérique.");
  }
  if (predictors.includes(target)) {
    throw new Error("La variable à expliquer ne peut pas être aussi un prédicteur.");
  }

  const p = predictors.length;
  const rowsUsedIdx: number[] = [];
  const X: number[][] = [];
  const y: number[] = [];

  for (let idx = 0; idx < dataset.rows.length; idx++) {
    const r = dataset.rows[idx];
    const yv = toNumber(r[target]);
    if (yv === null) continue;
    const xs: number[] = [];
    let ok = true;
    for (const col of predictors) {
      const xv = toNumber(r[col]);
      if (xv === null) {
        ok = false;
        break;
      }
      xs.push(xv);
    }
    if (!ok) continue;
    rowsUsedIdx.push(idx);
    X.push(xs);
    y.push(yv);
  }

  const n = X.length;
  const rowsSkipped = dataset.rows.length - n;
  if (n < p + 2) {
    throw new Error(
      `Pas assez de lignes complètes (${n}) pour ${p} prédicteur(s) : il en faut au moins ${p + 2}.`,
    );
  }

  // Matrice de design avec colonne d'ordonnée à l'origine (intercept).
  const design = X.map((row) => [1, ...row]);
  const Xt = transpose(design);
  const XtX = matMul(Xt, design);
  const Yc = y.map((v) => [v]);
  const XtY = matMul(Xt, Yc);

  const betaMat = solveLinearSystem(XtX, XtY);
  const beta = betaMat.map((row) => row[0]);
  const intercept = beta[0];
  const coefsRaw = beta.slice(1);

  const predicted = design.map((row) =>
    row.reduce((s, v, i) => s + v * beta[i], 0),
  );
  const residuals = y.map((v, i) => v - predicted[i]);

  const yMean = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - yMean) * (v - yMean), 0);
  const ssRes = residuals.reduce((s, v) => s + v * v, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const adjustedR2 = n - p - 1 > 0 ? 1 - ((1 - r2) * (n - 1)) / (n - p - 1) : r2;
  const rmse = Math.sqrt(ssRes / n);
  const mae = residuals.reduce((s, v) => s + Math.abs(v), 0) / n;

  const yStd = std(y);
  const coefficients: RegressionCoefficient[] = predictors.map((name, i) => {
    const xi = X.map((row) => row[i]);
    const xStd = std(xi);
    const standardized =
      yStd === 0 || xStd === 0
        ? undefined
        : round((coefsRaw[i] * xStd) / yStd, 4);
    return { name, coefficient: round(coefsRaw[i], 6), standardized };
  });

  const equationBody = coefficients
    .map((c, i) => `${i === 0 ? (c.coefficient >= 0 ? "" : "− ") : c.coefficient >= 0 ? "+ " : "− "}${formatCoef(c.coefficient)} × ${c.name}`)
    .join(" ");
  const equation = `${target} ≈ ${equationBody} ${intercept >= 0 ? "+" : "−"} ${formatCoef(intercept)}`;

  const points: RegressionPoint[] = rowsUsedIdx.map((rowIndex, i) => ({
    rowIndex,
    actual: round(y[i], 4),
    predicted: round(predicted[i], 4),
    residual: round(residuals[i], 4),
    x: predictors.length === 1 ? X[i][0] : undefined,
  }));
  if (predictors.length === 1) {
    points.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  }

  return {
    target,
    predictors,
    rowsUsed: n,
    rowsSkipped,
    intercept: round(intercept, 6),
    coefficients,
    r2: round(r2, 4),
    adjustedR2: round(adjustedR2, 4),
    rmse: round(rmse, 4),
    mae: round(mae, 4),
    equation,
    points,
  };
}

// =====================================================================
// Clustering k-means
// =====================================================================

function euclideanSq(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function kmeansPlusPlusInit(data: number[][], k: number): number[][] {
  const n = data.length;
  const centroids: number[][] = [];
  centroids.push([...data[Math.floor(Math.random() * n)]]);
  const dist = new Array(n).fill(Infinity);

  while (centroids.length < k) {
    let sum = 0;
    const last = centroids[centroids.length - 1];
    for (let i = 0; i < n; i++) {
      const d = euclideanSq(data[i], last);
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    if (sum === 0) {
      centroids.push([...data[Math.floor(Math.random() * n)]]);
      continue;
    }
    let r = Math.random() * sum;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dist[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push([...data[chosen]]);
  }
  return centroids;
}

interface KMeansRun {
  assignments: number[];
  centroids: number[][];
  inertia: number;
  iterations: number;
}

function runKMeansRaw(data: number[][], k: number, maxIter = 50): KMeansRun {
  const n = data.length;
  const d = data[0].length;
  let centroids = kmeansPlusPlusInit(data, k);
  let assignments = new Array(n).fill(-1);
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let changed = false;
    const newAssignments = new Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = euclideanSq(data[i], centroids[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      newAssignments[i] = best;
      if (newAssignments[i] !== assignments[i]) changed = true;
    }
    assignments = newAssignments;

    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < d; j++) sums[c][j] += data[i][j];
    }
    centroids = centroids.map((old, c) =>
      counts[c] === 0 ? old : sums[c].map((s) => s / counts[c]),
    );

    if (!changed) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += euclideanSq(data[i], centroids[assignments[i]]);

  return { assignments, centroids, inertia, iterations };
}

function runKMeansBest(data: number[][], k: number, nInit: number): KMeansRun {
  let best: KMeansRun | null = null;
  for (let i = 0; i < nInit; i++) {
    const run = runKMeansRaw(data, k);
    if (!best || run.inertia < best.inertia) best = run;
  }
  return best as KMeansRun;
}

/**
 * Clustering k-means sur un sous-ensemble de colonnes numériques. Les
 * variables sont centrées-réduites avant calcul (chaque colonne pèse le même
 * poids dans la distance), puis les centroïdes sont ramenés à l'échelle
 * d'origine pour l'interprétation.
 */
export function runKMeans(
  dataset: Dataset,
  columns: string[],
  k: number,
): KMeansResult {
  if (columns.length < 1) {
    throw new Error("Choisissez au moins une colonne numérique.");
  }
  if (k < 2) {
    throw new Error("Le nombre de groupes (k) doit être au moins 2.");
  }

  const allRowsIdx: number[] = [];
  const allRaw: number[][] = [];
  for (let idx = 0; idx < dataset.rows.length; idx++) {
    const r = dataset.rows[idx];
    const vals: number[] = [];
    let ok = true;
    for (const col of columns) {
      const v = toNumber(r[col]);
      if (v === null) {
        ok = false;
        break;
      }
      vals.push(v);
    }
    if (!ok) continue;
    allRowsIdx.push(idx);
    allRaw.push(vals);
  }

  const totalComplete = allRaw.length;
  const rowsSkipped = dataset.rows.length - totalComplete;
  if (totalComplete < k * 2) {
    throw new Error(
      `Pas assez de lignes complètes (${totalComplete}) pour former ${k} groupes. Réduisez k ou choisissez moins de colonnes.`,
    );
  }

  // Échantillonnage si le volume est trop important pour rester réactif.
  let rowsUsedIdx = allRowsIdx;
  let raw = allRaw;
  const sampled = totalComplete > KMEANS_SAMPLE_CAP;
  if (sampled) {
    const order = allRaw.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const keep = order.slice(0, KMEANS_SAMPLE_CAP);
    rowsUsedIdx = keep.map((i) => allRowsIdx[i]);
    raw = keep.map((i) => allRaw[i]);
  }

  const n = raw.length;
  const d = columns.length;
  const colMeans = new Array(d).fill(0);
  const colStds = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    const col = raw.map((row) => row[j]);
    colMeans[j] = mean(col);
    colStds[j] = std(col) || 1; // évite la division par zéro (colonne constante)
  }
  const standardized = raw.map((row) =>
    row.map((v, j) => (v - colMeans[j]) / colStds[j]),
  );

  const kMax = Math.min(8, n - 1);
  const elbow: ElbowPoint[] = [];
  for (let kk = 1; kk <= kMax; kk++) {
    const run = runKMeansBest(standardized, kk, 3);
    elbow.push({ k: kk, inertia: round(run.inertia, 3) });
  }

  const best = runKMeansBest(standardized, k, 8);

  const clusterSizes = new Array(k).fill(0);
  for (const c of best.assignments) clusterSizes[c]++;

  const clusters: KMeansClusterStat[] = Array.from({ length: k }, (_, c) => {
    const idxInCluster = best.assignments
      .map((cc, i) => (cc === c ? i : -1))
      .filter((i) => i >= 0);
    const means: Record<string, number> = {};
    columns.forEach((col, j) => {
      const vals = idxInCluster.map((i) => raw[i][j]);
      means[col] = vals.length ? round(mean(vals), 3) : NaN;
    });
    return {
      cluster: c,
      size: clusterSizes[c],
      share: n ? round((clusterSizes[c] / n) * 100, 1) : 0,
      means,
    };
  });

  const points: KMeansPoint[] = rowsUsedIdx.map((rowIndex, i) => {
    const values: Record<string, number> = {};
    columns.forEach((col, j) => {
      values[col] = raw[i][j];
    });
    return { rowIndex, cluster: best.assignments[i], values };
  });

  return {
    columns,
    k,
    rowsUsed: n,
    rowsSkipped,
    sampled,
    iterations: best.iterations,
    inertia: round(best.inertia, 3),
    clusters,
    points,
    elbow,
  };
}
