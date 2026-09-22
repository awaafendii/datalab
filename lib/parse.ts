import Papa from "papaparse";
import type { CellValue, Dataset, Row } from "./types";

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

export async function parseExcel(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<Dataset> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
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

export async function parseFile(file: File): Promise<Dataset> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    return parseCSV(text, file.name);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    return parseExcel(buffer, file.name);
  }
  throw new Error(
    "Format non supporté. Utilisez un fichier .csv, .xls ou .xlsx.",
  );
}
