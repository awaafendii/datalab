// Indicateurs clés (KPI) : définis automatiquement à partir du profil des
// données, ou manuellement par l'utilisateur. Moteur pur et testable ;
// l'affichage (components/KpiPanel.tsx) et l'export Excel consomment ce modèle.

import type { Dataset, DatasetProfile } from "@/lib/types";
import { isEmpty, toNumber } from "@/lib/stats";
import { fmt } from "@/lib/documents/text";

export type KpiAgg =
  | "count" // nombre de lignes
  | "nonEmpty" // nombre de valeurs renseignées
  | "missingPct" // % de valeurs manquantes
  | "distinct" // nombre de valeurs distinctes
  | "sum"
  | "mean"
  | "median"
  | "min"
  | "max"
  | "std";

export const KPI_AGG_LABEL: Record<KpiAgg, string> = {
  count: "Nombre de lignes",
  nonEmpty: "Valeurs renseignées",
  missingPct: "% manquant",
  distinct: "Valeurs distinctes",
  sum: "Somme",
  mean: "Moyenne",
  median: "Médiane",
  min: "Minimum",
  max: "Maximum",
  std: "Écart-type",
};

// Agrégations applicables à une colonne numérique / non numérique.
export const KPI_NUMERIC_AGGS: KpiAgg[] = [
  "sum",
  "mean",
  "median",
  "min",
  "max",
  "std",
  "distinct",
  "nonEmpty",
  "missingPct",
];
export const KPI_NON_NUMERIC_AGGS: KpiAgg[] = ["distinct", "nonEmpty", "missingPct"];

export interface KpiDef {
  id: string;
  label: string;
  column: string | null; // null => comptage de lignes
  agg: KpiAgg;
  decimals?: number; // décimales d'affichage (défaut selon l'agrégation)
  prefix?: string;
  suffix?: string;
}

export interface KpiValue {
  def: KpiDef;
  value: number | null;
  display: string;
}

function numericValues(dataset: Dataset, column: string): number[] {
  const out: number[] = [];
  for (const row of dataset.rows) {
    const n = toNumber(row[column]);
    if (n !== null) out.push(n);
  }
  return out;
}

function defaultDecimals(agg: KpiAgg): number {
  switch (agg) {
    case "mean":
    case "median":
    case "std":
      return 2;
    case "missingPct":
      return 1;
    default:
      return 0;
  }
}

export function computeKpi(dataset: Dataset, def: KpiDef): KpiValue {
  const total = dataset.rows.length;
  let value: number | null = null;

  if (def.agg === "count" || def.column === null) {
    value = total;
  } else {
    const col = def.column;
    if (def.agg === "nonEmpty") {
      value = dataset.rows.reduce((n, r) => n + (isEmpty(r[col]) ? 0 : 1), 0);
    } else if (def.agg === "missingPct") {
      const missing = dataset.rows.reduce((n, r) => n + (isEmpty(r[col]) ? 1 : 0), 0);
      value = total === 0 ? 0 : (missing / total) * 100;
    } else if (def.agg === "distinct") {
      const set = new Set<string>();
      for (const r of dataset.rows) if (!isEmpty(r[col])) set.add(String(r[col]).trim());
      value = set.size;
    } else {
      const xs = numericValues(dataset, col);
      if (xs.length === 0) value = null;
      else
        switch (def.agg) {
          case "sum":
            value = xs.reduce((a, b) => a + b, 0);
            break;
          case "mean":
            value = xs.reduce((a, b) => a + b, 0) / xs.length;
            break;
          case "median": {
            const s = [...xs].sort((a, b) => a - b);
            const m = s.length >> 1;
            value = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
            break;
          }
          case "min":
            value = xs.reduce((a, b) => (b < a ? b : a), Infinity);
            break;
          case "max":
            value = xs.reduce((a, b) => (b > a ? b : a), -Infinity);
            break;
          case "std": {
            if (xs.length < 2) value = null;
            else {
              const m = xs.reduce((a, b) => a + b, 0) / xs.length;
              const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
              value = Math.sqrt(v);
            }
            break;
          }
        }
    }
  }

  return { def, value, display: formatKpi(value, def) };
}

export function formatKpi(value: number | null, def: KpiDef): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const decimals = def.decimals ?? defaultDecimals(def.agg);
  return `${def.prefix ?? ""}${fmt(value, decimals)}${def.suffix ?? ""}`;
}

export function computeKpis(dataset: Dataset, defs: KpiDef[]): KpiValue[] {
  return defs.map((d) => computeKpi(dataset, d));
}

// Génère des KPI pertinents d'après le profil : comptage de lignes, sommes et
// moyennes des colonnes numériques, nombre de modalités des colonnes
// catégorielles. Bornés pour rester lisibles.
export function autoKpis(profile: DatasetProfile): KpiDef[] {
  const defs: KpiDef[] = [
    { id: "auto-count", label: "Nombre de lignes", column: null, agg: "count" },
  ];
  const numeric = profile.columns.filter((c) => c.type === "number");
  const categorical = profile.columns.filter((c) => c.type === "string" || c.type === "boolean");

  for (const c of numeric.slice(0, 4)) {
    defs.push({ id: `auto-sum-${c.name}`, label: `Somme · ${c.name}`, column: c.name, agg: "sum" });
    defs.push({ id: `auto-mean-${c.name}`, label: `Moyenne · ${c.name}`, column: c.name, agg: "mean", decimals: 2 });
  }
  for (const c of categorical.slice(0, 3)) {
    defs.push({
      id: `auto-distinct-${c.name}`,
      label: `Modalités · ${c.name}`,
      column: c.name,
      agg: "distinct",
    });
  }
  return defs;
}

let seq = 0;
export function newKpiId(): string {
  return `kpi-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}
