import type { CellValue, ColumnType } from "./types";

// Valeurs traitées comme "vides" une fois standardisées.
export const EMPTY_TOKENS = new Set([
  "",
  "na",
  "n/a",
  "null",
  "none",
  "nan",
  "-",
  "--",
  "?",
]);

export function isEmpty(v: CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return EMPTY_TOKENS.has(v.trim().toLowerCase());
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

// Tente de convertir une valeur en nombre (gère la virgule décimale et les espaces).
export function toNumber(v: CellValue): number | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  let s = String(v).trim();
  if (s === "") return null;
  // Retire espaces (séparateurs de milliers) et symboles monétaires courants.
  s = s.replace(/[\s ]/g, "").replace(/[€$£%]/g, "");
  // Nombre au format français "1 234,56" -> "1234.56"
  if (/,/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DATE_RE =
  /^(\d{4}-\d{2}-\d{2})|(\d{2}\/\d{2}\/\d{4})|(\d{2}-\d{2}-\d{4})/;

export function looksLikeDate(v: CellValue): boolean {
  if (v === null) return false;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

const BOOL_TRUE = new Set(["true", "vrai", "oui", "yes", "1"]);
const BOOL_FALSE = new Set(["false", "faux", "non", "no", "0"]);

export function looksLikeBool(v: CellValue): boolean {
  if (typeof v === "boolean") return true;
  const s = String(v).trim().toLowerCase();
  return BOOL_TRUE.has(s) || BOOL_FALSE.has(s);
}

export function parseBool(v: CellValue): boolean | null {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return null;
}

// Détermine le type dominant d'une colonne à partir de ses valeurs non vides.
export function inferColumnType(values: CellValue[]): ColumnType {
  const nonEmpty = values.filter((v) => !isEmpty(v));
  if (nonEmpty.length === 0) return "empty";

  let numeric = 0;
  let date = 0;
  let bool = 0;

  for (const v of nonEmpty) {
    if (looksLikeBool(v)) bool++;
    else if (toNumber(v) !== null) numeric++;
    else if (looksLikeDate(v)) date++;
  }

  const total = nonEmpty.length;
  const threshold = 0.8;

  // Une colonne "0/1" ambiguë est traitée comme numérique si peu de valeurs uniques.
  if (bool / total >= threshold) {
    const uniques = new Set(nonEmpty.map((v) => String(v).toLowerCase()));
    if (uniques.size <= 2) return "boolean";
  }
  if (numeric / total >= threshold) return "number";
  if (date / total >= threshold) return "date";
  return "string";
}

// --- Fonctions statistiques ---

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance =
    xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

export function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return n;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
