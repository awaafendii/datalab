// Assistant IA — exécuteur local du plan de transformation.
//
// Applique, dans l'ordre, les étapes d'un TransformPlan sur un jeu de données,
// 100 % localement et de façon déterministe (aucune donnée envoyée). Inclut un
// évaluateur de formules arithmétiques SÛR (analyseur dédié, jamais `eval` ni
// `new Function`).

import type { CellValue, Row } from "../types";
import type {
  AggFn,
  FilterOperator,
  PlanStep,
  TransformPlan,
  ExecResult,
} from "./types";

// --- Conversion numérique tolérante (nombres « à la française ») ---
function toNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    let s = v.trim();
    if (s === "") return null;
    s = s.replace(/\s| /g, "").replace(/%/g, "");
    // virgule décimale -> point (si pas déjà un séparateur de milliers anglais)
    if (/,\d+$/.test(s) && !/\.\d/.test(s)) s = s.replace(",", ".");
    s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// =====================  Évaluateur de formules  =====================
// Grammaire : expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)*
// factor = number | '[' col ']' | '(' expr ')' | '-' factor
type Node =
  | { k: "num"; v: number }
  | { k: "col"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

function tokenizeFormula(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = src.indexOf("]", i);
      if (end === -1) throw new Error("Formule : crochet « ] » manquant.");
      tokens.push("[" + src.slice(i + 1, end) + "]");
      i = end + 1;
      continue;
    }
    if ("+-*/()".includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      tokens.push(src.slice(i, j));
      i = j;
      continue;
    }
    throw new Error(`Formule : caractère inattendu « ${c} ».`);
  }
  return tokens;
}

function parseFormula(src: string): Node {
  const t = tokenizeFormula(src);
  let p = 0;
  const peek = () => t[p];
  const next = () => t[p++];

  function parseExpr(): Node {
    let node = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next()!;
      node = { k: "bin", op, a: node, b: parseTerm() };
    }
    return node;
  }
  function parseTerm(): Node {
    let node = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next()!;
      node = { k: "bin", op, a: node, b: parseFactor() };
    }
    return node;
  }
  function parseFactor(): Node {
    const tok = peek();
    if (tok === undefined) throw new Error("Formule incomplète.");
    if (tok === "-") {
      next();
      return { k: "neg", a: parseFactor() };
    }
    if (tok === "(") {
      next();
      const node = parseExpr();
      if (next() !== ")") throw new Error("Formule : parenthèse « ) » manquante.");
      return node;
    }
    if (tok.startsWith("[") && tok.endsWith("]")) {
      next();
      return { k: "col", name: tok.slice(1, -1) };
    }
    const num = Number(tok);
    if (Number.isFinite(num)) {
      next();
      return { k: "num", v: num };
    }
    throw new Error(`Formule : jeton inattendu « ${tok} ».`);
  }

  const node = parseExpr();
  if (p < t.length) throw new Error(`Formule : fin inattendue près de « ${t[p]} ».`);
  return node;
}

function evalNode(node: Node, row: Row): number | null {
  switch (node.k) {
    case "num":
      return node.v;
    case "col":
      return toNumber(row[node.name] ?? null);
    case "neg": {
      const a = evalNode(node.a, row);
      return a === null ? null : -a;
    }
    case "bin": {
      const a = evalNode(node.a, row);
      const b = evalNode(node.b, row);
      if (a === null || b === null) return null;
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? null : a / b;
        default:
          return null;
      }
    }
  }
}

// =====================  Comparaisons (filter)  =====================
function compare(cell: CellValue, op: FilterOperator, value: CellValue | CellValue[]): boolean {
  if (op === "in" || op === "not_in") {
    const arr = (Array.isArray(value) ? value : [value]).map((v) => String(v).toLowerCase());
    const hit = arr.includes(String(cell ?? "").toLowerCase());
    return op === "in" ? hit : !hit;
  }
  if (op === "contains") {
    return String(cell ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
  }
  if (op === "=" || op === "!=") {
    const eq = String(cell ?? "").toLowerCase() === String(value ?? "").toLowerCase();
    return op === "=" ? eq : !eq;
  }
  // >, <, >=, <= : numérique si possible, sinon ordre alphabétique
  const cn = toNumber(cell);
  const vn = toNumber(Array.isArray(value) ? value[0] ?? null : value);
  if (cn !== null && vn !== null) {
    switch (op) {
      case ">":
        return cn > vn;
      case "<":
        return cn < vn;
      case ">=":
        return cn >= vn;
      case "<=":
        return cn <= vn;
    }
  }
  const cs = String(cell ?? "");
  const vs = String(Array.isArray(value) ? value[0] ?? "" : value ?? "");
  switch (op) {
    case ">":
      return cs > vs;
    case "<":
      return cs < vs;
    case ">=":
      return cs >= vs;
    case "<=":
      return cs <= vs;
    default:
      return false;
  }
}

// =====================  Agrégations  =====================
function aggregate(agg: AggFn, values: CellValue[]): CellValue {
  if (agg === "count") return values.length;
  if (agg === "count_distinct") {
    return new Set(values.map((v) => String(v ?? ""))).size;
  }
  const nums = values.map(toNumber).filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  switch (agg) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "median": {
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    }
    default:
      return null;
  }
}

// =====================  Exécuteur  =====================
interface Table {
  columns: string[];
  rows: Row[];
}

