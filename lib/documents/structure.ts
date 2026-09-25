import type { DocBlock, DocKind, DocModel, HeadingBlock, TableBlock } from "./types";
import { isYear, parseNumber, type NumberInfo } from "./numbers";
import { clean, romanToInt, upperRatio, wordCount } from "./text";

// Structuration d'un document extrait : plan (titres explicites ou déduits),
// section de chaque bloc, légendes et lecture « intelligente » des tableaux
// (en-têtes, lignes de total, colonnes d'effectifs et de pourcentages).

export interface Numbering {
  raw: string;
  parts: number[];
  roman: boolean;
}

export interface HeadingInfo {
  block: HeadingBlock;
  index: number; // position dans ctx.blocks
  numbering: Numbering | null;
  title: string; // texte sans la numérotation
}

export type ColKind = "text" | "count" | "percent" | "id" | "empty";

export interface TableInfo {
  block: TableBlock;
  index: number;
  ordinal: number;
  title: string;
  hasCaption: boolean;
  section: string;
  header: string[];
  preamble: string[];
  body: string[][];
  nums: (NumberInfo | null)[][];
  kinds: ColKind[];
  money: boolean[];
  totalRows: number[]; // indices dans body
  subtotalRows: number[];
  labelCol: number;
  yearCols: { col: number; year: number; relative: boolean }[];
  empty: boolean; // aucune cellule remplie
}

export interface DocContext {
  doc: DocModel;
  kind: DocKind;
  blocks: DocBlock[];
  headings: HeadingInfo[];
  pathOf: string[][];
  headingOf: number[];
  tables: TableInfo[];
  tableAt: Map<number, TableInfo>;
  captionBlocks: Set<number>;
  tocBlocks: Set<number>;
}

const NUMBERING_RE =
  /^\s*((?:[IVXLC]{1,5}|\d{1,2})(?:\s?[.\-–]\s?(?:\d{1,2}|[IVXLC]{1,4}))*)(?:\s?[.)\-–])?\s+(?=\S)/;

export function parseNumbering(text: string): { numbering: Numbering; rest: string } | null {
  const m = text.match(NUMBERING_RE);
  if (!m) return null;
  const tokens = m[1].split(/\s?[.\-–]\s?/).filter(Boolean);
  const parts: number[] = [];
  let roman = false;
  for (const tk of tokens) {
    if (/^\d+$/.test(tk)) parts.push(parseInt(tk, 10));
    else {
      const r = romanToInt(tk);
      if (r === null || r > 20) return null;
      if (parts.length === 0) roman = true;
      parts.push(r);
    }
  }
  return { numbering: { raw: m[1].replace(/\s/g, ""), parts, roman }, rest: text.slice(m[0].length).trim() };
}

export const CAPTION_RE = /^(tableau|table|tab\.)\s*(n°\s*)?[\dIVXLC][\w.\-–]*/i;
const CAPTION_ANY_RE = /^(tableau|table|tab\.|figure|graphique|graphe|carte|schéma|schema|illustration)\b/i;
// Ligne de sommaire : points de conduite (points, « … » ou soulignés, souvent
// mélangés) puis numéro de page.
const TOC_RE = /([.…_]{4,}|…{2,}|\s\.\s\.\s\.)\s*\d{1,3}\s*$|\t\s*[-–]?\s*\d{1,3}\s*[-–]?\s*$/;

export function isTocLine(text: string): boolean {
  return TOC_RE.test(text);
}

