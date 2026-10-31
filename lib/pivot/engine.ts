import type { CellValue, ColumnType, Dataset, DatasetProfile, Row } from "@/lib/types";
import { isEmpty, toNumber } from "@/lib/stats";
import { axisKey, type AxisKey } from "@/lib/charts/data";
import type { ColumnKind } from "@/lib/charts/types";
import {
  PIVOT_AGG_LABEL,
  type PivotAgg,
  type PivotCell,
  type PivotColumnLeaf,
  type PivotConfig,
  type PivotField,
  type PivotHeaderCell,
  type PivotResult,
  type PivotRow,
  type PivotValue,
} from "./types";

// Correspondance type de colonne → nature pour le TCD.
export function pivotKindOf(type: ColumnType): ColumnKind {
  return type === "number" ? "number" : type === "date" ? "date" : "category";
}

// Configuration TCD par défaut : 1re colonne catégorielle en lignes, somme de
// la 1re colonne numérique (sinon comptage), sous-totaux et totaux activés.
export function autoPivotConfig(profile: DatasetProfile): PivotConfig {
  const firstCat = profile.columns.find((c) => pivotKindOf(c.type) === "category");
  const firstNum = profile.columns.find((c) => c.type === "number");
  return {
    rows: firstCat ? [{ column: firstCat.name, kind: "category" }] : [],
    columns: [],
    values: firstNum
      ? [{ column: firstNum.name, agg: "sum" }]
      : [{ column: null, agg: "count" }],
    filters: [],
    rowSubtotals: true,
    grandTotal: true,
  };
}

// Aplatit un résultat de TCD en un tableau rectangulaire (une colonne de
// libellé + une colonne par couple colonne-feuille × mesure, plus les totaux
// généraux), pour l'affichage tabulaire et les exports (Excel, PDF, Word).
export function flattenPivot(res: PivotResult): {
  columns: string[];
  rows: (string | number | null)[][];
} {
  const leaves = res.columnLeaves;
  const V = res.values.length;
  const multiCol = leaves.some((l) => l.path.length > 0);

  const columns: string[] = [res.rowFieldLabels.length ? res.rowFieldLabels.join(" / ") : "Catégorie"];
  for (const leaf of leaves) {
    for (let v = 0; v < V; v++) {
      const base = multiCol ? leaf.path.join(" / ") || "(vide)" : "";
      columns.push(multiCol ? (V > 1 ? `${base} · ${res.valueLabels[v]}` : base) : res.valueLabels[v]);
    }
  }
  const grandTotalEnabled = res.grandTotalRow !== null || res.rows.some((r) => r.totals.length > 0);
  const showTotalCols = grandTotalEnabled && leaves.length > 1;
  if (showTotalCols) {
    for (let v = 0; v < V; v++) columns.push(V > 1 ? `Total · ${res.valueLabels[v]}` : "Total général");
  }

  const rowLabel = (r: PivotRow): string => {
    if (r.kind === "subtotal") return `Total ${r.labels[r.depth] ?? ""}`.trim();
    if (r.kind === "grandtotal") return r.labels[0] || "Total général";
    return r.labels.filter(Boolean).join(" / ");
  };
  const mapRow = (r: PivotRow): (string | number | null)[] => {
    const out: (string | number | null)[] = [rowLabel(r)];
    for (let ci = 0; ci < leaves.length; ci++) for (let v = 0; v < V; v++) out.push(r.cells[ci]?.[v]?.value ?? null);
    if (showTotalCols) for (let v = 0; v < V; v++) out.push(r.totals[v]?.value ?? null);
    return out;
  };
  const rows = res.rows.map(mapRow);
  if (res.grandTotalRow) rows.push(mapRow(res.grandTotalRow));
  return { columns, rows };
}

// Moteur de tableau croisé dynamique, pur et sérialisable. Agrège un Dataset
// selon des champs en lignes et en colonnes (imbriqués), plusieurs mesures,
// avec sous-totaux, totaux généraux et filtres. Les sous-totaux et totaux sont
// recalculés depuis les valeurs brutes (fusion d'accumulateurs) : ils sont donc
// corrects même pour la moyenne, la médiane ou l'écart-type.

const EMPTY_AXIS: AxisKey = { key: "\u0000vide", sort: "￿", label: "(vide)", value: "(vide)" };
const SEP = "\u0001";

function keyOf(v: CellValue, field: PivotField): AxisKey {
  return axisKey(v, field.kind, field.bucket ?? "none") ?? EMPTY_AXIS;
}

function compareSort(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });
}

// --- Accumulateur fusionnable ---------------------------------------------

interface Acc {
  n: number;
  values: number[];
  distinct: Set<string>;
}
const newAcc = (): Acc => ({ n: 0, values: [], distinct: new Set() });

function accAdd(a: Acc, raw: CellValue | undefined, hasValueCol: boolean): void {
  if (!hasValueCol) {
    a.n++;
    return;
  }
  if (raw === undefined || isEmpty(raw)) return;
  a.n++;
  a.distinct.add(String(raw).trim());
  const num = toNumber(raw);
  if (num !== null) a.values.push(num);
}

