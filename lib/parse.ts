import Papa from "papaparse";
import type { CellValue, Dataset, Row, SheetInput, WorkbookInput } from "./types";
import { isFilled, resolveHeaders } from "./headers";

// Formats lus en texte (PapaParse détecte le séparateur : virgule,
// point-virgule, tabulation, barre verticale).
const TEXT_EXTENSIONS = [".csv", ".tsv", ".txt"];
// Formats de classeur lus par SheetJS, y compris les classeurs à macros
// (.xlsm), les modèles (.xltx, .xltm), le binaire (.xlsb) et LibreOffice (.ods).
const WORKBOOK_EXTENSIONS = [".xlsx", ".xlsm", ".xlsb", ".xls", ".xltx", ".xltm", ".ods"];
export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...WORKBOOK_EXTENSIONS];

const NO_DATA_MESSAGE =
  "Le fichier ne contient aucune ligne de données exploitable (il est vide ou ne contient que des en-têtes).";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Les dates Excel arrivent de SheetJS sous forme d'objets Date (en heure
// locale). Sans conversion, elles deviendraient "Mon Jun 01 2026 00:00:00
// GMT+0000 (temps universel coordonné)" : illisibles et typées comme du
// texte. On les écrit au format ISO, que le typage reconnaît comme date.
function formatDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // Cellule heure seule : Excel la stocke au 30/12/1899.
  if (d.getFullYear() < 1900) return time;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return date;
  return `${date} ${time}`;
}

// Normalise une valeur brute issue du parsing.
function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim();
  if (s === "") return null;
  return s;
}

// Une ligne de données qui répète la ligne d'en-têtes (tableaux empilés,
// exports paginés) n'est pas une donnée.
function isRepeatedHeader(r: Row, columns: string[], baseNames: string[]): boolean {
  const filled = columns.map((c, i) => [r[c], baseNames[i]] as const).filter(([v]) => v !== null);
  if (filled.length < Math.min(2, columns.length)) return false;
  return filled.every(([v, name]) => String(v).trim().toLowerCase() === name.toLowerCase());
}

// Ligne "vierge prête à l'emploi" : beaucoup de modèles Excel recopient à
// l'avance les formules sur des dizaines de lignes vides, qui n'affichent
// alors que des 0 (ex. =B9*C9). Ce ne sont pas des enregistrements : gardées,
// elles deviendraient de fausses lignes que le nettoyage compléterait.
function isFormulaResidue(r: Row, columns: string[]): boolean {
  if (columns.length < 2) return false;
  const filled = columns.map((c) => r[c]).filter((v) => v !== null);
  return filled.length > 0 && filled.length < columns.length / 2 && filled.every((v) => v === 0);
}

// Construit un Dataset à partir de lignes brutes (tableaux de cellules, sans
// hypothèse préalable sur la présence d'un en-tête). Utilisé aussi bien pour
// le CSV que pour l'Excel : c'est le seul endroit qui décide des colonnes.
function buildDatasetFromRows(rawRows: unknown[][], fileName: string): Dataset {
  const { headers, placeholder, headerRowPresent, dataStartIndex } = resolveHeaders(rawRows);
  // Les lignes avant dataStartIndex (titres, sous-titres, tuiles de KPI de
  // tableau de bord…) sont écartées : ce ne sont pas des données.
  const dataRows = rawRows.slice(dataStartIndex);

  // Une colonne sans libellé ET sans aucune donnée n'est qu'un artefact de
  // mise en page (colonne de séparation, largeur de feuille) : on l'écarte.
  const kept = headers
    .map((_, i) => i)
    .filter((i) => !placeholder[i] || dataRows.some((r) => isFilled(r[i])));

  // Dédoublonne les noms de colonnes identiques en gardant l'ordre d'origine.
  const baseNames = kept.map((i) => headers[i]);
  const seen = new Map<string, number>();
  const columns = baseNames.map((base) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const rows: Row[] = dataRows.map((r) => {
    const row: Row = {};
    kept.forEach((srcIndex, j) => {
      row[columns[j]] = normalizeCell(r[srcIndex]);
    });
    return row;
  });

  // Retire les lignes entièrement vides et les en-têtes répétés.
  const cleaned = rows.filter(
    (r) => columns.some((c) => r[c] !== null) && !isRepeatedHeader(r, columns, baseNames),
  );
  // Les lignes vierges à formules sont toujours en bas du tableau : on ne
  // retire que ce bloc final, une ligne de zéros au milieu reste une donnée.
  while (cleaned.length > 0 && isFormulaResidue(cleaned[cleaned.length - 1], columns)) {
    cleaned.pop();
  }

  return {
    columns,
    rows: cleaned,
    fileName,
    headerInferred: !headerRowPresent,
  };
}

export function parseCSV(text: string, fileName: string): Dataset {
  const res = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: true,
  });
  return buildDatasetFromRows(res.data, fileName);
}

