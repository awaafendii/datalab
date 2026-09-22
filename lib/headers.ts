// Détecte la vraie ligne d'en-têtes d'une feuille, même quand elle n'est pas
// en première position (titres, sous-titres, tuiles de KPI de tableau de
// bord au-dessus du tableau réel — très courant dans les classeurs Excel
// "métier"). Génère des noms de colonnes plausibles quand aucune ligne
// d'en-têtes n'est trouvée. Opère sur des lignes brutes (tableaux de
// cellules), avant toute construction de Dataset.

import type { CellValue } from "./types";
import { looksLikeDate, toNumber } from "./stats";

export interface HeaderResolution {
  headers: string[];
  headerRowPresent: boolean; // false => les en-têtes ont été générés
  // Index (dans `rows`) où commencent les données réelles. Les lignes
  // avant cet index (titres, sous-titres, tuiles de KPI…) sont écartées.
  dataStartIndex: number;
}

const MAX_HEADER_SCAN = 25; // au-delà, on suppose que la feuille n'a pas de bloc d'en-tête décalé
const MIN_HEADER_RUN = 3; // cellules adjacentes remplies minimum pour ressembler à une ligne d'en-têtes
const SAMPLE_SIZE = 20;

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

// Plus longue série de cellules adjacentes remplies. Une vraie ligne
// d'en-têtes de tableau a ses libellés côte à côte ; une ligne de titre ou
// de tuiles de KPI de tableau de bord n'a que quelques cellules isolées,
// espacées (ex. des cellules fusionnées tous les 5 colonnes).
function maxContiguousFilled(row: unknown[]): number {
  let best = 0;
  let current = 0;
  for (const cell of row) {
    current = isFilled(cell) ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

// Score 0..1 : pour chaque colonne, compare le type de la cellule candidate
// à celui des cellules de données qui suivent. Une cellule candidate
// textuelle suivie d'une colonne majoritairement numérique/date est un
// signal fort d'en-tête. Renvoie 0.5 (neutre) s'il n'y a aucune colonne
// exploitable pour trancher.
function headerScore(candidate: unknown[], dataRows: unknown[][]): number {
  let votes = 0;
  let total = 0;

  for (let col = 0; col < candidate.length; col++) {
    const headerCell = candidate[col];
    const dataCells = dataRows.map((r) => r[col]).filter(isFilled);
    if (dataCells.length === 0) continue;
    total++;

    const headerIsNumeric = toNumber(headerCell as CellValue) !== null;
    const headerIsDate = looksLikeDate(headerCell as CellValue);
    const headerLooksTextual =
      !headerIsNumeric &&
      !headerIsDate &&
      typeof headerCell === "string" &&
      headerCell.trim() !== "";

    if (!headerLooksTextual) continue;

    const numericRatio =
      dataCells.filter((v) => toNumber(v as CellValue) !== null).length / dataCells.length;
    const dateRatio =
      dataCells.filter((v) => looksLikeDate(v as CellValue)).length / dataCells.length;

    votes += numericRatio > 0.6 || dateRatio > 0.6 ? 1 : 0.4;
  }

  if (total === 0) return 0.5;
  return votes / total;
}

function syntheticName(values: unknown[], index: number): string {
  const nonEmpty = values.filter(isFilled);
  if (nonEmpty.length === 0) return `Colonne ${index + 1}`;

  const dateRatio =
    nonEmpty.filter((v) => looksLikeDate(v as CellValue)).length / nonEmpty.length;
  if (dateRatio > 0.6) return `Date ${index + 1}`;

  const numRatio =
    nonEmpty.filter((v) => toNumber(v as CellValue) !== null).length / nonEmpty.length;
  if (numRatio > 0.6) return `Valeur ${index + 1}`;

  return `Texte ${index + 1}`;
}

/**
 * `rows` : toutes les lignes brutes de la feuille (tableaux de cellules).
 * La ligne d'en-têtes n'est pas supposée être la première : on scanne les
 * premières lignes à la recherche du meilleur candidat (cellules adjacentes
 * remplies + contraste de type avec les données qui suivent), pour ignorer
 * les titres, sous-titres et tuiles de KPI que contiennent beaucoup de
 * classeurs Excel réels avant le vrai tableau.
 */
export function resolveHeaders(rows: unknown[][]): HeaderResolution {
  if (rows.length === 0) return { headers: [], headerRowPresent: true, dataStartIndex: 0 };

  const scanLimit = Math.min(MAX_HEADER_SCAN, rows.length - 1);
  let best: { index: number; score: number } | null = null;

  for (let h = 0; h <= scanLimit; h++) {
    const row = rows[h];
    if (maxContiguousFilled(row) < MIN_HEADER_RUN) continue;

    const after = rows.slice(h + 1, h + 1 + SAMPLE_SIZE);
    const hasFollowingData = after.some((r) => r.some(isFilled));
    if (!hasFollowingData) continue;

    const score = headerScore(row, after);
    if (!best || score > best.score) best = { index: h, score };
  }

  if (best && best.score >= 0.5) {
    const headerRow = rows[best.index];
    const headers = headerRow.map((h, i) =>
      isFilled(h) ? String(h).trim() : `Colonne ${i + 1}`,
    );
    return { headers, headerRowPresent: true, dataStartIndex: best.index + 1 };
  }

  // Aucune ligne d'en-têtes plausible : on nomme chaque colonne d'après le
  // type dominant observé sur l'ensemble de ses valeurs.
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const headers: string[] = [];
  for (let c = 0; c < colCount; c++) {
    headers.push(syntheticName(rows.map((r) => r[c]), c));
  }
  return { headers, headerRowPresent: false, dataStartIndex: 0 };
}
