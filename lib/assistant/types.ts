// Assistant IA — schéma du « plan de transformation ».
//
// Principe « l'IA planifie, DataLab exécute » : à partir d'une demande en
// langage naturel, l'IA ne renvoie PAS des données, mais un PLAN structuré
// (liste ordonnée d'opérations) que DataLab exécute localement sur l'ensemble
// des données (lib/assistant/execute.ts). Fiable, vérifiable, et les lignes
// brutes ne quittent jamais la machine (seuls schéma + échantillon sont
// envoyés à l'IA).

import type { CellValue, Row } from "../types";

export type FilterOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "in"
  | "not_in";

export type AggFn =
  | "sum"
  | "avg"
  | "median"
  | "min"
  | "max"
  | "count"
  | "count_distinct";

export type SortDir = "asc" | "desc";

export interface FilterStep {
  op: "filter";
  column: string;
  operator: FilterOperator;
  value: CellValue | CellValue[];
}

export interface SelectStep {
  op: "select";
  columns: string[];
}

export interface RenameStep {
  op: "rename";
  renames: { from: string; to: string }[];
}

// Colonne calculée. La formule référence les colonnes entre crochets :
// ex. "[Réalisé] / [Cible] * 100". Opérateurs + - * / et parenthèses.
export interface DeriveStep {
  op: "derive";
  name: string;
  formula: string;
}

export interface SortStep {
  op: "sort";
  by: { column: string; dir?: SortDir }[];
}

export interface Measure {
  column: string; // colonne à agréger (ignorée pour "count")
  agg: AggFn;
  as?: string; // nom de la colonne résultat
}

export interface GroupAggregateStep {
  op: "group_aggregate";
  group_by: string[];
  measures: Measure[];
}

export interface LimitStep {
  op: "limit";
  n: number;
}

export type PlanStep =
  | FilterStep
  | SelectStep
  | RenameStep
  | DeriveStep
  | SortStep
  | GroupAggregateStep
  | LimitStep;

export interface TransformPlan {
  title: string; // titre du document produit
  steps: PlanStep[];
  explanation: string; // ce que fait la transformation, en français
}

export interface ExecResult {
  columns: string[];
  rows: Row[];
  stepNotes: string[]; // note lisible par étape (lignes avant/après…)
  warnings: string[]; // avertissements non bloquants (colonne inconnue…)
}