// Un paragraphe court, sans ponctuation finale, numéroté ou en capitales
// est très probablement un titre que l'auteur n'a pas stylé.
function inferHeadingLevel(text: string, list: boolean, explicitCount: number): number | null {
  if ((text.match(/\t/g) ?? []).length >= 2) return null; // ligne de tableau saisie avec des tabulations
  const t = text.split("\n")[0].replace(/\t/g, " ").trim();
  if (text.includes("\n") && text.split("\n").length > 2) return null;
  if (t.length > 120 || wordCount(t) > 14 || wordCount(t) === 0) return null;
  if (/[.;,]$/.test(t) || isTocLine(t) || CAPTION_ANY_RE.test(t) || /^(source|note|n\.?\s?b)\b/i.test(t)) return null;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const caps = letters >= 6 && upperRatio(t) >= 0.85;
  // « SITE : MINISTERE… » : un champ, pas un titre.
  const field = /:\s*\S/.test(t);
  if (list) return caps && !field && wordCount(t) >= 2 ? 1 : null;
  const num = parseNumbering(t);
  if (num && num.rest && /^\p{Lu}/u.test(num.rest) && !field) return Math.min(6, num.numbering.parts.length);
  if (caps && !field && wordCount(t) <= 12) return 1;
  if (explicitCount < 3 && /:$/.test(t) && wordCount(t) <= 6 && /^\p{Lu}/u.test(t)) return 2;
  return null;
}

const TOTAL_RE =
  /^(total|totaux|ensemble|sous[- ]?totale?s?|s\/total|somme|co[uû]t total|montant total|grand total)\b/i;
