import type { Analysis, Dataset, ManualLogEntry } from "./types";
import type { ChartTable, ExcelCell, ExcelChartExport } from "./charts/excel-types";
import { parseDate } from "./charts/data";
import { loadSaveAs } from "./save-file";
import { addDrawings, colLetter, type DrawingItem } from "./xlsx-drawings";

// Graphique personnalisé prêt pour Excel : tableau de données, graphique
// natif (modifiable) ou, à défaut, image PNG.
export interface ExcelChartInput {
  title: string;
  typeLabel: string;
  excel: ExcelChartExport;
  image?: Uint8Array; // PNG (types non disponibles nativement dans Excel)
  imageWidth?: number; // dimensions de l'image en pixels
  imageHeight?: number;
  height: number; // hauteur du graphique à l'écran (px)
}

// Une feuille prête à l'export : données nettoyées + analyse correspondante.
export interface ExportSheet {
  name: string;
  dataset: Dataset;
  analysis: Analysis;
  manualLog?: ManualLogEntry[]; // décisions manuelles de nettoyage
  excelCharts?: ExcelChartInput[]; // graphiques personnalisés
}

type ExcelJSModule = typeof import("exceljs");
type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;

const HEADER_STYLE = "TableStyleMedium2";
const CHART_TABLE_STYLE = "TableStyleLight9";
const ROW_PX = 20; // hauteur d'une ligne par défaut (15 pt)

// Nettoie un nom pour respecter les contraintes Excel (31 caractères max,
// caractères [ ] : \ / ? * interdits) et évite les doublons entre onglets.
function safeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:\\/?*]/g, " ").replace(/^'+|'+$/g, "").trim();
  if (!name) name = "Feuille";
  if (name.length > 31) name = name.slice(0, 31);

  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// Nom de tableau Excel : lettres, chiffres et « _ », unique dans le classeur.
