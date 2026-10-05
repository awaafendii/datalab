// Préparation des données pour les graphiques : typage des colonnes,
// lecture des dates, agrégations (tableau croisé), hiérarchies, flux,
// densités, courbes de tendance et format des nombres.

import type { CellValue, Dataset, DatasetProfile } from "../types";
import { isEmpty, toNumber } from "../stats";
import { detectMapLevel } from "./geo";
import type {
  Aggregation,
  ChartConfig,
  ColumnInfo,
  ColumnKind,
  DateBucket,
  SortMode,
  TrendKind,
} from "./types";

export function columnInfos(profile: DatasetProfile): ColumnInfo[] {
  return profile.columns
    .filter((c) => c.type !== "empty")
    .map((c) => {
      const kind: ColumnKind = c.type === "number" ? "number" : c.type === "date" ? "date" : "category";
      // Colonne de lieux : ses valeurs les plus fréquentes sont des régions,
      // préfectures ou pays reconnus.
      const top = c.categorical?.top.map((t) => t.value) ?? [];
      const geo = kind === "category" && top.length ? detectMapLevel(top) : null;
      return {
        name: c.name,
        kind,
        unique: c.unique,
        count: c.count,
        ...(geo && geo.rate >= 0.6 ? { geo: geo.level } : {}),
      };
    });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const FR_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

// Les dates arrivent en texte : ISO (Excel converti par lib/parse.ts) ou au
// format français JJ/MM/AAAA (CSV). Date.parse lirait « 05/03/2024 » comme
// le 3 mai (format américain) : on lit donc les deux formats à la main.
export function parseDate(v: CellValue): Date | null {
  if (v === null || typeof v === "boolean") return null;
  if (typeof v === "number") return null;
  const s = v.trim();
  let y: number, mo: number, d: number, h = 0, mi = 0, se = 0;
  let m = ISO_RE.exec(s);
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    if (m[4]) {
      h = +m[4];
      mi = +m[5];
      se = m[6] ? +m[6] : 0;
    }
  } else {
    m = FR_RE.exec(s);
    if (!m) return null;
    d = +m[1];
    mo = +m[2];
    y = +m[3];
    if (m[4]) {
      h = +m[4];
      mi = +m[5];
      se = m[6] ? +m[6] : 0;
    }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, h, mi, se);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Format accepté par les axes de dates Plotly.
export function isoDate(d: Date): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return day;
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

// ---------------------------------------------------------------------------
// Clés d'axe : valeur triable + libellé
// ---------------------------------------------------------------------------

export interface AxisKey {
  key: string; // identité de la catégorie
  sort: number | string; // ordre naturel (chronologique, numérique, alphabétique)
  label: string; // libellé affiché
  value: string | number; // valeur passée à Plotly (date ISO, nombre ou libellé)
}

export function axisKey(v: CellValue, kind: ColumnKind, bucket: DateBucket): AxisKey | null {
  if (isEmpty(v)) return null;
  if (kind === "number") {
    const n = toNumber(v);
    if (n === null) return null;
    const label = String(n);
    return { key: label, sort: n, label, value: n };
  }
  if (kind === "date") {
    const d = parseDate(v);
    if (!d) {
      const label = String(v).trim();
      return { key: label, sort: label, label, value: label };
    }
    switch (bucket) {
      case "year": {
        const label = String(d.getFullYear());
        return { key: label, sort: d.getFullYear(), label, value: label };
      }
      case "quarter": {
        const q = Math.floor(d.getMonth() / 3) + 1;
        const label = `T${q} ${d.getFullYear()}`;
        return { key: label, sort: d.getFullYear() * 10 + q, label, value: label };
      }
      case "month": {
        const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        return { key: label, sort: d.getFullYear() * 100 + d.getMonth(), label, value: label };
      }
      case "day": {
        const iso = isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
        return { key: iso, sort: iso, label: iso, value: iso };
      }
      default: {
        const iso = isoDate(d);
        return { key: iso, sort: iso, label: iso, value: iso };
      }
    }
  }
  const label = String(v).trim();
  return { key: label, sort: label, label, value: label };
}

function compareSort(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Agrégation
// ---------------------------------------------------------------------------

class Acc {
  n = 0; // lignes
  vals: number[] = [];
  distinct = new Set<string>();

  add(raw: CellValue | undefined, hasValueCol: boolean) {
    if (!hasValueCol) {
      this.n++;
      return;
    }
    if (raw === undefined || isEmpty(raw)) return;
    this.n++;
    this.distinct.add(String(raw).trim());
    const num = toNumber(raw);
    if (num !== null) this.vals.push(num);
  }

  merge(o: Acc) {
    this.n += o.n;
    for (const v of o.vals) this.vals.push(v);
    o.distinct.forEach((d) => this.distinct.add(d));
  }

  result(agg: Aggregation, hasValueCol: boolean): number | null {
    if (!hasValueCol || agg === "count") return this.n;
    if (agg === "distinct") return this.distinct.size;
    const xs = this.vals;
    if (xs.length === 0) return null;
    switch (agg) {
      case "mean":
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      case "median": {
        const s = [...xs].sort((a, b) => a - b);
        const mid = s.length >> 1;
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      }
      case "min":
        return xs.reduce((a, b) => Math.min(a, b), Infinity);
      case "max":
        return xs.reduce((a, b) => Math.max(a, b), -Infinity);
      default:
        return xs.reduce((a, b) => a + b, 0);
    }
  }
}

export interface PivotSeries {
  name: string;
  values: (number | null)[];
}

export interface Pivot {
  categories: AxisKey[];
  series: PivotSeries[];
  hiddenCategories: number; // catégories écartées (Top N / limite)
  hiddenSeries: number;
}

export interface PivotOptions {
  x: string;
  xKind: ColumnKind;
  values: string[]; // colonnes de valeurs (vide = comptage des lignes)
  group: string | null;
  groupKind: ColumnKind;
  agg: Aggregation;
  bucket: DateBucket;
  sort: SortMode;
  topN: number;
  others: boolean;
  maxCategories?: number;
  maxSeries?: number;
}

const OTHERS = "Autres";

// Tableau croisé : une ligne par catégorie de X, une série par colonne de
// valeurs (ou par modalité de la légende), agrégée selon `agg`.
export function pivot(dataset: Dataset, o: PivotOptions): Pivot {
  const hasValue = o.values.length > 0;
  const seriesCols = hasValue ? o.values : [null];
  const byGroup = o.group !== null && o.values.length <= 1;

  const cats = new Map<string, AxisKey>();
  const order: string[] = [];
  // cellule (catégorie, série) -> accumulateur
  const cells = new Map<string, Map<string, Acc>>();
  const seriesTotals = new Map<string, number>();
  const seriesOrder: string[] = [];

  const cell = (ck: string, sk: string) => {
    let row = cells.get(ck);
    if (!row) cells.set(ck, (row = new Map()));
    let acc = row.get(sk);
    if (!acc) row.set(sk, (acc = new Acc()));
    return acc;
  };

  for (const r of dataset.rows) {
    const k = axisKey(r[o.x], o.xKind, o.bucket);
    if (!k) continue;
    if (!cats.has(k.key)) {
      cats.set(k.key, k);
      order.push(k.key);
    }
    if (byGroup) {
      const g = axisKey(r[o.group!], o.groupKind, "none");
      if (!g) continue;
      const sk = g.label;
      if (!seriesTotals.has(sk)) {
        seriesTotals.set(sk, 0);
        seriesOrder.push(sk);
      }
      seriesTotals.set(sk, seriesTotals.get(sk)! + 1);
      cell(k.key, sk).add(hasValue ? r[o.values[0]] : undefined, hasValue);
    } else {
      for (const col of seriesCols) {
        const sk = col ?? "";
        cell(k.key, sk).add(col ? r[col] : undefined, hasValue);
      }
    }
  }

  // Séries
  let seriesKeys: string[];
  let hiddenSeries = 0;
  if (byGroup) {
    const maxSeries = o.maxSeries ?? 25;
    const sorted = [...seriesOrder].sort((a, b) => {
      const ka = axisKey(a, o.groupKind, "none")!;
      const kb = axisKey(b, o.groupKind, "none")!;
      return o.groupKind === "category"
        ? seriesTotals.get(b)! - seriesTotals.get(a)! || compareSort(ka.sort, kb.sort)
        : compareSort(ka.sort, kb.sort);
    });
    seriesKeys = sorted.slice(0, maxSeries);
    hiddenSeries = sorted.length - seriesKeys.length;
  } else {
    seriesKeys = seriesCols.map((c) => c ?? "");
  }

  const valueOf = (ck: string, sk: string) =>
    cells.get(ck)?.get(sk)?.result(o.agg, hasValue) ?? null;
  const totalOf = (ck: string) =>
    seriesKeys.reduce((s, sk) => s + Math.abs(valueOf(ck, sk) ?? 0), 0);

  // Top N (par valeur) puis tri
  let keys = [...order];
  let hidden: string[] = [];
  const limit = o.topN > 0 ? o.topN : (o.maxCategories ?? 0);
  if (limit > 0 && keys.length > limit) {
    const byValue = [...keys].sort((a, b) => totalOf(b) - totalOf(a));
    const keep = new Set(byValue.slice(0, limit));
    hidden = keys.filter((k) => !keep.has(k));
    keys = keys.filter((k) => keep.has(k));
  }

  const natural = o.xKind === "date" || o.xKind === "number";
  const mode: SortMode = o.sort === "auto" ? (natural ? "label-asc" : "value-desc") : o.sort;
  if (mode === "label-asc" || mode === "label-desc") {
    keys.sort((a, b) => compareSort(cats.get(a)!.sort, cats.get(b)!.sort) * (mode === "label-asc" ? 1 : -1));
  } else if (mode === "value-desc" || mode === "value-asc") {
    keys.sort((a, b) => (totalOf(a) - totalOf(b)) * (mode === "value-asc" ? 1 : -1));
  }

  const categories = keys.map((k) => cats.get(k)!);
  const series: PivotSeries[] = seriesKeys.map((sk) => ({
    name: sk === "" ? "" : sk,
    values: keys.map((ck) => valueOf(ck, sk)),
  }));

  if (hidden.length && o.others && o.topN > 0) {
    categories.push({ key: OTHERS, sort: OTHERS, label: OTHERS, value: OTHERS });
    series.forEach((s, i) => {
      const acc = new Acc();
      for (const ck of hidden) {
        const c = cells.get(ck)?.get(seriesKeys[i]);
        if (c) acc.merge(c);
      }
      s.values.push(acc.result(o.agg, hasValue));
    });
  }

  return {
    categories,
    series,
    hiddenCategories: o.others && o.topN > 0 ? 0 : hidden.length,
    hiddenSeries,
  };
}

// Points bruts (sans agrégation) triés par X : courbes « valeurs brutes ».
export function rawPoints(
  dataset: Dataset,
  x: string,
  xKind: ColumnKind,
  ys: string[],
): { x: (string | number)[]; series: { name: string; y: (number | null)[] }[] } {
  const rows = dataset.rows
    .map((r) => ({ r, k: axisKey(r[x], xKind, "none") }))
    .filter((p): p is { r: (typeof dataset.rows)[number]; k: AxisKey } => p.k !== null);
  if (xKind !== "category") rows.sort((a, b) => compareSort(a.k.sort, b.k.sort));
  return {
    x: rows.map((p) => p.k.value),
    series: ys.map((col) => ({ name: col, y: rows.map((p) => toNumber(p.r[col])) })),
  };
}

// ---------------------------------------------------------------------------
// Séries numériques (distributions, nuages)
// ---------------------------------------------------------------------------

export interface NumericGroup {
  name: string;
  values: number[];
  cats?: string[]; // catégorie (axe) de chaque valeur
}

// Valeurs numériques d'une colonne, éventuellement découpées par modalité
// d'une colonne de regroupement et accompagnées d'une catégorie d'axe.
export function numericGroups(
  dataset: Dataset,
  col: string,
  group: { col: string; kind: ColumnKind } | null,
  cat: { col: string; kind: ColumnKind } | null,
  maxGroups = 20,
): { groups: NumericGroup[]; hidden: number } {
  const map = new Map<string, NumericGroup>();
  const order: string[] = [];
  for (const r of dataset.rows) {
    const v = toNumber(r[col]);
    if (v === null) continue;
    let gName = "";
    if (group) {
      const g = axisKey(r[group.col], group.kind, "none");
      if (!g) continue;
      gName = g.label;
    }
    let c: string | undefined;
    if (cat) {
      const k = axisKey(r[cat.col], cat.kind, "none");
      if (!k) continue;
      c = k.label;
    }
    let entry = map.get(gName);
    if (!entry) {
      entry = { name: gName, values: [], cats: cat ? [] : undefined };
      map.set(gName, entry);
      order.push(gName);
    }
    entry.values.push(v);
    if (cat) entry.cats!.push(c!);
  }
  const sorted = order
    .map((k) => map.get(k)!)
    .sort((a, b) => (group?.kind === "category" ? b.values.length - a.values.length : compareSort(a.name, b.name)));
  return { groups: sorted.slice(0, maxGroups), hidden: Math.max(0, sorted.length - maxGroups) };
}

export function sortedUnique(values: string[], kind: ColumnKind): string[] {
  const set = Array.from(new Set(values));
  if (kind === "number") return set.sort((a, b) => Number(a) - Number(b));
  return set.sort((a, b) => compareSort(a, b));
}

// ---------------------------------------------------------------------------
// Hiérarchies (treemap, sunburst, icicle) et flux (Sankey)
// ---------------------------------------------------------------------------

export interface Hierarchy {
  ids: string[];
  labels: string[];
  parents: string[];
  values: number[];
  roots: string[]; // libellés des nœuds de 1er niveau
  rootOf: string[]; // racine de chaque nœud
  truncated: boolean;
}

export function hierarchy(
  dataset: Dataset,
  path: { col: string; kind: ColumnKind }[],
  value: string | null,
  agg: Aggregation,
  maxNodes = 3000,
): Hierarchy {
  const leaf = new Map<string, Acc>();
  const nodes = new Map<string, { label: string; parent: string; root: string }>();
  for (const r of dataset.rows) {
    const parts: string[] = [];
    for (const p of path) {
      const k = axisKey(r[p.col], p.kind, "none");
      parts.push(k ? k.label : "(vide)");
    }
    let parent = "";
    for (let i = 0; i < parts.length; i++) {
      const id = parts.slice(0, i + 1).join(" › ");
      if (!nodes.has(id)) nodes.set(id, { label: parts[i], parent, root: parts[0] });
      parent = id;
    }
    let acc = leaf.get(parent);
    if (!acc) leaf.set(parent, (acc = new Acc()));
    acc.add(value ? r[value] : undefined, value !== null);
  }
  // Valeurs : feuilles agrégées, parents = somme des enfants.
  const totals = new Map<string, number>();
  leaf.forEach((acc, id) => {
    const v = Math.max(0, acc.result(agg === "count" ? "count" : "sum", value !== null) ?? 0);
    let cur: string | undefined = id;
    while (cur) {
      totals.set(cur, (totals.get(cur) ?? 0) + v);
      cur = nodes.get(cur)?.parent || undefined;
    }
  });
  let ids = Array.from(nodes.keys()).filter((id) => (totals.get(id) ?? 0) > 0);
  const truncated = ids.length > maxNodes;
  if (truncated) {
    // Garde les nœuds les plus lourds, et leurs ancêtres.
    const keep = new Set<string>();
    for (const id of [...ids].sort((a, b) => totals.get(b)! - totals.get(a)!).slice(0, maxNodes)) {
      let cur: string | undefined = id;
      while (cur && !keep.has(cur)) {
        keep.add(cur);
        cur = nodes.get(cur)?.parent || undefined;
      }
    }
    ids = ids.filter((id) => keep.has(id));
  }
  return {
    ids,
    labels: ids.map((id) => nodes.get(id)!.label),
    parents: ids.map((id) => nodes.get(id)!.parent),
    values: ids.map((id) => totals.get(id)!),
    roots: Array.from(new Set(ids.filter((id) => !nodes.get(id)!.parent).map((id) => nodes.get(id)!.label))),
    rootOf: ids.map((id) => nodes.get(id)!.root),
    truncated,
  };
}

export interface Flows {
  nodes: { label: string; level: number }[];
  links: { source: number; target: number; value: number }[];
}

export function flows(
  dataset: Dataset,
  path: { col: string; kind: ColumnKind }[],
  value: string | null,
  agg: Aggregation,
  maxLinks = 400,
): Flows & { truncated: boolean } {
  const nodeIndex = new Map<string, number>();
  const nodes: Flows["nodes"] = [];
  const nodeOf = (level: number, label: string) => {
    const id = `${level}\u0001${label}`;
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodeIndex.set(id, i);
      nodes.push({ label, level });
    }
    return i;
  };
  const links = new Map<string, { source: number; target: number; acc: Acc }>();
  for (const r of dataset.rows) {
    const parts = path.map((p) => axisKey(r[p.col], p.kind, "none")?.label ?? null);
    for (let i = 0; i + 1 < parts.length; i++) {
      if (parts[i] === null || parts[i + 1] === null) continue;
      const s = nodeOf(i, parts[i]!);
      const t = nodeOf(i + 1, parts[i + 1]!);
      const key = `${s}>${t}`;
      let l = links.get(key);
      if (!l) links.set(key, (l = { source: s, target: t, acc: new Acc() }));
      l.acc.add(value ? r[value] : undefined, value !== null);
    }
  }
  const all = Array.from(links.values())
    .map((l) => ({
      source: l.source,
      target: l.target,
      value: Math.max(0, l.acc.result(agg === "count" ? "count" : "sum", value !== null) ?? 0),
    }))
    .filter((l) => l.value > 0)
    .sort((a, b) => b.value - a.value);
  return { nodes, links: all.slice(0, maxLinks), truncated: all.length > maxLinks };
}

// ---------------------------------------------------------------------------
// Statistiques : densité (KDE), histogramme, ECDF, tendances
// ---------------------------------------------------------------------------

function quantileSorted(s: number[], q: number): number {
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Estimation par noyau gaussien, largeur de bande de Silverman × facteur.
export function kde(values: number[], factor = 1, points = 200): { x: number[]; y: number[] } {
  let xs = values.filter(Number.isFinite);
  if (xs.length < 2) return { x: [], y: [] };
  // Au-delà de 20 000 valeurs, un échantillon régulier suffit pour la forme.
  if (xs.length > 20000) {
    const step = xs.length / 20000;
    xs = Array.from({ length: 20000 }, (_, i) => xs[Math.floor(i * step)]);
  }
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25);
  let h = 0.9 * Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) * Math.pow(n, -0.2);
  if (!(h > 0)) h = Math.abs(mean) * 0.1 || 1;
  h *= factor > 0 ? factor : 1;
  const lo = s[0] - 3 * h;
  const hi = s[n - 1] + 3 * h;
  const step = (hi - lo) / (points - 1);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = lo + i * step;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const u = (t - s[j]) / h;
      if (u > -6 && u < 6) sum += Math.exp(-0.5 * u * u);
    }
    x.push(t);
    y.push(sum * norm);
  }
  return { x, y };
}