const AGG_LABEL: Record<AggFn, string> = {
  sum: "Somme",
  avg: "Moyenne",
  median: "Médiane",
  min: "Min",
  max: "Max",
  count: "Nombre",
  count_distinct: "Nombre distinct",
};

export function executePlan(
  dataset: { columns: string[]; rows: Row[] },
  plan: TransformPlan,
): ExecResult {
  let table: Table = { columns: [...dataset.columns], rows: dataset.rows.map((r) => ({ ...r })) };
  const stepNotes: string[] = [];
  const warnings: string[] = [];
  const hasCol = (c: string) => table.columns.includes(c);

  for (const step of plan.steps ?? []) {
    const before = table.rows.length;
    table = applyStep(step, table, warnings, hasCol);
    stepNotes.push(describeStep(step, before, table.rows.length));
  }

  return { columns: table.columns, rows: table.rows, stepNotes, warnings };
}

function applyStep(
  step: PlanStep,
  table: Table,
  warnings: string[],
  hasCol: (c: string) => boolean,
): Table {
  switch (step.op) {
    case "filter": {
      if (!hasCol(step.column)) {
        warnings.push(`Filtre ignoré : colonne « ${step.column} » introuvable.`);
        return table;
      }
      return { columns: table.columns, rows: table.rows.filter((r) => compare(r[step.column] ?? null, step.operator, step.value)) };
    }
    case "select": {
      const cols = step.columns.filter((c) => {
        if (table.columns.includes(c)) return true;
        warnings.push(`Colonne « ${c} » introuvable (ignorée).`);
        return false;
      });
      const keep = cols.length ? cols : table.columns;
      return { columns: keep, rows: table.rows.map((r) => Object.fromEntries(keep.map((c) => [c, r[c] ?? null]))) };
    }
    case "rename": {
      const map = new Map(step.renames.filter((x) => x && x.from && x.to).map((x) => [x.from, x.to]));
      const columns = table.columns.map((c) => map.get(c) ?? c);
      const rows = table.rows.map((r) => {
        const o: Row = {};
        for (const c of table.columns) o[map.get(c) ?? c] = r[c] ?? null;
        return o;
      });
      return { columns, rows };
    }
    case "derive": {
      let node;
      try {
        node = parseFormula(step.formula);
      } catch (e) {
        warnings.push(`Colonne calculée « ${step.name} » ignorée : ${(e as Error).message}`);
        return table;
      }
      const columns = table.columns.includes(step.name) ? table.columns : [...table.columns, step.name];
      const rows = table.rows.map((r) => ({ ...r, [step.name]: evalNode(node, r) }));
      return { columns, rows };
    }
    case "sort": {
      const by = (step.by ?? []).filter((s) => s && s.column);
      const rows = [...table.rows].sort((ra, rb) => {
        for (const { column, dir } of by) {
          const an = toNumber(ra[column] ?? null);
          const bn = toNumber(rb[column] ?? null);
          let c: number;
          if (an !== null && bn !== null) c = an - bn;
          else c = String(ra[column] ?? "").localeCompare(String(rb[column] ?? ""));
          if (c !== 0) return dir === "desc" ? -c : c;
        }
        return 0;
      });
      return { columns: table.columns, rows };
    }
    case "group_aggregate": {
      const groupBy = (step.group_by ?? []).filter((c) => table.columns.includes(c));
      const measures = (step.measures ?? []).filter((m) => m && m.agg);
      const groups = new Map<string, Row[]>();
      for (const r of table.rows) {
        const key = groupBy.map((c) => String(r[c] ?? "")).join("\u0001");
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
      }
      const outCols = [
        ...groupBy,
        ...measures.map((m) => m.as || `${AGG_LABEL[m.agg]} ${m.column || ""}`.trim()),
      ];
      const rows: Row[] = [];
      for (const grp of groups.values()) {
        const o: Row = {};
        groupBy.forEach((c) => (o[c] = grp[0]![c] ?? null));
        measures.forEach((m) => {
          const name = m.as || `${AGG_LABEL[m.agg]} ${m.column || ""}`.trim();
          o[name] = aggregate(m.agg, m.column ? grp.map((r) => r[m.column] ?? null) : grp.map(() => 1));
        });
        rows.push(o);
      }
      return { columns: outCols, rows };
    }
    case "limit": {
      const n = Math.max(0, Math.floor(step.n));
      return { columns: table.columns, rows: table.rows.slice(0, n) };
    }
    default:
      return table;
  }
}

function describeStep(step: PlanStep, before: number, after: number): string {
  switch (step.op) {
    case "filter":
      return `Filtre sur « ${step.column} » : ${before} → ${after} lignes.`;
    case "select":
      return `Colonnes retenues : ${step.columns.join(", ")}.`;
    case "rename":
      return `Renommage : ${step.renames.map((r) => `${r.from} → ${r.to}`).join(", ")}.`;
    case "derive":
      return `Colonne calculée « ${step.name} » = ${step.formula}.`;
    case "sort":
      return `Tri par ${(step.by ?? []).map((s) => `${s.column} (${s.dir ?? "asc"})`).join(", ")}.`;
    case "group_aggregate":
      return `Regroupement par ${(step.group_by ?? []).join(", ")} : ${before} → ${after} lignes.`;
    case "limit":
      return `Limité aux ${after} premières lignes.`;
    default:
      return "";
  }
}