// Décode un fichier texte. Excel en français enregistre ses CSV en
// Windows-1252 (et non en UTF-8) : décodés en UTF-8, les accents
// deviendraient "Cat�gorie". On tente l'UTF-8 strict (qui retire aussi le
// BOM éventuel), puis on se replie sur Windows-1252.
function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// Lignes brutes (tableaux de cellules) d'une feuille d'un classeur déjà
// ouvert par SheetJS, sans hypothèse sur la présence d'un en-tête.
// `defval: null` évite les tableaux creux (cellules vides manquantes), et les
// dates sont converties avant la détection d'en-têtes pour qu'elle les
// reconnaisse comme telles.
function rawRowsFromSheet(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet | undefined,
): unknown[][] {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  return rows.map((r) => r.map((c) => (c instanceof Date ? formatDate(c) : c)));
}

async function openWorkbook(buffer: ArrayBuffer) {
  const XLSX = await import("xlsx");
  try {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    return { XLSX, wb };
  } catch (e) {
    throw new Error(
      "Impossible de lire ce classeur : il est peut-être protégé par un mot de passe, " +
        `endommagé, ou d'un format non pris en charge (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
}

// Lit uniquement la première feuille (conservé pour compatibilité).
export async function parseExcel(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<Dataset> {
  const { XLSX, wb } = await openWorkbook(buffer);
  return buildDatasetFromRows(rawRowsFromSheet(XLSX, wb.Sheets[wb.SheetNames[0]]), fileName);
}

// En dessous de cette moyenne de cellules remplies par ligne, une feuille
// n'est pas un tableau de données exploitable — plutôt une page d'accueil,
// un tableau de bord visuel ou une fiche de paramètres (quelques libellés
// épars, pas des enregistrements répétés). Calibré sur des classeurs Excel
// réels : les feuilles décoratives tournent autour de 0,4 à 1,4 en moyenne,
// les vraies tables de données au-delà de 3 dès qu'on a retiré les lignes
// de titre grâce à resolveHeaders.
const MAX_AVG_FILLED_PER_ROW = 2.5;
// Un tableau à 1 ou 2 colonnes, même rempli à 100%, ne peut jamais atteindre
// 2,5 cellules remplies par ligne : le seuil est borné à ~60% de la largeur
// réelle du tableau pour ne pas rejeter à tort les tableaux étroits.
const MIN_FILL_RATIO = 0.6;

function looksTabular(dataset: Dataset): boolean {
  if (dataset.columns.length === 0 || dataset.rows.length === 0) return false;
  const totalFilled = dataset.rows.reduce(
    (sum, r) => sum + dataset.columns.filter((c) => r[c] !== null).length,
    0,
  );
  const threshold = Math.min(MAX_AVG_FILLED_PER_ROW, dataset.columns.length * MIN_FILL_RATIO);
  return totalFilled / dataset.rows.length >= threshold;
}

// Lit toutes les feuilles d'un classeur. Les feuilles vides ou non
// tabulaires (onglets de garde, pages d'accueil, tableaux de bord visuels,
// fiches de paramètres…) sont écartées — mais jamais toutes. Par ordre de
// préférence :
//   1. les feuilles denses ET dotées d'une vraie ligne d'en-têtes. Dans un
//      classeur qui organise ses données en tableaux titrés, une feuille sans
//      en-têtes est une feuille de présentation : un tableau de bord dont les
//      formules ont leurs valeurs en cache peut être aussi dense qu'une table ;
//   2. à défaut (export sans en-têtes), les feuilles denses ;
//   3. à défaut (tableau très clairsemé), toutes celles qui ont des données,
//      plutôt que de refuser le fichier.
export async function parseExcelAllSheets(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ sheets: SheetInput[]; skippedSheets: string[] }> {
  const { XLSX, wb } = await openWorkbook(buffer);
  const withData: SheetInput[] = [];
  for (const sheetName of wb.SheetNames) {
    const dataset = buildDatasetFromRows(rawRowsFromSheet(XLSX, wb.Sheets[sheetName]), fileName);
    if (dataset.columns.length > 0 && dataset.rows.length > 0) {
      withData.push({ name: sheetName, dataset });
    }
  }
  const tabular = withData.filter((s) => looksTabular(s.dataset));
  const titled = tabular.filter((s) => !s.dataset.headerInferred);
  const sheets = titled.length > 0 ? titled : tabular.length > 0 ? tabular : withData;
  const kept = new Set(sheets.map((s) => s.name));
  return { sheets, skippedSheets: wb.SheetNames.filter((n) => !kept.has(n)) };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

// Lit un fichier utilisateur (CSV ou classeur) et renvoie ses feuilles. Un CSV
// produit toujours une seule feuille ; un classeur peut en produire
// plusieurs, chacune traitée indépendamment en aval.
export async function parseFile(file: File): Promise<WorkbookInput> {
  const ext = extensionOf(file.name);
  if (TEXT_EXTENSIONS.includes(ext)) {
    const dataset = parseCSV(decodeText(await file.arrayBuffer()), file.name);
    if (dataset.rows.length === 0) throw new Error(NO_DATA_MESSAGE);
    return { fileName: file.name, sheets: [{ name: "Feuille 1", dataset }], skippedSheets: [] };
  }
  if (WORKBOOK_EXTENSIONS.includes(ext)) {
    const { sheets, skippedSheets } = await parseExcelAllSheets(await file.arrayBuffer(), file.name);
    if (sheets.length === 0) throw new Error(NO_DATA_MESSAGE);
    return { fileName: file.name, sheets, skippedSheets };
  }
  throw new Error(
    `Format non supporté${ext ? ` (${ext})` : ""}. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(", ")}.`,
  );
}
