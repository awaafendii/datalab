// Examen manuel du nettoyage : repère les cellules vides et les valeurs
// atypiques d'une feuille (sur les valeurs normalisées, comme le pipeline),
// propose des valeurs de remplacement et décrit ce que ferait le traitement
// automatique en l'absence de décision.

import type {
  CellReview,
  CellValue,
  CleaningOptions,
  Dataset,
  ManualReview,
  ReviewIssueKind,
  Row,
} from "./types";
import { modeOf, normalizeRows } from "./clean";
import { inferColumnType, isEmpty, median, quantile, round, toNumber } from "./stats";

export interface ReviewIssue {
  key: string;
  row: number; // index dans la feuille d'origine
  column: string;
  kind: ReviewIssueKind;
  value: CellValue;
  duplicate: boolean; // ligne qui sera retirée comme doublon
}

export interface ColumnSuggestions {
  numeric: boolean;
  mean?: number;
  median?: number;
  mode?: CellValue;
  low?: number; // bornes IQR
  high?: number;
}

export interface ReviewScan {
  issues: ReviewIssue[];
  columns: Record<string, ColumnSuggestions>;
  rows: Row[]; // valeurs normalisées (contexte affiché)
}

export const cellKey = (row: number, column: string) => `${row}\u0001${column}`;

export function scanForReview(dataset: Dataset, opts: CleaningOptions): ReviewScan {
  const { rows } = normalizeRows(dataset, opts);
  const k = opts.outlierThreshold || 1.5;
  const columns: Record<string, ColumnSuggestions> = {};

  // Doublons stricts (2e occurrence et suivantes), retirés par le pipeline.
  const duplicates = new Set<number>();
  if (opts.removeDuplicates) {
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const key = dataset.columns.map((c) => String(r[c] ?? "")).join("\u0001");
      if (seen.has(key)) duplicates.add(i);
      else seen.add(key);
    });
  }

  const issues: ReviewIssue[] = [];
  for (const c of dataset.columns) {
    const values = rows.map((r) => r[c]);
    const numeric = inferColumnType(values) === "number";
    const s: ColumnSuggestions = { numeric };
    if (numeric) {
      const nums = values.map((v) => (isEmpty(v) ? null : toNumber(v))).filter((v): v is number => v !== null);
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b);
        s.mean = round(nums.reduce((a, b) => a + b, 0) / nums.length, 4);
        s.median = round(median(nums), 4);
        if (sorted.length >= 4) {
          const q1 = quantile(sorted, 0.25);
          const q3 = quantile(sorted, 0.75);
          const iqr = q3 - q1;
          if (iqr > 0) {
            s.low = round(q1 - k * iqr, 4);
            s.high = round(q3 + k * iqr, 4);
          }
        }
      }
    }
    const m = modeOf(values);
    if (!isEmpty(m)) s.mode = m;
    columns[c] = s;

    values.forEach((v, i) => {
      if (isEmpty(v)) {
        issues.push({ key: cellKey(i, c), row: i, column: c, kind: "missing", value: null, duplicate: duplicates.has(i) });
        return;
      }
      if (s.low === undefined || s.high === undefined) return;
      const n = toNumber(v);
      if (n !== null && (n < s.low || n > s.high)) {
        issues.push({ key: cellKey(i, c), row: i, column: c, kind: "outlier", value: v, duplicate: duplicates.has(i) });
      }
    });
  }
  issues.sort((a, b) => a.row - b.row || dataset.columns.indexOf(a.column) - dataset.columns.indexOf(b.column));
  return { issues, columns, rows };
}

export function formatValue(v: CellValue | undefined): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "number") return v.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  if (typeof v === "boolean") return v ? "vrai" : "faux";
  return String(v);
}

// Ce que ferait le nettoyage automatique pour cette cellule, sans décision.
export function automaticOutcome(issue: ReviewIssue, s: ColumnSuggestions | undefined, opts: CleaningOptions): string {
  if (issue.duplicate) return "ligne retirée (doublon)";
  if (issue.kind === "missing") {
    switch (opts.missingStrategy) {
      case "none":
        return "restera vide";
      case "drop-rows":
        return "ligne supprimée";
      case "mean":
        return s?.numeric ? `moyenne (${formatValue(s.mean)})` : `valeur la plus fréquente (${formatValue(s?.mode)})`;
      case "median":
        return s?.numeric ? `médiane (${formatValue(s.median)})` : `valeur la plus fréquente (${formatValue(s?.mode)})`;
      case "mode":
        return `valeur la plus fréquente (${formatValue(s?.mode)})`;
      case "zero":
        return s?.numeric ? "0" : "texte vide";
      case "constant":
        return `« ${opts.missingConstant} »`;
    }
  }
  switch (opts.outlierStrategy) {
    case "none":
      return "conservée";
    case "remove":
      return "ligne supprimée";
    case "cap": {
      const n = toNumber(issue.value);
      const bound = n !== null && s?.high !== undefined && n > s.high ? s.high : s?.low;
      // Le pipeline recalcule les bornes après corrections et imputations :
      // la valeur affichée ici est indicative.
      return `plafonnée à la borne (≈ ${formatValue(bound)})`;
    }
  }
  return "";
}

// --- Mises à jour immuables de l'examen ---

export function setCellDecision(review: ManualReview, issue: ReviewIssue, decision: CellReview["decision"] | null, note?: string): ManualReview {
  const cells = review.cells.filter((c) => !(c.row === issue.row && c.column === issue.column));
  const removedRows = review.removedRows.filter((r) => r.row !== issue.row);
  if (decision) {
    const previous = review.cells.find((c) => c.row === issue.row && c.column === issue.column);
    cells.push({
      row: issue.row,
      column: issue.column,
      issue: issue.kind,
      original: issue.value,
      decision,
      note: note ?? previous?.note ?? "",
      decidedAt: new Date().toISOString(),
    });
  }
  // Une décision sur une cellule annule la suppression de sa ligne.
  return { cells, removedRows: decision ? removedRows : review.removedRows };
}

export function removeRow(review: ManualReview, row: number, note = ""): ManualReview {
  if (review.removedRows.some((r) => r.row === row)) return review;
  return {
    cells: review.cells,
    removedRows: [...review.removedRows, { row, note, decidedAt: new Date().toISOString() }],
  };
}

export function restoreRow(review: ManualReview, row: number): ManualReview {
  return { cells: review.cells, removedRows: review.removedRows.filter((r) => r.row !== row) };
}

export function setNote(review: ManualReview, issue: ReviewIssue, note: string): ManualReview {
  if (review.removedRows.some((r) => r.row === issue.row)) {
    return { cells: review.cells, removedRows: review.removedRows.map((r) => (r.row === issue.row ? { ...r, note } : r)) };
  }
  return {
    cells: review.cells.map((c) => (c.row === issue.row && c.column === issue.column ? { ...c, note } : c)),
    removedRows: review.removedRows,
  };
}