// Pas « rond » (1, 2, 2.5, 5 × 10^k) pour des classes lisibles.
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * p;
}

export function histogramBins(all: number[], bins: number): { start: number; end: number; size: number } | null {
  if (all.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { start: min - 0.5, end: max + 0.5, size: 1 };
  const n = bins > 0 ? bins : Math.min(50, Math.max(5, Math.ceil(Math.log2(all.length) + 1)));
  const size = niceStep((max - min) / n);
  const start = Math.floor(min / size) * size;
  const end = Math.ceil(max / size) * size + (max % size === 0 ? size : 0);
  return { start, end, size };
}

// Part cumulée (en %) des observations ≤ x, un point par valeur distincte.
export function ecdf(values: number[], maxPoints = 2000): { x: number[]; y: number[] } {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  let x: number[] = [];
  let y: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && s[i + 1] === s[i]) continue; // dernière occurrence
    x.push(s[i]);
    y.push(((i + 1) / n) * 100);
  }
  if (x.length > maxPoints) {
    const step = x.length / maxPoints;
    const idx = Array.from({ length: maxPoints }, (_, k) => Math.floor(k * step));
    idx.push(x.length - 1);
    x = idx.map((i) => x[i]);
    y = idx.map((i) => y[i]);
  }
  return { x, y };
}

