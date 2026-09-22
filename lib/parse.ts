import Papa from "papaparse";
import type { CellValue, Dataset, Row, SheetInput, WorkbookInput } from "./types";

// Normalise une valeur brute issue du parsing.
function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim();
  if (s === "") return null;
  return s;
}

function buildDataset(
  rawRows: Record<string, unknown>[],
  fileName: string,
  headerOrder?: string[],
): Dataset {
  const columnSet = new Set<string>();
  if (headerOrder) headerOrder.forEach((h) => columnSet.add(h));
  rawRows.forEach((r) => Object.keys(r).forEach((k) => columnSet.add(k)));
  const columns = Array.from(columnSet).filter((c) => c !== "" && c != null);

  const rows: Row[] = rawRows.map((r) => {
    const row: Row = {};
    for (const c of columns) row[c] = normalizeCell(r[c]);
    return row;
  });

  // Retire les lignes entièrement vides.
  const cleaned = rows.filter((r) => columns.some((c) => r[c] !== null));

  return { columns, rows: cleaned, fileName };
}

export function parseCSV(text: string, fileName: string): Dataset {
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: true,
    transformHeader: (h) => h.trim(),
  });
  const headerOrder = res.meta.fields ?? undefined;
  return buildDataset(res.data, fileName, headerOrder);
}

// Lit une feuille précise d'un classeur déjà ouvert par SheetJS.
function datasetFromSheet(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet,
  fileName: string,
): Dataset {
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  // Récupère l'ordre des colonnes depuis la première ligne d'en-tête.
  const headerJson = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
  });
  const headerOrder = Array.isArray(headerJson[0])
    ? (headerJson[0] as unknown[]).map((h) => String(h).trim())
    : undefined;
  return buildDataset(json, fileName, headerOrder);
}

// Lit uniquement la première feuille (conservé pour compatibilité).
export async function parseExcel(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<Dataset> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return datasetFromSheet(XLSX, wb.Sheets[wb.SheetNames[0]], fileName);
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
    const dataset = datasetFromSheet(XLSX, wb.Sheets[sheetName], fileName);
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
