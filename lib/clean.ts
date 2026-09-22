import type {
  CellValue,
  CleaningOptions,
  CleaningResult,
  CleaningStep,
  Dataset,
  Row,
} from "./types";
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

// Applique le pipeline de nettoyage et journalise chaque étape.
export function cleanDataset(
  input: Dataset,
  opts: CleaningOptions,
): CleaningResult {
  const steps: CleaningStep[] = [];
  const rowsBefore = input.rows.length;
  let rows: Row[] = input.rows.map((r) => ({ ...r }));
  const columns = [...input.columns];

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

  // 5. Traitement des valeurs manquantes
  if (opts.missingStrategy !== "none") {
    if (opts.missingStrategy === "drop-rows") {
      const before = rows.length;
      rows = rows.filter((r) => columns.every((c) => !isEmpty(r[c])));
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
          if (isEmpty(r[c])) {
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

  // 6. Traitement des outliers (IQR)
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
  };
}