// Résolution d'un système linéaire (élimination de Gauss, pivot partiel).
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function polyFit(xs: number[], ys: number[], degree: number): number[] | null {
  const n = degree + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const pw = [1];
    for (let d = 1; d <= 2 * degree; d++) pw.push(pw[d - 1] * xs[i]);
    for (let r = 0; r < n; r++) {
      b[r] += pw[r] * ys[i];
      for (let c = 0; c < n; c++) A[r][c] += pw[r + c];
    }
  }
  return solve(A, b);
}

function r2(ys: number[], fitted: number[]): number {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < ys.length; i++) {
    ssr += (ys[i] - fitted[i]) ** 2;
    sst += (ys[i] - mean) ** 2;
  }
  return sst === 0 ? 1 : 1 - ssr / sst;
}

const fr = (n: number, d = 3) => n.toLocaleString("fr-FR", { maximumSignificantDigits: d });
const signed = (n: number) => (n < 0 ? ` − ${fr(-n)}` : ` + ${fr(n)}`);

export interface TrendLine {
  x: number[];
  y: number[];
  label: string; // équation ou description, avec R²
}

// Courbes de tendance disponibles dans Excel : linéaire, polynomiale,
// exponentielle, logarithmique, puissance, moyenne mobile.
export function fitTrend(xsIn: number[], ysIn: number[], kind: TrendKind, window = 3): TrendLine | null {
  const pts = xsIn
    .map((x, i) => ({ x, y: ysIn[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 3 || kind === "none") return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  if (lo === hi) return null;
  const grid = Array.from({ length: 80 }, (_, i) => lo + ((hi - lo) * i) / 79);

  if (kind === "movavg") {
    const w = Math.max(2, Math.min(window, pts.length));
    const x: number[] = [];
    const y: number[] = [];
    for (let i = w - 1; i < pts.length; i++) {
      let s = 0;
      for (let k = i - w + 1; k <= i; k++) s += ys[k];
      x.push(xs[i]);
      y.push(s / w);
    }
    return { x, y, label: `Moyenne mobile (${w} périodes)` };
  }

  if (kind === "linear") {
    const c = polyFit(xs.map((x) => x - lo), ys, 1);
    if (!c) return null;
    // y = a + b (x − lo)  =>  y = (a − b·lo) + b x
    const slope = c[1];
    const intercept = c[0] - c[1] * lo;
    const fitted = xs.map((x) => intercept + slope * x);
    return {
      x: grid,
      y: grid.map((x) => intercept + slope * x),
      label: `y = ${fr(slope)}x${signed(intercept)} · R² = ${fr(r2(ys, fitted), 3)}`,
    };
  }

  if (kind === "poly2" || kind === "poly3") {
    const degree = kind === "poly2" ? 2 : 3;
    // Variable centrée-réduite pour un système bien conditionné (dates en ms).
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    const t = (x: number) => (x - mid) / half;
    const c = polyFit(xs.map(t), ys, degree);
    if (!c) return null;
    const f = (x: number) => c.reduce((s, ci, d) => s + ci * Math.pow(t(x), d), 0);
    return {
      x: grid,
      y: grid.map(f),
      label: `Polynomiale (degré ${degree}) · R² = ${fr(r2(ys, xs.map(f)), 3)}`,
    };
  }

  if (kind === "exp") {
    const ok = pts.filter((p) => p.y > 0);
    if (ok.length < 3) return null;
    const c = polyFit(ok.map((p) => p.x - lo), ok.map((p) => Math.log(p.y)), 1);
    if (!c) return null;
    const a = Math.exp(c[0] - c[1] * lo);
    const b = c[1];
    const f = (x: number) => a * Math.exp(b * x);
    return {
      x: grid,
      y: grid.map(f),
      label: `y = ${fr(a)}·e^(${fr(b)}x) · R² = ${fr(r2(ok.map((p) => p.y), ok.map((p) => f(p.x))), 3)}`,
    };
  }

  if (kind === "log") {
    const ok = pts.filter((p) => p.x > 0);
    if (ok.length < 3) return null;
    const c = polyFit(ok.map((p) => Math.log(p.x)), ok.map((p) => p.y), 1);
    if (!c) return null;
    const f = (x: number) => c[0] + c[1] * Math.log(x);
    const g = grid.filter((x) => x > 0);
    return {
      x: g,
      y: g.map(f),
      label: `y = ${fr(c[1])}·ln(x)${signed(c[0])} · R² = ${fr(r2(ok.map((p) => p.y), ok.map((p) => f(p.x))), 3)}`,
    };
  }

  // puissance : ln y = ln a + b ln x
  const ok = pts.filter((p) => p.x > 0 && p.y > 0);
  if (ok.length < 3) return null;
  const c = polyFit(ok.map((p) => Math.log(p.x)), ok.map((p) => Math.log(p.y)), 1);
  if (!c) return null;
  const a = Math.exp(c[0]);
  const f = (x: number) => a * Math.pow(x, c[1]);
  const g = grid.filter((x) => x > 0);
  return {
    x: g,
    y: g.map(f),
    label: `y = ${fr(a)}·x^${fr(c[1])} · R² = ${fr(r2(ok.map((p) => p.y), ok.map((p) => f(p.x))), 3)}`,
  };
}

export function pearsonPairs(xs: (number | null)[], ys: (number | null)[]): number | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    const b = ys[i];
    if (a === null || b === null) continue;
    n++;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  if (n < 3) return null;
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

// ---------------------------------------------------------------------------
// Format des nombres (étiquettes, info-bulles, cartes KPI)
// ---------------------------------------------------------------------------

export interface NumberFormat {
  decimals: number; // -1 = automatique
  unit: ChartConfig["unit"];
  prefix: string;
  suffix: string;
}

const UNIT: Record<ChartConfig["unit"], { div: number; label: string }> = {
  auto: { div: 1, label: "" }, // résolue par le graphique (voir autoUnit)
  none: { div: 1, label: "" },
  k: { div: 1e3, label: " k" },
  M: { div: 1e6, label: " M" },
  Md: { div: 1e9, label: " Md" },
};

// Unités d'affichage (comme Excel / Power BI) : les valeurs tracées sont
// divisées par `div` et les graduations portent le suffixe `label`. Le format
// SI de Plotly afficherait « G » pour les milliards, d'où ce choix.
// Unité « automatique » : comme Power BI, abrège les grands nombres.
export function autoUnit(maxAbs: number): ChartConfig["unit"] {
  if (maxAbs >= 1e9) return "Md";
  if (maxAbs >= 1e6) return "M";
  return "none";
}

export function unitInfo(unit: ChartConfig["unit"]): { div: number; label: string } {
  return UNIT[unit] ?? UNIT.none;
}

export function formatNumber(v: number | null | undefined, f: NumberFormat): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const u = unitInfo(f.unit);
  const x = v / u.div;
  let digits = f.decimals;
  if (digits < 0) {
    const a = Math.abs(x);
    digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  }
  const s = x.toLocaleString("fr-FR", {
    minimumFractionDigits: f.decimals >= 0 ? digits : 0,
    maximumFractionDigits: digits,
  });
  return `${f.prefix}${s}${u.label}${f.suffix}`;
}

// Format d3 des graduations d'axe (valeurs déjà divisées par l'unité) :
// séparateur de milliers, décimales fixes ou automatiques.
export function d3Format(f: NumberFormat): string {
  if (f.decimals >= 0) return `,.${f.decimals}f`;
  return ",~f";
}
