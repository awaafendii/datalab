import Papa from "papaparse";
import type { CellValue, Dataset, Row, SheetInput, WorkbookInput } from "./types";
import { resolveHeaders } from "./headers";

// Normalise une valeur brute issue du parsing.
function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim();
  if (s === "") return null;
  return s;
}

// Construit un Dataset à partir de lignes brutes (tableaux de cellules, sans
// hypothèse préalable sur la présence d'un en-tête). Utilisé aussi bien pour
// le CSV que pour l'Excel : c'est le seul endroit qui décide des colonnes.
function buildDatasetFromRows(rawRows: unknown[][], fileName: string): Dataset {
  const { headers, headerRowPresent } = resolveHeaders(rawRows);
  const dataRows = headerRowPresent ? rawRows.slice(1) : rawRows;

  // Dédoublonne les noms de colonnes identiques en gardant l'ordre d'origine.
  const seen = new Map<string, number>();
  const columns = headers.map((h) => {
    const base = h && h.trim() !== "" ? h : "Colonne";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const rows: Row[] = dataRows.map((r) => {
    const row: Row = {};
    columns.forEach((c, i) => {
      row[c] = normalizeCell(r[i]);
    });
    return row;
  });

  // Retire les lignes entièrement vides.
  const cleaned = rows.filter((r) => columns.some((c) => r[c] !== null));

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

// Lignes brutes (tableaux de cellules) d'une feuille d'un classeur déjà
// ouvert par SheetJS, sans hypothèse sur la présence d'un en-tête.
function rawRowsFromSheet(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet,
): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
}

// Lit uniquement la première feuille (conservé pour compatibilité).
export async function parseExcel(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<Dataset> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return buildDatasetFromRows(rawRowsFromSheet(XLSX, wb.Sheets[wb.SheetNames[0]]), fileName);
}

// Lit toutes les feuilles d'un classeur Excel. Les feuilles vides (sans
// colonne ou sans ligne exploitable — onglets de garde, feuilles masquées
// laissées vides, etc.) sont ignorées.
export async function parseExcelAllSheets(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<SheetInput[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheets: SheetInput[] = [];
  for (const sheetName of wb.SheetNames) {
    const dataset = buildDatasetFromRows(
      rawRowsFromSheet(XLSX, wb.Sheets[sheetName]),
      fileName,
    );
    if (dataset.columns.length > 0 && dataset.rows.length > 0) {
      sheets.push({ name: sheetName, dataset });
    }
  }
  return sheets;
}

// Lit un fichier utilisateur (CSV ou Excel) et renvoie ses feuilles. Un CSV
// produit toujours une seule feuille ; un classeur Excel peut en produire
// plusieurs, chacune traitée indépendamment en aval.
export async function parseFile(file: File): Promise<WorkbookInput> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    const dataset = parseCSV(text, file.name);
    return { fileName: file.name, sheets: [{ name: "Feuille 1", dataset }] };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const sheets = await parseExcelAllSheets(buffer, file.name);
    if (sheets.length === 0) {
      throw new Error("Aucune feuille exploitable dans ce classeur Excel.");
    }
    return { fileName: file.name, sheets };
  }
  throw new Error(
    "Format non supporté. Utilisez un fichier .csv, .xls ou .xlsx.",
  );
}