function accMerge(into: Acc, from: Acc): void {
  into.n += from.n;
  for (const v of from.values) into.values.push(v);
  from.distinct.forEach((d) => into.distinct.add(d));
}

function aggregate(a: Acc, agg: PivotAgg, hasValueCol: boolean): number | null {
  if (!hasValueCol || agg === "count") return a.n;
  if (agg === "distinct") return a.distinct.size;
  const xs = a.values;
  if (xs.length === 0) return null;
  switch (agg) {
    case "sum":
      return xs.reduce((s, x) => s + x, 0);
    case "mean":
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    case "median": {
      const s = [...xs].sort((p, q) => p - q);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case "min":
      return xs.reduce((s, x) => (x < s ? x : s), Infinity);
    case "max":
      return xs.reduce((s, x) => (x > s ? x : s), -Infinity);
    case "var":
    case "std": {
      if (xs.length < 2) return null;
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
      return agg === "var" ? v : Math.sqrt(v);
    }
    default:
      return null;
  }
}

// --- Libellés & format -----------------------------------------------------

export function defaultValueLabel(v: PivotValue): string {
  if (v.label) return v.label;
  if (v.column === null) return "Nombre de lignes";
  if (v.agg === "count") return `Nombre · ${v.column}`;
  return `${PIVOT_AGG_LABEL[v.agg]} · ${v.column}`;
}

function formatVal(val: number | null, value: PivotValue): string {
  if (val === null || !Number.isFinite(val)) return "";
  const decimals = value.decimals ?? (Number.isInteger(val) ? 0 : 2);
  return val
    .toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .replace(/[  ]/g, " ");
}

// --- Arbre de lignes (pour l'ordre et les sous-totaux) ---------------------

interface TreeNode {
  axis: AxisKey;
  children: Map<string, TreeNode>;
  leafKeys: string[]; // clés de toutes les feuilles sous ce nœud
}
const newNode = (axis: AxisKey): TreeNode => ({ axis, children: new Map(), leafKeys: [] });

// --- Calcul ----------------------------------------------------------------

const MAX_COMBOS = 20000; // garde-fou de réactivité (feuilles lignes × colonnes)

export function computePivot(dataset: Dataset, config: PivotConfig): PivotResult {
  const warnings: string[] = [];
  const values: PivotValue[] = config.values.length
    ? config.values
    : [{ column: null, agg: "count" }];
  const V = values.length;
  const hasValueCol = values.map((v) => v.column !== null);
  const depthCount = config.rows.length;

  const filters = config.filters.filter((f) => f.include.length > 0);
  const passes = (row: Row): boolean => {
    for (const f of filters) {
      const k = keyOf(row[f.column], { column: f.column, kind: f.kind, bucket: f.bucket });
      if (!f.include.includes(k.key)) return false;
    }
    return true;
  };

  const rowPaths = new Map<string, AxisKey[]>();
  const colPaths = new Map<string, AxisKey[]>();
  const store = new Map<string, Map<string, Acc[]>>(); // rowKey -> colKey -> Acc[V]

  for (const row of dataset.rows) {
    if (!passes(row)) continue;
    const rPath = config.rows.map((f) => keyOf(row[f.column], f));
    const cPath = config.columns.map((f) => keyOf(row[f.column], f));
    const rKey = rPath.map((k) => k.key).join(SEP);
    const cKey = cPath.map((k) => k.key).join(SEP);
    if (!rowPaths.has(rKey)) rowPaths.set(rKey, rPath);
    if (!colPaths.has(cKey)) colPaths.set(cKey, cPath);
    let rowMap = store.get(rKey);
    if (!rowMap) store.set(rKey, (rowMap = new Map()));
    let accs = rowMap.get(cKey);
    if (!accs) rowMap.set(cKey, (accs = values.map(() => newAcc())));
    for (let v = 0; v < V; v++) {
      accAdd(accs[v], values[v].column ? row[values[v].column!] : undefined, hasValueCol[v]);
    }
  }

  // Ordre hiérarchique des feuilles (lignes et colonnes).
  const sortLeaves = (paths: Map<string, AxisKey[]>) =>
    [...paths.entries()]
      .map(([key, path]) => ({ key, path }))
      .sort((a, b) => {
        const n = Math.max(a.path.length, b.path.length);
        for (let i = 0; i < n; i++) {
          const c = compareSort(a.path[i]?.sort ?? "", b.path[i]?.sort ?? "");
          if (c !== 0) return c;
        }
        return 0;
      });

  const rowLeaves = sortLeaves(rowPaths);
  const colLeaves = sortLeaves(colPaths);
  const cellCount = rowLeaves.length * Math.max(1, colLeaves.length) * V;
  const combos = rowLeaves.length * Math.max(1, colLeaves.length);
  const withSubtotals = config.rowSubtotals && depthCount > 1 && combos <= MAX_COMBOS;
  if (config.rowSubtotals && depthCount > 1 && combos > MAX_COMBOS) {
    warnings.push("Croisement trop volumineux : sous-totaux désactivés pour rester réactif.");
  }

  const columnLeaves: PivotColumnLeaf[] = colLeaves.length
    ? colLeaves.map((l) => ({ path: l.path.map((k) => k.label), key: l.key }))
    : [{ path: [], key: "" }];
  const colKeys = columnLeaves.map((c) => c.key);

  // Valeur d'une cellule : fusion des accumulateurs des feuilles lignes
  // concernées, pour une colonne-feuille et une mesure données.
  const cellFor = (rowKeys: string[], colKey: string, v: number): PivotCell => {
    const acc = newAcc();
    for (const rk of rowKeys) {
      const cm = store.get(rk);
      if (!cm) continue;
      const a = cm.get(colKey);
      if (a) accMerge(acc, a[v]);
    }
    const val = aggregate(acc, values[v].agg, hasValueCol[v]);
    return { value: val, display: formatVal(val, values[v]) };
  };
  const totalFor = (rowKeys: string[], v: number): PivotCell => {
    const acc = newAcc();
    for (const rk of rowKeys) {
      const cm = store.get(rk);
      if (!cm) continue;
      for (const a of cm.values()) accMerge(acc, a[v]);
    }
    const val = aggregate(acc, values[v].agg, hasValueCol[v]);
    return { value: val, display: formatVal(val, values[v]) };
  };

  const makeRow = (
    rowKeys: string[],
    labels: string[],
    depth: number,
    kind: PivotRow["kind"],
  ): PivotRow => ({
    labels,
    depth,
    kind,
    cells: columnLeaves.map((_, ci) => values.map((_, v) => cellFor(rowKeys, colKeys[ci], v))),
    totals: config.grandTotal ? values.map((_, v) => totalFor(rowKeys, v)) : [],
  });

  const rows: PivotRow[] = [];

  if (depthCount === 0) {
    // Aucun champ en ligne : une seule ligne agrégée.
    const allRowKeys = rowLeaves.map((l) => l.key);
    rows.push(makeRow(allRowKeys.length ? allRowKeys : [""], ["Total"], 0, "grandtotal"));
    return finish();
  }

  // Construit l'arbre des lignes dans l'ordre trié.
  const root = newNode(EMPTY_AXIS);
  for (const leaf of rowLeaves) {
    let node = root;
    node.leafKeys.push(leaf.key);
    for (let d = 0; d < leaf.path.length; d++) {
      const ax = leaf.path[d];
      let child = node.children.get(ax.key);
      if (!child) node.children.set(ax.key, (child = newNode(ax)));
      child.leafKeys.push(leaf.key);
      node = child;
    }
  }

  const padLabels = (labels: string[]): string[] => {
    const out = labels.slice(0, depthCount);
    while (out.length < depthCount) out.push("");
    return out;
  };
  const walk = (node: TreeNode, depth: number, labels: string[]): void => {
    for (const child of node.children.values()) {
      const nextLabels = [...labels, child.axis.label];
      if (depth === depthCount - 1) {
        // Feuille : ligne de données.
        rows.push(makeRow(child.leafKeys, padLabels(nextLabels), depth, "data"));
      } else {
        walk(child, depth + 1, nextLabels);
        if (withSubtotals) {
          rows.push(makeRow(child.leafKeys, padLabels(nextLabels), depth, "subtotal"));
        }
      }
    }
  };
  walk(root, 0, []);

  const grandTotalRow =
    config.grandTotal && rowLeaves.length
      ? makeRow(rowLeaves.map((l) => l.key), padLabels(["Total général"]), 0, "grandtotal")
      : null;

  return finish(grandTotalRow);

  function finish(grandTotal: PivotRow | null = null): PivotResult {
    return {
      values,
      valueLabels: values.map(defaultValueLabel),
      rowFieldLabels: config.rows.map((f) => f.column),
      columnLeaves,
      headerRows: buildHeaderRows(columnLeaves, config.columns, V, values.map(defaultValueLabel)),
      rows,
      grandTotalRow: grandTotal,
      warnings,
      cellCount,
    };
  }
}

function samePrefix(a: string[], b: string[], d: number): boolean {
  for (let i = 0; i <= d; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buildHeaderRows(
  leaves: PivotColumnLeaf[],
  columns: PivotField[],
  V: number,
  valueLabels: string[],
): PivotHeaderCell[][] {
  const L = columns.length;
  const headerRows: PivotHeaderCell[][] = [];
  for (let d = 0; d < L; d++) {
    const cells: PivotHeaderCell[] = [];
    let i = 0;
    while (i < leaves.length) {
      const label = leaves[i].path[d] ?? "";
      let j = i + 1;
      while (j < leaves.length && samePrefix(leaves[i].path, leaves[j].path, d)) j++;
      cells.push({ label, span: (j - i) * V });
      i = j;
    }
    headerRows.push(cells);
  }
  if (V > 1) {
    const cells: PivotHeaderCell[] = [];
    for (let c = 0; c < leaves.length; c++) for (let v = 0; v < V; v++) cells.push({ label: valueLabels[v], span: 1 });
    headerRows.push(cells);
  } else if (L === 0) {
    headerRows.push([{ label: valueLabels[0], span: 1 }]);
  }
  return headerRows;
}