function safeTableName(raw: string, used: Set<string>): string {
  const base =
    "T_" +
    (raw
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "Tableau");
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

// En-têtes non vides et uniques (exigence des tableaux Excel).
function headers(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = String(raw ?? "").trim() || "Colonne";
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function display(v: ExcelCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "00/00/0000";
  if (typeof v === "number") return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return String(v);
}

// Format numérique d'une colonne : séparateur de milliers pour les entiers,
// « Standard » pour les décimaux (pas de zéros superflus).
function numberFormat(values: ExcelCell[]): string | undefined {
  let numbers = 0;
  let integers = true;
  let max = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    numbers++;
    if (!Number.isInteger(v)) integers = false;
    max = Math.max(max, Math.abs(v));
  }
  if (numbers === 0) return undefined;
  return integers && max >= 1000 ? "#,##0" : undefined;
}

// ExcelJS convertit les dates en temps UTC : on lui passe l'heure locale
// « telle qu'affichée » pour éviter un décalage d'un jour hors fuseau UTC.
function wallClock(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

function hasTime(d: Date): boolean {
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

const MAX_TEXT = 32767; // longueur maximale d'une cellule Excel

function cellValue(v: ExcelCell | undefined): ExcelCell {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return wallClock(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.length > MAX_TEXT) return v.slice(0, MAX_TEXT);
  return v;
}

interface TableOptions {
  name: string;
  row: number; // ligne d'en-tête (1 = première)
  col?: number; // colonne de départ (1 = A)
  columns: string[];
  rows: ExcelCell[][];
  style?: string;
  numFmts?: (string | undefined)[]; // format par colonne (sinon automatique)
  colorScale?: ChartTable["colorScale"];
  perCellFormats?: boolean; // tableaux partageant des colonnes (onglet Graphiques)
}

// Ajoute un tableau Excel (filtres, lignes à bandes, en-tête stylé) et
// applique formats de nombres et de dates.
function addTable(ws: Worksheet, usedTables: Set<string>, o: TableOptions): { columns: string[] } {
  const col = o.col ?? 1;
  const columns = headers(o.columns);
  const width = columns.length;
  if (o.rows.length === 0) {
    columns.forEach((h, j) => {
      const cell = ws.getCell(o.row, col + j);
      cell.value = h;
      cell.font = { bold: true };
    });
    ws.getCell(o.row + 1, col).value = "(aucune donnée)";
    return { columns };
  }
  const rows = o.rows.map((r) => columns.map((_, j) => cellValue(r[j])));
  ws.addTable({
    name: safeTableName(o.name, usedTables),
    ref: `${colLetter(col)}${o.row}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: (o.style ?? HEADER_STYLE) as "TableStyleMedium2", showRowStripes: true },
    columns: columns.map((name) => ({ name, filterButton: true })),
    rows,
  });
  for (let j = 0; j < width; j++) {
    const values = rows.map((r) => r[j]);
    const dates = values.some((v) => v instanceof Date);
    const fmt = dates
      ? values.some((v) => v instanceof Date && hasTime(v))
        ? "dd/mm/yyyy hh:mm"
        : "dd/mm/yyyy"
      : (o.numFmts?.[j] ?? numberFormat(values));
    if (!fmt) continue;
    if (o.perCellFormats) {
      for (let i = 0; i < rows.length; i++) ws.getCell(o.row + 1 + i, col + j).numFmt = fmt;
    } else {
      ws.getColumn(col + j).numFmt = fmt;
    }
  }
  if (o.colorScale) {
    const c = o.colorScale.colors.map((x) => ({ argb: "FF" + x.replace("#", "").toUpperCase() }));
    const first = `${colLetter(col + 1)}${o.row + 1}`;
    const last = `${colLetter(col + width - 1)}${o.row + rows.length}`;
    ws.addConditionalFormatting({
      ref: `${first}:${last}`,
      rules: [
        {
          type: "colorScale",
          priority: 1,
          cfvo: [
            o.colorScale.min !== undefined ? { type: "num", value: o.colorScale.min } : { type: "min" },
            o.colorScale.mid !== undefined ? { type: "num", value: o.colorScale.mid } : { type: "percentile", value: 50 },
            o.colorScale.max !== undefined ? { type: "num", value: o.colorScale.max } : { type: "max" },
          ],
          color: c,
        },
      ],
    });
  }
  return { columns };
}

// Largeurs de colonnes d'après le contenu (200 premières lignes).
function fitColumns(ws: Worksheet, columns: string[], rows: ExcelCell[][], startCol = 1, min = 8, max = 50) {
  columns.forEach((h, j) => {
    let w = h.length + 4; // place du bouton de filtre
    for (const r of rows.slice(0, 200)) w = Math.max(w, display(r[j] ?? null).length + 2);
    const column = ws.getColumn(startCol + j);
    column.width = Math.max(column.width ?? 0, Math.min(max, Math.max(min, w)));
  });
}

// Données nettoyées : nombres, dates réelles (colonnes de type date) et texte.
function dataRows(s: ExportSheet): ExcelCell[][] {
  const types = new Map(s.analysis.profile.columns.map((c) => [c.name, c.type]));
  return s.dataset.rows.map((r) =>
    s.dataset.columns.map((c) => {
      const v = r[c];
      if (v === undefined || v === null || v === "") return null;
      if (types.get(c) === "date" && typeof v === "string") return parseDate(v) ?? v;
      return v;
    }),
  );
}

// Onglet « Graphiques » : pour chaque graphique, titre, tableau de données et
// graphique Excel natif (ou image) à droite du tableau.
function chartsSheet(wb: Workbook, title: string, sheetName: string, charts: ExcelChartInput[], usedTables: Set<string>): DrawingItem[] {
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value =
    "Graphiques Excel natifs : modifiables comme tout graphique Excel (clic droit > Sélectionner des données, Modifier le type…). Les types sans équivalent dans Excel sont insérés en image, à côté de leurs données.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  const items: DrawingItem[] = [];
  let r = 4;
  charts.forEach((ch, k) => {
    const { excel } = ch;
    ws.getCell(r, 1).value = `${k + 1}. ${ch.title}`;
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: "FF1D4ED8" } };
    const kind = excel.native ? "graphique Excel natif" : ch.image ? "image (type sans équivalent dans Excel)" : "données";
    ws.getCell(r + 1, 1).value = `${ch.typeLabel} · ${kind}${excel.note ? ` · ${excel.note}` : ""}`;
    ws.getCell(r + 1, 1).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
    const top = r + 2; // ligne d'en-tête du tableau
    let tableCols = 0;
    let tableRows = 0;
    if (excel.table && excel.table.columns.length) {
      const { columns } = addTable(ws, usedTables, {
        name: `Graphique_${k + 1}`,
        row: top,
        columns: excel.table.columns,
        rows: excel.table.rows,
        style: CHART_TABLE_STYLE,
        colorScale: excel.table.colorScale,
        perCellFormats: true,
      });
      fitColumns(ws, columns, excel.table.rows, 1, 10, 30);
      tableCols = columns.length;
      tableRows = excel.table.rows.length;
      if (excel.native) {
        items.push({
          row: top - 1,
          col: tableCols + 1,
          widthPx: 640,
          heightPx: Math.max(280, ch.height),
          name: ch.title,
          chart: { spec: excel.native, table: { sheetName, headerRow: top, firstCol: 1, rows: excel.table.rows, columns } },
        });
      }
    }
    let visualRows = 0;
    if (excel.native) visualRows = Math.ceil(Math.max(280, ch.height) / ROW_PX);
    else if (ch.image) {
      const width = 700;
      const height = Math.round(((ch.imageHeight ?? ch.height) / (ch.imageWidth ?? 1000)) * width);
      items.push({ row: top - 1, col: tableCols ? tableCols + 1 : 0, widthPx: width, heightPx: height, name: ch.title, image: ch.image });
      visualRows = Math.ceil(height / ROW_PX);
    }
    r = top + Math.max(tableRows + 1, visualRows) + 3;
  });
  return items;
}

// Construit le classeur XLSX et renvoie les octets (testable hors navigateur).
// Chaque liste devient un vrai tableau Excel (filtres, tri, style) ; les
// graphiques personnalisés sont placés dans un onglet « Graphiques » par
// feuille, en graphiques Excel natifs reliés à leurs données quand c'est
// possible, sinon en images.
export async function buildXLSX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<Uint8Array> {
  const mod = (await import("exceljs")) as unknown as { default?: ExcelJSModule } & ExcelJSModule;
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "DataLab";
  wb.created = new Date();
  const usedSheets = new Set<string>();
  const usedTables = new Set<string>();
  const multi = sheets.length > 1;
  const drawings = new Map<string, DrawingItem[]>();

  if (multi) {
    const ws = wb.addWorksheet(safeSheetName("Sommaire", usedSheets), { views: [{ state: "frozen", ySplit: 1 }] });
    const columns = ["Feuille", "Lignes", "Colonnes", "Doublons retirés", "Valeurs manquantes", "Graphiques"];
    const rows = sheets.map((s) => [
      s.name,
      s.analysis.profile.rowCount,
      s.analysis.profile.columnCount,
      s.analysis.profile.duplicateRows,
      s.analysis.profile.totalMissing,
      s.excelCharts?.length ?? 0,
    ]);
    addTable(ws, usedTables, { name: "Sommaire", row: 1, columns, rows });
    fitColumns(ws, columns, rows);
  }

  // Une feuille de données nettoyées par feuille source.
  for (const s of sheets) {
    const ws = wb.addWorksheet(safeSheetName(multi ? s.name : "Données nettoyées", usedSheets), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const rows = dataRows(s);
    const { columns } = addTable(ws, usedTables, { name: `Donnees_${s.name}`, row: 1, columns: s.dataset.columns, rows });
    fitColumns(ws, columns, rows);
  }

  // Profil des colonnes (toutes feuilles regroupées si classeur multi-feuilles).
  {
    const columns = [
      ...(multi ? ["Feuille"] : []),
      "Colonne",
      "Type",
      "Valeurs renseignées",
      "Manquantes",
      "% Manquantes",
      "Valeurs uniques",
      "Moyenne",
      "Médiane",
      "Écart-type",
      "Min",
      "Max",
      "Q1",
      "Q3",
      "Outliers",
    ];
    const rows = sheets.flatMap((s) =>
      s.analysis.profile.columns.map((c): ExcelCell[] => [
        ...(multi ? [s.name] : []),
        c.name,
        c.type,
        c.count,
        c.missing,
        c.missingPct,
        c.unique,
        c.numeric?.mean ?? null,
        c.numeric?.median ?? null,
        c.numeric?.std ?? null,
        c.numeric?.min ?? null,
        c.numeric?.max ?? null,
        c.numeric?.q1 ?? null,
        c.numeric?.q3 ?? null,
        c.outliers ?? null,
      ]),
    );
    const ws = wb.addWorksheet(safeSheetName("Profil colonnes", usedSheets), { views: [{ state: "frozen", ySplit: 1 }] });
    addTable(ws, usedTables, { name: "Profil", row: 1, columns, rows });
    fitColumns(ws, columns, rows);
  }

  // Corrélations, avec une échelle de couleurs sur r (bleu négatif, rouge positif).
  const corrRows = sheets.flatMap((s) =>
    s.analysis.correlations.map((c): ExcelCell[] => [...(multi ? [s.name] : []), c.a, c.b, c.r]),
  );
  if (corrRows.length > 0) {
    const columns = [...(multi ? ["Feuille"] : []), "Variable A", "Variable B", "Coefficient de Pearson (r)"];
    const ws = wb.addWorksheet(safeSheetName("Corrélations", usedSheets), { views: [{ state: "frozen", ySplit: 1 }] });
    const rCol = columns.length;
    addTable(ws, usedTables, { name: "Correlations", row: 1, columns, rows: corrRows, numFmts: columns.map((_, j) => (j === rCol - 1 ? "0.000" : undefined)) });
    ws.addConditionalFormatting({
      ref: `${colLetter(rCol)}2:${colLetter(rCol)}${corrRows.length + 1}`,
      rules: [
        {
          type: "colorScale",
          priority: 1,
          cfvo: [
            { type: "num", value: -1 },
            { type: "num", value: 0 },
            { type: "num", value: 1 },
          ],
          color: [{ argb: "FF2166AC" }, { argb: "FFF7F7F7" }, { argb: "FFB2182B" }],
        },
      ],
    });
    fitColumns(ws, columns, corrRows);
  }

  // Décisions manuelles de nettoyage (traçabilité : qui a changé quoi et pourquoi).
  const manualRows = sheets.flatMap((s) =>
    (s.manualLog ?? []).map((e): ExcelCell[] => [
      ...(multi ? [s.name] : []),
      e.row,
      e.column || "(ligne entière)",
      e.issue === "missing" ? "Cellule vide" : e.issue === "outlier" ? "Valeur atypique" : "Ligne",
      e.issue === "row" ? null : e.before,
      e.issue === "row" ? null : e.after,
      e.decision,
      e.note,
    ]),
  );
  if (manualRows.length > 0) {
    const columns = [...(multi ? ["Feuille"] : []), "Ligne", "Colonne", "Problème", "Valeur d'origine", "Nouvelle valeur", "Décision", "Justification"];
    const ws = wb.addWorksheet(safeSheetName("Décisions manuelles", usedSheets), { views: [{ state: "frozen", ySplit: 1 }] });
    addTable(ws, usedTables, { name: "Decisions", row: 1, columns, rows: manualRows });
    fitColumns(ws, columns, manualRows, 1, 8, 60);
  }

  // Graphiques personnalisés : un onglet par feuille source.
  for (const s of sheets) {
    const charts = (s.excelCharts ?? []).filter((c) => c.excel.table || c.excel.native || c.image);
    if (charts.length === 0) continue;
    const sheetName = safeSheetName(multi ? `Graphiques ${s.name}` : "Graphiques", usedSheets);
    const items = chartsSheet(wb, multi ? `Graphiques — ${s.name}` : "Graphiques personnalisés", sheetName, charts, usedTables);
    if (items.length) drawings.set(sheetName, items);
  }

  // Observations, groupées par feuille si classeur multi-feuilles.
  {
    const ws = wb.addWorksheet(safeSheetName("Observations", usedSheets));
    ws.getColumn(1).width = 120;
    ws.getCell("A1").value = "Observations et appréciations";
    ws.getCell("A1").font = { bold: true, size: 13 };
    let row = 2;
    for (const s of sheets) {
      if (multi) {
        ws.getCell(row, 1).value = `— ${s.name} —`;
        ws.getCell(row, 1).font = { bold: true };
        row++;
      }
      for (const o of s.analysis.observations) {
        ws.getCell(row, 1).value = o;
        ws.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
        row++;
      }
    }
  }

  const buffer = new Uint8Array(await wb.xlsx.writeBuffer());
  return drawings.size > 0 ? addDrawings(buffer, drawings) : buffer;
}

// Export XLSX : construit puis déclenche le téléchargement dans le navigateur.
export async function exportXLSX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<void> {
  const out = await buildXLSX(fileName, sheets);
  const saveAs = await loadSaveAs();
  saveAs(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    baseName(fileName) + "_analyse.xlsx",
  );
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
