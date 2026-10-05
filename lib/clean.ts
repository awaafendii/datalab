import type {
  CellReview,
  CellValue,
  CleaningOptions,
  CleaningResult,
  CleaningStep,
  Dataset,
  ManualLogEntry,
  ManualReview,
  Row,
} from "./types";
import { EMPTY_REVIEW } from "./types";
import {
  EMPTY_TOKENS,
  inferColumnType,
  isEmpty,
  median,
  quantile,
  toNumber,
} from "./stats";

function mode(values: CellValue[]): CellValue {
  const counts = new Map<string, { value: CellValue; count: number }>();
  for (const v of values) {
    if (isEmpty(v)) continue;
    const key = String(v);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { value: v, count: 1 });
  }
  let best: CellValue = null;
  let bestCount = -1;
  for (const { value, count } of counts.values()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export { mode as modeOf };

// Étapes 1 à 3 : espaces, marqueurs de vide, typage des nombres. L'examen
// manuel (lib/review.ts) travaille sur ces valeurs normalisées, avec les
// mêmes index de lignes que la feuille d'origine.
export function normalizeRows(
  input: Dataset,
  opts: CleaningOptions,
): { rows: Row[]; steps: CleaningStep[] } {
  const steps: CleaningStep[] = [];
  const rows: Row[] = input.rows.map((r) => ({ ...r }));
  const columns = input.columns;

  // 1. Trim des chaînes
  if (opts.trimStrings) {
    let trimmed = 0;
    for (const r of rows) {
      for (const c of columns) {
        const v = r[c];
        if (typeof v === "string") {
          const t = v.trim();
          if (t !== v) {
            r[c] = t;
            trimmed++;
          }
        }
      }
    }
    if (trimmed > 0)
      steps.push({
        label: "Espaces superflus supprimés",
        detail: `${trimmed} cellule(s) nettoyée(s)`,
      });
  }

  // 2. Standardisation des valeurs vides
  if (opts.standardizeEmpty) {
    let std = 0;
    for (const r of rows) {
      for (const c of columns) {
        const v = r[c];
        if (
          typeof v === "string" &&
          EMPTY_TOKENS.has(v.trim().toLowerCase()) &&
          v !== ""
        ) {
          r[c] = null;
          std++;
        }
      }
    }
    if (std > 0)
      steps.push({
        label: "Marqueurs de vide harmonisés",
        detail: `${std} valeur(s) (NA, N/A, -, …) converties en vide`,
      });
  }

  // 3. Coercition numérique des colonnes majoritairement numériques
  if (opts.coerceNumbers) {
    let coercedCols = 0;
    for (const c of columns) {
      const raw = rows.map((r) => r[c]);
      if (inferColumnType(raw) === "number") {
        let changed = false;
        for (const r of rows) {
          const v = r[c];
          if (isEmpty(v)) {
            r[c] = null;
            continue;
          }
          const n = toNumber(v);
          if (n !== null && typeof v !== "number") {
            r[c] = n;
            changed = true;
          }
        }
        if (changed) coercedCols++;
      }
    }
    if (coercedCols > 0)
      steps.push({
        label: "Colonnes numériques typées",
        detail: `${coercedCols} colonne(s) converties en nombres`,
      });
  }

  return { rows, steps };
}

// Libellé d'une décision manuelle pour le journal.
export function decisionLabel(d: CellReview): string {
  if (d.decision.action === "keep") {
    return d.issue === "missing" ? "Laissée vide" : "Valeur conservée";
  }
  if (d.decision.source) return `Remplacée par ${d.decision.source}`;
  if (isEmpty(d.decision.value)) return "Cellule vidée";
  return d.issue === "missing" ? "Valeur saisie" : "Valeur corrigée";
}

// Applique le pipeline de nettoyage et journalise chaque étape. Les
// décisions manuelles (`review`) sont appliquées juste après la
// normalisation et prévalent sur les traitements automatiques : une cellule
// décidée n'est ni imputée, ni plafonnée, ni cause de suppression de ligne.
export function cleanDataset(
  input: Dataset,
  opts: CleaningOptions,
  review: ManualReview = EMPTY_REVIEW,
): CleaningResult {
  const rowsBefore = input.rows.length;
  const columns = [...input.columns];
  const normalized = normalizeRows(input, opts);
  const steps = normalized.steps;
  let rows = normalized.rows;

  // 3 bis. Décisions manuelles
  const decided = new WeakMap<Row, Set<string>>();
  const isDecided = (r: Row, c: string) => decided.get(r)?.has(c) ?? false;
  const manualLog: ManualLogEntry[] = [];
  if (review.cells.length > 0 || review.removedRows.length > 0) {
    const known = new Set(columns);
    const numeric = new Set(columns.filter((c) => inferColumnType(rows.map((r) => r[c])) === "number"));
    const removed = new Set(review.removedRows.filter((x) => x.row >= 0 && x.row < rows.length).map((x) => x.row));
    let set = 0;
    let kept = 0;
    for (const d of review.cells) {
      const r = rows[d.row];
      if (!r || !known.has(d.column) || removed.has(d.row)) continue;
      const before = r[d.column];
      if (d.decision.action === "set") {
        let v = d.decision.value;
        if (typeof v === "string" && v.trim() === "") v = null;
        if (v !== null && numeric.has(d.column)) v = toNumber(v) ?? v;
        r[d.column] = v;
        set++;
      } else {
        kept++;
      }
      let s = decided.get(r);
      if (!s) decided.set(r, (s = new Set()));
      s.add(d.column);
      manualLog.push({
        row: d.row + 1,
        column: d.column,
        issue: d.issue,
        before,
        after: r[d.column],
        decision: decisionLabel(d),
        note: d.note,
      });
    }
    for (const x of review.removedRows) {
      if (!removed.has(x.row)) continue;
      manualLog.push({
        row: x.row + 1,
        column: "",
        issue: "row",
        before: null,
        after: null,
        decision: "Ligne supprimée",
        note: x.note,
      });
    }
    if (removed.size > 0) rows = rows.filter((_, i) => !removed.has(i));
    manualLog.sort((a, b) => a.row - b.row || a.column.localeCompare(b.column, "fr"));
    const parts = [
      set ? `${set} valeur(s) saisie(s) ou corrigée(s)` : "",
      kept ? `${kept} cellule(s) laissée(s) telle(s) quelle(s)` : "",
      removed.size ? `${removed.size} ligne(s) supprimée(s)` : "",
    ].filter(Boolean);
    if (parts.length) {
      steps.push({
        label: "Décisions manuelles appliquées",
        detail: `${parts.join(", ")} — elles prévalent sur les traitements automatiques.`,
      });
    }
  }

  // 4. Suppression des doublons
  if (opts.removeDuplicates) {
    const seen = new Set<string>();
    const before = rows.length;
    rows = rows.filter((r) => {
      const key = columns.map((c) => String(r[c] ?? "")).join("\u0001");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removed = before - rows.length;
    if (removed > 0)
      steps.push({
        label: "Doublons supprimés",
        detail: `${removed} ligne(s) en double retirée(s)`,
      });
  }

  // 5. Traitement des valeurs manquantes (hors cellules décidées)
  if (opts.missingStrategy !== "none") {
    if (opts.missingStrategy === "drop-rows") {
      const before = rows.length;
      rows = rows.filter((r) => columns.every((c) => !isEmpty(r[c]) || isDecided(r, c)));
      const removed = before - rows.length;
      if (removed > 0)
        steps.push({
          label: "Lignes incomplètes supprimées",
          detail: `${removed} ligne(s) contenant au moins un vide`,
        });
    } else {
      let imputed = 0;
      for (const c of columns) {
        const raw = rows.map((r) => r[c]);
        const type = inferColumnType(raw);
        let fill: CellValue = null;

        if (type === "number") {
          const nums = raw
            .map((v) => (isEmpty(v) ? null : toNumber(v)))
            .filter((v): v is number => v !== null);
          if (opts.missingStrategy === "mean")
            fill = nums.length
              ? nums.reduce((a, b) => a + b, 0) / nums.length
              : null;
          else if (opts.missingStrategy === "median")
            fill = nums.length ? median(nums) : null;
          else if (opts.missingStrategy === "zero") fill = 0;
          else if (opts.missingStrategy === "mode") fill = mode(raw);
          else if (opts.missingStrategy === "constant")
            fill = toNumber(opts.missingConstant) ?? opts.missingConstant;
        } else {
          if (opts.missingStrategy === "constant") fill = opts.missingConstant;
          else if (opts.missingStrategy === "zero") fill = "";
          else fill = mode(raw); // mean/median/mode -> mode pour le non numérique
        }

        if (fill === null) continue;
        for (const r of rows) {
          if (isEmpty(r[c]) && !isDecided(r, c)) {
            r[c] = fill;
            imputed++;
          }
        }
      }
      if (imputed > 0) {
        const labels: Record<string, string> = {
          mean: "moyenne (mode pour le texte)",
          median: "médiane (mode pour le texte)",
          mode: "valeur la plus fréquente",
          zero: "0 / vide",
          constant: `constante « ${opts.missingConstant} »`,
        };
        steps.push({
          label: "Valeurs manquantes imputées",
          detail: `${imputed} cellule(s) remplies par ${labels[opts.missingStrategy] ?? opts.missingStrategy}`,
        });
      }
    }
  }

  // 6. Traitement des outliers (IQR), hors cellules décidées
  if (opts.outlierStrategy !== "none") {
    const k = opts.outlierThreshold || 1.5;
    const numericCols = columns.filter(
      (c) => inferColumnType(rows.map((r) => r[c])) === "number",
    );
    const bounds = new Map<string, { low: number; high: number }>();
    for (const c of numericCols) {
      const nums = rows
        .map((r) => toNumber(r[c]))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      if (nums.length < 4) continue;
      const q1 = quantile(nums, 0.25);
      const q3 = quantile(nums, 0.75);
      const iqr = q3 - q1;
      if (iqr === 0) continue;
      bounds.set(c, { low: q1 - k * iqr, high: q3 + k * iqr });
    }

    if (opts.outlierStrategy === "remove") {
      const before = rows.length;
      rows = rows.filter((r) => {
        for (const [c, b] of bounds) {
          if (isDecided(r, c)) continue;
          const v = toNumber(r[c]);
          if (v !== null && (v < b.low || v > b.high)) return false;
        }
        return true;
      });
      const removed = before - rows.length;
      if (removed > 0)
        steps.push({
          label: "Lignes atypiques supprimées",
          detail: `${removed} ligne(s) hors bornes IQR (×${k})`,
        });
    } else if (opts.outlierStrategy === "cap") {
      let capped = 0;
      for (const r of rows) {
        for (const [c, b] of bounds) {
          if (isDecided(r, c)) continue;
          const v = toNumber(r[c]);
          if (v === null) continue;
          if (v < b.low) {
            r[c] = Math.round(b.low * 10000) / 10000;
            capped++;
          } else if (v > b.high) {
            r[c] = Math.round(b.high * 10000) / 10000;
            capped++;
          }
        }
      }
      if (capped > 0)
        steps.push({
          label: "Valeurs atypiques plafonnées",
          detail: `${capped} valeur(s) ramenées aux bornes IQR (×${k})`,
        });
    }
  }

  if (steps.length === 0)
    steps.push({
      label: "Aucune modification",
      detail: "Les données étaient déjà propres au regard des options choisies.",
    });

  return {
    dataset: { columns, rows, fileName: input.fileName },
    steps,
    rowsBefore,
    rowsAfter: rows.length,
    manualLog,
  };
}
