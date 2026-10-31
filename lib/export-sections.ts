// Contenu commun aux exports (Excel, PDF, Word) : KPI, statistiques
// descriptives, fréquences, tableau croisé, clustering et régression, produits
// une seule fois ici sous forme de tableaux de cellules, puis rendus par chaque
// format. Garantit que les trois documents disent exactement la même chose.

import type { Dataset, DatasetProfile, KMeansResult, RegressionResult } from "./types";
import { computeKpis, type KpiDef } from "./kpi/kpi";
import { describe, frequencies } from "./statlab/statlab";
import { computePivot, flattenPivot } from "./pivot/engine";
import type { PivotConfig } from "./pivot/types";

export type Cell = string | number | null;
export interface SectionTable {
  title: string;
  columns: string[];
  rows: Cell[][];
}

// Éléments supplémentaires d'une feuille, au-delà du profil/corrélations déjà
// gérés par les exporteurs : indicateurs, TCD et résultats ML personnalisés.
export interface SheetExtras {
  kpis: KpiDef[];
  pivot: PivotConfig;
  kmeans: KMeansResult | null;
  regression: RegressionResult | null;
}

export const STATS_COLUMNS = [
  "Variable", "N", "Manquants", "Moyenne", "Écart-type", "Min", "Q1", "Médiane",
  "Q3", "Max", "CV (%)", "Asymétrie", "Aplatissement", "IC 95 % bas", "IC 95 % haut",
];

export function kpiTable(dataset: Dataset, kpis: KpiDef[]): SectionTable | null {
  if (kpis.length === 0) return null;
  const rows: Cell[][] = computeKpis(dataset, kpis).map((k) => [k.def.label, k.value]);
  return { title: "Indicateurs clés (KPI)", columns: ["Indicateur", "Valeur"], rows };
}

export function statsTable(dataset: Dataset, profile: DatasetProfile): SectionTable | null {
  const numeric = profile.columns.filter((c) => c.type === "number").map((c) => c.name);
  if (numeric.length === 0) return null;
  const rows: Cell[][] = numeric.map((col) => {
    const d = describe(dataset, col);
    return [
      d.column, d.n, d.missing, d.mean, d.std, d.min, d.q1, d.median, d.q3, d.max,
      d.cv === null ? null : d.cv * 100, d.skewness, d.kurtosis, d.ci95Low, d.ci95High,
    ];
  });
  return { title: "Statistiques descriptives", columns: STATS_COLUMNS, rows };
}

// Une table de fréquences par colonne catégorielle (bornée pour les formats
// paginés). maxCols = 0 → toutes.
export function frequencyTables(
  dataset: Dataset,
  profile: DatasetProfile,
  topN: number,
  maxCols = 0,
): SectionTable[] {
  const cats = profile.columns.filter((c) => c.type === "string" || c.type === "boolean");
  const list = maxCols > 0 ? cats.slice(0, maxCols) : cats;
  return list.map((c) => {
    const t = frequencies(dataset, c.name, topN);
    return {
      title: `Fréquences — ${c.name} (${t.total} renseignée(s), ${t.missing} manquante(s))`,
      columns: [c.name, "Effectif", "%"],
      rows: t.rows.map((r) => [r.value, r.count, Number(r.pct.toFixed(1))] as Cell[]),
    };
  });
}

export function pivotTable(dataset: Dataset, pivot: PivotConfig): SectionTable | null {
  if (pivot.rows.length === 0 && pivot.columns.length === 0 && pivot.values.length === 0) return null;
  const res = computePivot(dataset, pivot);
  const flat = flattenPivot(res);
  return { title: "Tableau croisé dynamique", columns: flat.columns, rows: flat.rows };
}

export interface ClusteringSection {
  summary: SectionTable;
  note: string;
}

export function clusteringSection(kmeans: KMeansResult | null): ClusteringSection | null {
  if (!kmeans || kmeans.clusters.length === 0) return null;
  const columns = ["Groupe", "Taille", "Part (%)", ...kmeans.columns.map((c) => `Moy. ${c}`)];
  const rows: Cell[][] = kmeans.clusters.map((c) => [
    `Groupe ${c.cluster + 1}`,
    c.size,
    Number((c.share * 100).toFixed(1)),
    ...kmeans.columns.map((col) => c.means[col] ?? null),
  ]);
  const note =
    `k-means sur ${kmeans.columns.length} variable(s) : ${kmeans.columns.join(", ")}. ` +
    `${kmeans.k} groupes, ${kmeans.rowsUsed} ligne(s) utilisée(s)` +
    (kmeans.rowsSkipped ? `, ${kmeans.rowsSkipped} ignorée(s)` : "") +
    (kmeans.sampled ? " (calcul sur échantillon)" : "") +
    `, ${kmeans.iterations} itération(s), inertie ${kmeans.inertia.toFixed(2)}.`;
  return { summary: { title: "Clustering (k-means)", columns, rows }, note };
}

export interface RegressionSection {
  lines: string[];
  coefficients: SectionTable;
}

export function regressionSection(regression: RegressionResult | null): RegressionSection | null {
  if (!regression) return null;
  const r = regression;
  const n = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  const lines = [
    `Équation : ${r.equation}`,
    `R² = ${n(r.r2)} · R² ajusté = ${n(r.adjustedR2)} · RMSE = ${n(r.rmse)} · MAE = ${n(r.mae)}`,
    `${r.rowsUsed} observation(s) utilisée(s)${r.rowsSkipped ? `, ${r.rowsSkipped} ignorée(s)` : ""}.`,
  ];
  const coeffRows: Cell[][] = [
    ["Constante", r.intercept, null],
    ...r.coefficients.map((c) => [c.name, c.coefficient, c.standardized ?? null] as Cell[]),
  ];
  return {
    lines,
    coefficients: {
      title: `Régression linéaire — ${r.target}`,
      columns: ["Terme", "Coefficient", "Coef. standardisé"],
      rows: coeffRows,
    },
  };
}
