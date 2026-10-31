// Tableau croisé dynamique (TCD) — modèle de données.
//
// Conçu pour remplacer le tableau croisé d'Excel : plusieurs champs en lignes
// et en colonnes (imbriqués), plusieurs mesures, sous-totaux et totaux
// généraux, filtres. Le moteur (engine.ts) est pur et testable ; l'affichage
// (components/PivotPanel.tsx) et l'export Excel consomment ce modèle.

import type { ColumnKind, DateBucket } from "@/lib/charts/types";

export type PivotAgg =
  | "sum"
  | "mean"
  | "median"
  | "count"
  | "distinct"
  | "min"
  | "max"
  | "var"
  | "std";

export const PIVOT_AGG_LABEL: Record<PivotAgg, string> = {
  sum: "Somme",
  mean: "Moyenne",
  median: "Médiane",
  count: "Nombre",
  distinct: "Nombre distinct",
  min: "Minimum",
  max: "Maximum",
  var: "Variance",
  std: "Écart-type",
};

// Un champ placé en ligne, en colonne ou en filtre.
export interface PivotField {
  column: string;
  kind: ColumnKind;
  bucket?: DateBucket; // regroupement des dates (jour, mois, trimestre, année)
}

// Une mesure : colonne agrégée (ou comptage de lignes si column = null).
export interface PivotValue {
  column: string | null;
  agg: PivotAgg;
  label?: string; // libellé affiché (sinon déduit)
  decimals?: number; // décimales d'affichage (défaut : automatique)
}

export interface PivotFilter {
  column: string;
  kind: ColumnKind;
  bucket?: DateBucket;
  include: string[]; // clés de catégories retenues ; vide = aucune restriction
}

export interface PivotConfig {
  rows: PivotField[];
  columns: PivotField[];
  values: PivotValue[];
  filters: PivotFilter[];
  rowSubtotals: boolean; // sous-totaux pour les niveaux de lignes imbriqués
  grandTotal: boolean; // ligne et colonne de total général
}

export interface PivotCell {
  value: number | null;
  display: string;
}

export interface PivotColumnLeaf {
  path: string[]; // libellés des champs colonne (vide si aucun champ colonne)
  key: string;
}

export interface PivotHeaderCell {
  label: string;
  span: number; // nombre de colonnes de données couvertes
}

export type PivotRowKind = "data" | "subtotal" | "grandtotal";

export interface PivotRow {
  labels: string[]; // un libellé par champ ligne (complété pour sous-totaux/total)
  depth: number; // indentation (0 = niveau racine)
  kind: PivotRowKind;
  cells: PivotCell[][]; // [index de colonne-feuille][index de mesure]
  totals: PivotCell[]; // total général de la ligne, par mesure (si grandTotal)
}

export interface PivotResult {
  values: PivotValue[];
  valueLabels: string[];
  rowFieldLabels: string[]; // noms des champs en ligne (coin haut-gauche)
  columnLeaves: PivotColumnLeaf[]; // colonnes-feuilles (combinaisons des champs colonne)
  headerRows: PivotHeaderCell[][]; // en-têtes de colonnes groupés (un par niveau + mesures)
  rows: PivotRow[];
  grandTotalRow: PivotRow | null; // ligne de total général (si grandTotal)
  warnings: string[];
  cellCount: number; // nombre de cellules de données calculées
}
