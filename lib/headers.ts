// Détecte si la première ligne d'une feuille est une ligne d'en-têtes, et
// génère des noms de colonnes plausibles quand ce n'est pas le cas. Opère
// sur des lignes brutes (tableaux de cellules), avant toute construction de
// Dataset — c'est le seul endroit qui doit encore deviner la structure.

import type { CellValue } from "./types";
import { looksLikeDate, toNumber } from "./stats";

export interface HeaderResolution {
  headers: string[];
  headerRowPresent: boolean; // false => les en-têtes ont été générés
}

// Pour chaque colonne, compare le type de la première cellule à celui des
// cellules suivantes : si la première cellule est du texte alors que la
// colonne est majoritairement numérique/date, c'est probablement un en-tête.
function looksLikeHeaderRow(firstRow: unknown[], dataRows: unknown[][]): boolean {
  if (firstRow.length === 0) return false;
  let votes = 0;
  let total = 0;

  for (let col = 0; col < firstRow.length; col++) {
    const headerCell = firstRow[col];
    const dataCells = dataRows
      .map((r) => r[col])
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (dataCells.length === 0) continue;
    total++;

    const headerIsNumeric = toNumber(headerCell as CellValue) !== null;
    const headerIsDate = looksLikeDate(headerCell as CellValue);
    const headerLooksTextual =
      !headerIsNumeric &&
      !headerIsDate &&
      typeof headerCell === "string" &&
      headerCell.trim() !== "";

    if (!headerLooksTextual) continue; // colonne muette sur la question

    const numericRatio =
      dataCells.filter((v) => toNumber(v as CellValue) !== null).length / dataCells.length;
    const dateRatio =
      dataCells.filter((v) => looksLikeDate(v as CellValue)).length / dataCells.length;

    votes += numericRatio > 0.6 || dateRatio > 0.6 ? 1 : 0.4;
  }

  if (total === 0) return true; // pas assez d'info : comportement historique (1ère ligne = en-tête)
  return votes / total >= 0.5;
}

// Nomme une colonne sans en-tête d'après le type dominant observé sur
// l'ensemble de ses valeurs (y compris la première ligne, ici une donnée
// comme une autre).
function syntheticName(values: unknown[], index: number): string {
  const nonEmpty = values.filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== "",
  );
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
 * `rows` : toutes les lignes brutes de la feuille (tableaux de cellules),
 * la première étant potentiellement une ligne d'en-têtes.
 */
export function resolveHeaders(rows: unknown[][]): HeaderResolution {
  if (rows.length === 0) return { headers: [], headerRowPresent: true };

  const firstRow = rows[0];
  const sample = rows.slice(1, 21); // échantillon suffisant, évite de tout scanner
  const present = looksLikeHeaderRow(firstRow, sample);

  if (present) {
    const headers = firstRow.map((h, i) =>
      h === null || h === undefined || String(h).trim() === ""
        ? `Colonne ${i + 1}`
        : String(h).trim(),
    );
    return { headers, headerRowPresent: true };
  }

  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const headers: string[] = [];
  for (let c = 0; c < colCount; c++) {
    headers.push(syntheticName(rows.map((r) => r[c]), c));
  }
  return { headers, headerRowPresent: false };
}