const SUBTOTAL_RE = /^(sous[- ]?total|s\/total)/i;
const ID_COL_RE = /^(n°|no\.?$|n\.$|num[ée]ro|rang|code|ordre|r[ée]f\b|#|étape|etape)/i;
const PCT_HEADER_RE = /%|pourcent|\btaux\b|\bpart\b|proportion/i;
const MONEY_HEADER_RE =
  /montant|co[uû]t|prix|budget|\bp\.?\s?[ut]\b|gnf|usd|\beur\b|euros?|€|fcfa|\$|dotation|cr[ée]dits?|allocation|d[ée]penses|recettes|financement/i;

function filled(row: string[]): number {
  return row.filter((c) => c !== "").length;
}

function numericCount(row: string[]): number {
  return row.filter((c) => c !== "" && parseNumber(c) !== null && isYear(c) === null).length;
}

function lastPart(h: string): string {
  const parts = h.split(" > ");
  return parts[parts.length - 1];
}

function buildTable(
  block: TableBlock,
  index: number,
  ordinal: number,
  caption: string | null,
  section: string,
): TableInfo {
  const raw = block.rows.map((r) => r.map((c) => clean(c)));
  const spans = block.spans;
  const width = Math.max(0, ...raw.map((r) => r.length));
  const base: TableInfo = {
    block,
    index,
    ordinal,
    title: caption ?? `Tableau n°${ordinal} sans titre${section ? ` (section « ${section.split(" › ").pop()} »)` : ""}`,
    hasCaption: !!caption,
    section,
    header: [],
    preamble: [],
    body: [],
    nums: [],
    kinds: [],
    money: [],
    totalRows: [],
    subtotalRows: [],
    labelCol: 0,
    yearCols: [],
    empty: true,
  };
  if (raw.every((r) => filled(r) === 0)) return base;
  base.empty = false;

  // --- Ligne(s) d'en-tête ---
  let h = 0;
  let hCount = 1;
  if (block.headerRows) {
    hCount = block.headerRows;
  } else {
    const limit = Math.min(raw.length, 6);
    h = -1;
    for (let i = 0; i < limit; i++) {
      const f = filled(raw[i]);
      if (f >= Math.min(2, width) && numericCount(raw[i]) <= f / 3) {
        h = i;
        break;
      }
    }
    if (h < 0) h = raw.findIndex((r) => filled(r) > 0);
    const next = raw[h + 1];
    const after = raw[h + 2];
    if (
      next &&
      after &&
      filled(next) >= 2 &&
      numericCount(next) === 0 &&
      next.every((c) => c.length <= 25) &&
      (next[0] === "" || next[0] === raw[h][0]) &&
      numericCount(after) > 0
    ) {
      hCount = 2;
    }
  }
  base.preamble = raw.slice(0, h).filter((r) => filled(r) > 0).map((r) => r.filter(Boolean).join(" — "));
  const cellAt = (r: number, c: number): string => {
    const row = raw[r] ?? [];
    if (spans && spans[r] && spans[r][c] === 0) {
      for (let k = c - 1; k >= 0; k--) if (spans[r][k] > 0) return row[k] ?? "";
    }
    return row[c] ?? "";
  };
  for (let c = 0; c < width; c++) {
    const parts: string[] = [];
    for (let r = h; r < h + hCount; r++) {
      const v = cellAt(r, c);
      if (v && parts[parts.length - 1] !== v) parts.push(v);
    }
    base.header.push(parts.join(" > "));
  }
  base.body = raw.slice(h + hCount).filter((r) => filled(r) > 0).map((r) => {
    const row = r.slice(0, width);
    while (row.length < width) row.push("");
    return row;
  });
  base.nums = base.body.map((r) => r.map((c) => (c === "" ? null : parseNumber(c))));

  // --- Lignes de total ---
  base.body.forEach((row, r) => {
    const label = row.slice(0, 2).find((c) => c !== "" && parseNumber(c) === null) ?? "";
    if (TOTAL_RE.test(label)) {
      base.totalRows.push(r);
      if (SUBTOTAL_RE.test(label)) base.subtotalRows.push(r);
    }
  });

  // --- Nature des colonnes ---
  const totalSet = new Set(base.totalRows);
  for (let c = 0; c < width; c++) {
    const vals: (NumberInfo | null)[] = [];
    let nonEmpty = 0;
    base.body.forEach((row, r) => {
      if (totalSet.has(r) || row[c] === "") return;
      nonEmpty++;
      vals.push(base.nums[r][c]);
    });
    const header = base.header[c] ?? "";
    const nums = vals.filter((v): v is NumberInfo => v !== null);
    let kind: ColKind;
    if (nonEmpty === 0) kind = base.totalRows.some((r) => base.body[r][c] !== "") ? "count" : "empty";
    else if (ID_COL_RE.test(lastPart(header)) || ID_COL_RE.test(header)) kind = "id";
    else if (nums.length / nonEmpty >= 0.6) {
      const pctCells = nums.filter((n) => n.percent).length;
      kind = PCT_HEADER_RE.test(lastPart(header)) || pctCells / nums.length >= 0.6 ? "percent" : "count";
    } else kind = "text";
    base.kinds.push(kind);
    base.money.push(MONEY_HEADER_RE.test(header) || nums.some((n) => n.currency !== null));
    // Colonne d'année : même si elle contient beaucoup de « ND » ou de
    // « Oui » (cadres de performance), c'est une année de la série.
    const hasValue = nums.length > 0 || kind === "count" || kind === "percent";
    const y = isYear(lastPart(header));
    if (y !== null && hasValue) base.yearCols.push({ col: c, year: y, relative: false });
    const rel = lastPart(header).match(/^n\s*(?:\+\s*(\d))?$/i);
    if (rel && hasValue) base.yearCols.push({ col: c, year: rel[1] ? parseInt(rel[1], 10) : 0, relative: true });
  }
  const firstText = base.kinds.findIndex((k) => k === "text");
  base.labelCol = firstText >= 0 ? firstText : 0;
  return base;
}

export function buildContext(doc: DocModel, kind: DocKind): DocContext {
  const explicitCount = doc.blocks.filter((b) => b.kind === "heading" && !b.inferred).length;
  const tocBlocks = new Set<number>();

  // Titres déduits pour les paragraphes qui en ont toutes les caractéristiques.
  const blocks: DocBlock[] = doc.blocks.map((b, i) => {
    // Entrée de sommaire saisie avec un style de titre : ce n'est pas un titre.
    if (b.kind === "heading" && isTocLine(b.text)) {
      tocBlocks.add(i);
      return { kind: "paragraph", id: b.id, text: b.text, list: false, page: b.page };
    }
    if (b.kind !== "paragraph") return b;
    if (isTocLine(b.text)) {
      tocBlocks.add(i);
      return b;
    }
    if (doc.format === "sheet") return b;
    const level = inferHeadingLevel(b.text, b.list, explicitCount);
    if (level === null) return b;
    return { kind: "heading", id: b.id, level, text: b.text.replace(/\s*:\s*$/, "").trim(), inferred: true, page: b.page };
  });

  const headings: HeadingInfo[] = [];
  const pathOf: string[][] = [];
  const headingOf: number[] = [];
  const stack: { level: number; text: string; hi: number }[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "heading") {
      while (stack.length && stack[stack.length - 1].level >= b.level) stack.pop();
      const num = parseNumbering(b.text);
      headings.push({ block: b, index: i, numbering: num?.numbering ?? null, title: num?.rest || b.text });
      stack.push({ level: b.level, text: b.text, hi: headings.length - 1 });
    }
    pathOf.push(stack.map((s) => s.text));
    headingOf.push(stack.length ? stack[stack.length - 1].hi : -1);
  });

  // Légendes des tableaux : au-dessus (le plus courant), en dessous, ou dans
  // la première cellule du tableau.
  const captionBlocks = new Set<number>();
  const tables: TableInfo[] = [];
  const tableAt = new Map<number, TableInfo>();
  let ordinal = 0;
  const paragraphText = (i: number): string | null => {
    const b = blocks[i];
    return b && b.kind === "paragraph" && !tocBlocks.has(i) ? b.text : null;
  };
  // Tableau sans aucun texte : résidu de mise en page (souvent intercalé
  // entre une légende et le vrai tableau). Il ne prend jamais de légende.
  const blank = (k: number) => {
    const t = blocks[k];
    return !!t && t.kind === "table" && t.rows.every((r) => r.every((c) => c.trim() === ""));
  };
  blocks.forEach((b, i) => {
    if (b.kind !== "table") return;
    ordinal++;
    let caption: string | null = b.caption ?? null;
    if (!caption && !blank(i)) {
      let j = i - 1;
      while (j >= 0 && (blocks[j].kind === "figure" || blank(j))) j--;
      const p1 = paragraphText(j);
      const p2 = paragraphText(j - 1);
      if (p1 && CAPTION_RE.test(p1) && p1.length <= 220) {
        caption = p1;
        captionBlocks.add(j);
      } else if (p1 && p2 && CAPTION_RE.test(p2) && wordCount(p2) <= 4 && wordCount(p1) <= 14) {
        caption = `${p2} ${p1}`;
        captionBlocks.add(j);
        captionBlocks.add(j - 1);
      } else {
        // Légende sous le tableau, sauf si elle précède elle-même un tableau.
        const n1 = paragraphText(i + 1);
        const nextIsTable = blocks.slice(i + 2, i + 4).some((x, k) => x.kind === "table" && !blank(i + 2 + k));
        if (n1 && CAPTION_RE.test(n1) && n1.length <= 220 && !nextIsTable) {
          caption = n1;
          captionBlocks.add(i + 1);
        } else {
          const first = b.rows[0]?.find((c) => c.trim() !== "")?.trim();
          if (first && CAPTION_RE.test(first)) caption = first;
        }
      }
    }
    const t = buildTable(b, i, ordinal, caption ? clean(caption) : null, pathOf[i].join(" › "));
    tables.push(t);
    tableAt.set(i, t);
  });

  return { doc, kind, blocks, headings, pathOf, headingOf, tables, tableAt, captionBlocks, tocBlocks };
}

// Texte d'un bloc (les tableaux sont aplatis cellule par cellule).
export function blockText(b: DocBlock): string {
  if (b.kind === "heading" || b.kind === "paragraph") return b.text;
  if (b.kind === "table") return b.rows.map((r) => r.filter(Boolean).join(" | ")).join("\n");
  return "";
}
