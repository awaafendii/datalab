// Détecte la vraie ligne d'en-têtes d'une feuille, même quand elle n'est pas
// en première position (titres, sous-titres, tuiles de KPI de tableau de
// bord au-dessus du tableau réel — très courant dans les classeurs Excel
// "métier"). Génère des noms de colonnes plausibles quand aucune ligne
// d'en-têtes n'est trouvée. Opère sur des lignes brutes (tableaux de
// cellules), avant toute construction de Dataset.

import type { CellValue } from "./types";
import { looksLikeDate, toNumber } from "./stats";

export interface HeaderResolution {
  // Un nom par colonne, sur toute la largeur du tableau (y compris les
  // colonnes présentes dans les données mais absentes de la ligne d'en-têtes).
  headers: string[];
  // true quand le nom est un bouche-trou ("Colonne 7", "Valeur 3"…) et non
  // un libellé lu dans le fichier : une telle colonne, si elle est aussi
  // vide de données, n'est qu'un artefact de mise en page à écarter.
  placeholder: boolean[];
  headerRowPresent: boolean; // false => les en-têtes ont été générés
  // Index (dans `rows`) où commencent les données réelles. Les lignes
  // avant cet index (titres, sous-titres, tuiles de KPI…) sont écartées.
  dataStartIndex: number;
}

const MAX_HEADER_SCAN = 25; // au-delà, on suppose que la feuille n'a pas de bloc d'en-tête décalé
const MIN_HEADER_RUN = 3; // cellules adjacentes remplies minimum pour ressembler à une ligne d'en-têtes
const SAMPLE_SIZE = 20;

export function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

// Libellés lus sur une ligne d'en-têtes, étendus à toute la largeur du
// tableau (une ligne d'en-têtes plus courte que les données laisse des
// colonnes sans libellé, qu'on nomme "Colonne N").
function headersFromRow(
  headerRow: unknown[],
  colCount: number,
): Pick<HeaderResolution, "headers" | "placeholder"> {
  const headers: string[] = [];
  const placeholder: boolean[] = [];
  for (let i = 0; i < colCount; i++) {
    const h = headerRow[i];
    const real = isFilled(h);
    headers.push(real ? String(h).trim() : `Colonne ${i + 1}`);
    placeholder.push(!real);
  }
  return { headers, placeholder };
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
// à celui des cellules de données qui suivent.
//   - Cellule candidate numérique/date : signal CONTRE l'hypothèse en-tête
//     (une vraie ligne d'en-têtes n'a normalement que des libellés texte).
//   - Cellule candidate textuelle suivie d'une colonne majoritairement
//     numérique/date : signal FORT POUR.
//   - Cellule candidate textuelle suivie d'une colonne elle-même textuelle :
//     ambigu — une colonne de libellés texte est aussi plausible dans une
//     vraie ligne d'en-têtes que dans une ligne de données ordinaire, donc
//     on l'ignore plutôt que de pénaliser (sans quoi un tableau entièrement
//     textuel ne pourrait jamais atteindre le seuil de confiance).
// Renvoie 0.5 (neutre) s'il n'y a aucune colonne exploitable pour trancher.
function headerScore(candidate: unknown[], dataRows: unknown[][]): number {
  let votes = 0;
  let total = 0;

  for (let col = 0; col < candidate.length; col++) {
    const headerCell = candidate[col];
    const dataCells = dataRows.map((r) => r[col]).filter(isFilled);
    if (dataCells.length === 0) continue;

    const headerIsNumeric = toNumber(headerCell as CellValue) !== null;
    const headerIsDate = looksLikeDate(headerCell as CellValue);
    if (headerIsNumeric || headerIsDate) {
      total++; // compte contre le score, sans vote
      continue;
    }
    if (typeof headerCell !== "string" || headerCell.trim() === "") continue;

    const numericRatio =
      dataCells.filter((v) => toNumber(v as CellValue) !== null).length / dataCells.length;
    const dateRatio =
      dataCells.filter((v) => looksLikeDate(v as CellValue)).length / dataCells.length;

    if (numericRatio > 0.6 || dateRatio > 0.6) {
      total++;
      votes++;
    }
    // sinon : colonne texte-sur-texte, ignorée (ni pour ni contre)
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
  if (rows.length === 0) {
    return { headers: [], placeholder: [], headerRowPresent: true, dataStartIndex: 0 };
  }

  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  // Un tableau étroit (1-2 colonnes) ne peut jamais avoir 3 cellules
  // adjacentes remplies : exiger MIN_HEADER_RUN dans l'absolu écarterait sa
  // ligne d'en-têtes à coup sûr. On borne l'exigence à la largeur réelle du
  // tableau — elle ne redescend sous 3 que pour les tableaux qui ont
  // effectivement moins de 3 colonnes.
  const minRun = Math.min(MIN_HEADER_RUN, colCount);

  const scanLimit = Math.min(MAX_HEADER_SCAN, rows.length - 1);
  let best: { index: number; score: number } | null = null;
  let firstCandidate = -1; // repli si aucune ligne suivante n'a de données

  for (let h = 0; h <= scanLimit; h++) {
    const row = rows[h];
    if (maxContiguousFilled(row) < minRun) continue;
    if (firstCandidate === -1) firstCandidate = h;

    const after = rows.slice(h + 1, h + 1 + SAMPLE_SIZE);
    // Un candidat sans aucune ligne remplie après lui (ex. la toute
    // dernière ligne de la feuille) obtiendrait un score neutre par défaut
    // et l'emporterait artificiellement sur un vrai en-tête suivi de
    // données ambiguës (texte pur) : on l'écarte du calcul de score, mais
    // il reste éligible au repli ci-dessous si rien d'autre n'est trouvé.
    if (!after.some((r) => r.some(isFilled))) continue;

    const score = headerScore(row, after);
    if (!best || score > best.score) best = { index: h, score };
  }

  if (best && best.score >= 0.5) {
    return {
      ...headersFromRow(rows[best.index], colCount),
      headerRowPresent: true,
      dataStartIndex: best.index + 1,
    };
  }

  if (best === null && firstCandidate !== -1) {
    // Aucun candidat n'avait de données après lui (fichier gabarit avec
    // uniquement une ligne d'en-têtes, par exemple) : on prend la première
    // ligne suffisamment large plutôt que de la traiter comme une donnée.
    return {
      ...headersFromRow(rows[firstCandidate], colCount),
      headerRowPresent: true,
      dataStartIndex: firstCandidate + 1,
    };
  }

  // Aucune ligne d'en-têtes plausible : on nomme chaque colonne d'après le
  // type dominant observé sur l'ensemble de ses valeurs. Tous ces noms sont
  // générés, donc marqués comme bouche-trous.
  const headers: string[] = [];
  for (let c = 0; c < colCount; c++) {
    headers.push(syntheticName(rows.map((r) => r[c]), c));
  }
  return {
    headers,
    placeholder: headers.map(() => true),
    headerRowPresent: false,
    dataStartIndex: 0,
  };
}
