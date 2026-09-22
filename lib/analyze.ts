import type {
  Analysis,
  ColumnAnalysis,
  Correlation,
  Dataset,
  DatasetProfile,
  HistogramBin,
} from "./types";
import { profileDataset } from "./profile";
import { isEmpty, pearson, round, toNumber } from "./stats";

function histogram(values: number[], bins = 10): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: format(min), count: values.length }];
  }
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return counts.map((count, i) => ({
    label: `${format(min + i * width)} – ${format(min + (i + 1) * width)}`,
    count,
  }));
}

function format(n: number): string {
  if (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01)) {
    return n.toExponential(2);
  }
  return String(round(n, 2));
}

export function computeCorrelations(
  dataset: Dataset,
  profile: DatasetProfile,
): Correlation[] {
  const numericCols = profile.columns
    .filter((c) => c.type === "number")
    .map((c) => c.name);

  const series = new Map<string, number[]>();
  for (const c of numericCols) {
    series.set(
      c,
      dataset.rows.map((r) => {
        const n = toNumber(r[c]);
        return n === null ? NaN : n;
      }),
    );
  }

  const out: Correlation[] = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i];
      const b = numericCols[j];
      const xs: number[] = [];
      const ys: number[] = [];
      const sa = series.get(a)!;
      const sb = series.get(b)!;
      for (let k = 0; k < sa.length; k++) {
        if (!Number.isNaN(sa[k]) && !Number.isNaN(sb[k])) {
          xs.push(sa[k]);
          ys.push(sb[k]);
        }
      }
      const r = pearson(xs, ys);
      if (Number.isFinite(r)) out.push({ a, b, r: round(r, 3) });
    }
  }
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
}

function buildColumnAnalyses(
  dataset: Dataset,
  profile: DatasetProfile,
): ColumnAnalysis[] {
  return profile.columns.map((col) => {
    if (col.type === "number") {
      const values = dataset.rows
        .map((r) => toNumber(r[col.name]))
        .filter((v): v is number => v !== null);
      return { name: col.name, type: col.type, histogram: histogram(values) };
    }
    const categories = (col.categorical?.top ?? []).map((t) => ({
      label: t.value,
      count: t.count,
    }));
    return { name: col.name, type: col.type, categories };
  });
}

// Génère des observations en langage naturel (français).
export function buildObservations(
  profile: DatasetProfile,
  correlations: Correlation[],
): string[] {
  const obs: string[] = [];

  obs.push(
    `Le jeu de données comporte ${profile.rowCount.toLocaleString("fr-FR")} ligne(s) et ${profile.columnCount} colonne(s).`,
  );

  if (profile.duplicateRows > 0) {
    obs.push(
      `${profile.duplicateRows} ligne(s) en double subsistent : envisagez la suppression des doublons.`,
    );
  } else {
    obs.push("Aucune ligne en double détectée.");
  }

  const cellsTotal = profile.rowCount * profile.columnCount;
  const missingPct = cellsTotal
    ? round((profile.totalMissing / cellsTotal) * 100, 1)
    : 0;
  if (profile.totalMissing > 0) {
    obs.push(
      `${profile.totalMissing.toLocaleString("fr-FR")} valeur(s) manquante(s) au total, soit ${missingPct}% des cellules.`,
    );
    const worst = [...profile.columns]
      .filter((c) => c.missing > 0)
      .sort((a, b) => b.missingPct - a.missingPct)
      .slice(0, 3);
    for (const c of worst) {
      obs.push(
        `La colonne « ${c.name} » présente ${c.missingPct}% de valeurs manquantes.`,
      );
    }
  } else {
    obs.push("Aucune valeur manquante : les données sont complètes.");
  }

  // Types de colonnes
  const numeric = profile.columns.filter((c) => c.type === "number");
  const categorical = profile.columns.filter(
    (c) => c.type === "string" || c.type === "boolean",
  );
  obs.push(
    `${numeric.length} colonne(s) numérique(s) et ${categorical.length} colonne(s) catégorielle(s)/textuelle(s).`,
  );

  // Outliers
  const withOutliers = numeric
    .filter((c) => (c.outliers ?? 0) > 0)
    .sort((a, b) => (b.outliers ?? 0) - (a.outliers ?? 0))
    .slice(0, 3);
  for (const c of withOutliers) {
    obs.push(
      `La colonne « ${c.name} » contient ${c.outliers} valeur(s) atypique(s) (méthode IQR).`,
    );
  }

  // Dispersion notable
  for (const c of numeric) {
    if (c.numeric && Number.isFinite(c.numeric.mean) && c.numeric.mean !== 0) {
      const cv = Math.abs(c.numeric.std / c.numeric.mean);
      if (cv > 1) {
        obs.push(
          `La colonne « ${c.name} » est très dispersée (coefficient de variation ≈ ${round(cv, 2)}).`,
        );
        break;
      }
    }
  }

  // Colonnes quasi constantes / identifiants
  for (const c of profile.columns) {
    if (c.count > 0 && c.unique === c.count && c.type !== "number") {
      obs.push(
        `La colonne « ${c.name} » a des valeurs toutes uniques : il s'agit probablement d'un identifiant.`,
      );
      break;
    }
  }

  // Corrélations fortes
  const strong = correlations.filter((c) => Math.abs(c.r) >= 0.7).slice(0, 3);
  for (const c of strong) {
    const sens = c.r > 0 ? "positive" : "négative";
    obs.push(
      `Corrélation ${sens} forte entre « ${c.a} » et « ${c.b} » (r = ${c.r}).`,
    );
  }

  return obs;
}

export function analyzeDataset(dataset: Dataset): Analysis {
  const profile = profileDataset(dataset);
  const correlations = computeCorrelations(dataset, profile);
  const columnAnalyses = buildColumnAnalyses(dataset, profile);
  const observations = buildObservations(profile, correlations);
  return { profile, correlations, columnAnalyses, observations };
}
