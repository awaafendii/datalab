import type { Anomaly, BudgetLink, LfComparisonRow } from "../types";
import type { DocContext, TableInfo } from "../structure";
import {
  LF,
  detectSection,
  imputationLabel,
  labelSimilarity,
  programmeKey,
  sectionByCode,
  titreLabelMatches,
  titreOf,
  type ImputationLevel,
  type LfProgramme,
  type LfSection,
  type SectionMatch,
  type TitreCode,
} from "../lf";
import { findSynthese, programmeNumber } from "./cdmt";
import { isMoneyTable, rowKind } from "./tables";
import { anomaly, blockLoc, listSome, rowLabel, tableLoc } from "./util";
import { fmt, norm, truncate } from "../text";

// Conformité à la loi de finances en vigueur, pour tous les ministères :
// rattachement du document à sa section budgétaire (code ministère), cadrage
// des montants (LF de l'année et LFR de l'année précédente) par programme et
// par titre, programmes et intitulés de la nomenclature, libellés des titres
// et des imputations (titre-chapitre-article-paragraphe).

const TITRES: TitreCode[] = ["1", "2", "3", "4", "5"];

type Amounts = { lf?: number; lfr?: number };

interface DocProgramme {
  key: string;
  label: string;
  amounts: Amounts;
  natures: Partial<Record<TitreCode, Amounts>>;
}

interface DocBudget {
  table: TableInfo; // tableau de référence (synthèse ou tableau par nature)
  total: Amounts;
  programmes: DocProgramme[];
  natureTable: TableInfo | null;
  natures: Partial<Record<TitreCode, Amounts>>; // niveau section
}

// --- Lecture des tableaux du document ---

const SCALE: Record<string, number> = { milliers: 1e3, millions: 1e6, milliards: 1e9 };
function scaleOf(t: TableInfo): number {
  const m = norm([t.title, ...t.preamble, ...t.header].join(" ")).match(/en (milliers|millions|milliards)\b/);
  return m ? SCALE[m[1]] : 1;
}

// Colonnes « LF de l'année » (« 2026 », « LFI 2026 », « LF 2026 ») et « LFR
// de l'année précédente » (« LFR 2025 ») ; les colonnes d'exécution ou
// d'écart ne comptent pas.
function lawColumns(t: TableInfo): { lf?: number; lfr?: number } {
  const out: { lf?: number; lfr?: number } = {};
  for (const y of t.yearCols) {
    if (y.relative || t.kinds[y.col] !== "count") continue;
    const h = norm(t.header[y.col]);
    if (/realis|execut|engag|liquid|ordonnanc|taux|ecart|variation|%/.test(h)) continue;
    if (y.year === LF.annee && !/\blfr\b/.test(h)) out.lf ??= y.col;
    else if (y.year === LF.anneeLfr && /\blfr\b/.test(h)) out.lfr ??= y.col;
  }
  return out;
}

function amountsAt(t: TableInfo, r: number, cols: { lf?: number; lfr?: number }): Amounts {
  const scale = scaleOf(t);
  const at = (c?: number) => {
    const v = c === undefined ? undefined : t.nums[r]?.[c]?.value;
    // Montants ramenés en GNF (arrondis : « 770 057,75 » millions).
    return v === undefined || v === null ? undefined : Math.round(v * scale);
  };
  return { lf: at(cols.lf), lfr: at(cols.lfr) };
}

const addTo = (target: Amounts, a: Amounts) => {
  if (a.lf !== undefined) target.lf = (target.lf ?? 0) + a.lf;
  if (a.lfr !== undefined) target.lfr = (target.lfr ?? 0) + a.lfr;
};

const cleanProgrammeLabel = (label: string) =>
  label
    .replace(/^\s*(?:sous-)?programme\s*(?:n°|no)?\s*\d{1,3}\s*[-–—:.]?\s*/i, "")
    .replace(/^\s*2[12]\d{3}\s*[-–—]\s*/, "")
    .trim();

// Tableau « emploi des ressources par programme et nature » : programmes
// suivis de leurs titres (« 2 Dépenses de personnel »…), ou titres seuls.
function readNatures(t: TableInfo): { programmes: Map<string, DocProgramme>; natures: Partial<Record<TitreCode, Amounts>>; count: number } {
  const cols = lawColumns(t);
  const programmes = new Map<string, DocProgramme>();
  const natures: Partial<Record<TitreCode, Amounts>> = {};
  let current: DocProgramme | null = null;
  let count = 0;
  t.body.forEach((row, r) => {
    if (t.totalRows.includes(r)) return;
    const label = row[t.labelCol] || rowLabel(t, r);
    const kind = rowKind(label);
    if (kind === "programme") {
      const key = programmeNumber(label);
      if (!key) return;
      current = programmes.get(key) ?? { key, label: cleanProgrammeLabel(label), amounts: amountsAt(t, r, cols), natures: {} };
      programmes.set(key, current);
      return;
    }
    if (kind !== "nature") return;
    const titre = titreOf(label);
    if (!titre) return;
    count++;
    const a = amountsAt(t, r, cols);
    const target: Partial<Record<TitreCode, Amounts>> = current ? (current as DocProgramme).natures : natures;
    addTo((target[titre] ??= {}), a);
  });
  if (programmes.size) {
    for (const p of programmes.values()) for (const k of TITRES) if (p.natures[k]) addTo((natures[k] ??= {}), p.natures[k]!);
  }
  return { programmes, natures, count };
}

function readBudget(ctx: DocContext): DocBudget | null {
  const synthese = findSynthese(ctx);
  const candidates = ctx.tables.filter((t) => !t.empty && isMoneyTable(t) && (lawColumns(t).lf !== undefined || lawColumns(t).lfr !== undefined));
  let natureTable: TableInfo | null = null;
  let natureRead: ReturnType<typeof readNatures> | null = null;
  for (const t of candidates) {
    const read = readNatures(t);
    if (read.count < 2) continue;
    if (!natureRead || read.programmes.size > natureRead.programmes.size || (read.programmes.size === natureRead.programmes.size && read.count > natureRead.count)) {
      natureTable = t;
      natureRead = read;
    }
  }
  const synthCols = synthese ? lawColumns(synthese.t) : {};
  if (synthese && (synthCols.lf !== undefined || synthCols.lfr !== undefined)) {
    const s = synthese;
    const programmes: DocProgramme[] = [...s.programmes.entries()].map(([key, r]) => ({
      key,
      label: cleanProgrammeLabel(s.t.body[r][s.t.labelCol] || rowLabel(s.t, r)),
      amounts: amountsAt(s.t, r, synthCols),
      natures: natureRead?.programmes.get(key)?.natures ?? {},
    }));
    const total = s.totalRow !== undefined ? amountsAt(s.t, s.totalRow, synthCols) : programmes.reduce<Amounts>((acc, p) => (addTo(acc, p.amounts), acc), {});
    return { table: s.t, total, programmes, natureTable, natures: natureRead?.natures ?? {} };
  }
  if (natureTable && natureRead) {
    const tr = natureTable.totalRows.filter((r) => !natureTable!.subtotalRows.includes(r)).pop();
    const total = tr !== undefined ? amountsAt(natureTable, tr, lawColumns(natureTable)) : {};
    return { table: natureTable, total, programmes: [...natureRead.programmes.values()], natureTable, natures: natureRead.natures };
  }
  return null;
}

// --- Présentation des montants ---

function money(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${fmt(v / 1e9, 2)} milliards de GNF`;
  if (a >= 1e6) return `${fmt(v / 1e6, 2)} millions de GNF`;
  return `${fmt(v, 0)} GNF`;
}
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + money(Math.abs(v));
const pct = (gap: number, base: number) => (base ? ` (${gap > 0 ? "+" : "−"}${fmt(Math.abs((gap / base) * 100), 1)} %)` : "");
const tolerance = (t: TableInfo) => Math.max(1, scaleOf(t) / 2);

// --- Correspondance programmes du document ↔ programmes de la LF ---

interface ProgrammePair {
  doc: DocProgramme;
  law: LfProgramme | null;
  byLabel: boolean;
}

function pairProgrammes(docs: DocProgramme[], laws: LfProgramme[]): { pairs: ProgrammePair[]; missing: LfProgramme[] } {
  const used = new Set<string>();
  const pairs: ProgrammePair[] = [];
  for (const d of docs) {
    let best: LfProgramme | null = null;
    let bestSim = 0;
    for (const l of laws) {
      const sim = labelSimilarity(d.label, l.libelle);
      if (sim > bestSim && !used.has(l.code)) [best, bestSim] = [l, sim];
    }
    if (best && bestSim >= 0.5) {
      used.add(best.code);
      pairs.push({ doc: d, law: best, byLabel: true });
      continue;
    }
    const byKey = laws.find((l) => programmeKey(l.code) === d.key && !used.has(l.code)) ?? null;
    if (byKey) used.add(byKey.code);
    pairs.push({ doc: d, law: byKey, byLabel: false });
  }
  return { pairs, missing: laws.filter((l) => !used.has(l.code)) };
}

const TITRE_SHORT: Record<TitreCode, string> = {
  "1": "charges financières",
  "2": "personnel",
  "3": "biens et services",
  "4": "transferts",
  "5": "investissement",
};

// --- Cadrage des montants sur la loi de finances ---

function cadrage(ctx: DocContext, section: LfSection, budget: DocBudget, rows: LfComparisonRow[]): Anomaly[] {
  const out: Anomaly[] = [];
  const tol = tolerance(budget.table);
  const law = `LF ${LF.annee}`;
  const lawR = `LFR ${LF.anneeLfr}`;
  const who = `section ${section.code} (${section.nom})`;

  // Total de l'année de la loi.
  if (budget.total.lf !== undefined) {
    rows.push({ scope: "Total", level: 0, column: law, document: budget.total.lf, law: section.total.lf });
    const gap = budget.total.lf - section.total.lf;
    if (Math.abs(gap) > tol) {
      out.push(
        anomaly({
          key: "total-lf",
          rule: "lf-total",
          category: "budget",
          severity: section.total.lf && Math.abs(gap) / section.total.lf >= 0.01 ? "bloquante" : "majeure",
          title: `Total ${LF.annee} différent de la ${law} (${signed(gap)})`,
          detail: `Le document prévoit ${money(budget.total.lf)} pour ${LF.annee} (« ${truncate(budget.table.title, 70)} ») ; la ${law} ouvre ${money(section.total.lf)} à la ${who}. Écart : ${signed(gap)}${pct(gap, section.total.lf)}.`,
          suggestion: `Aligner la colonne ${LF.annee} sur les crédits votés par la ${law} (loi en vigueur), programme par programme et titre par titre ; si l'écart est voulu (arbitrage postérieur, LFR attendue), le justifier explicitement dans le document.`,
          location: tableLoc(ctx, budget.table),
        }),
      );
    }
  }

  // Programmes (ministères en budget-programme).
  const lawProgrammes = section.programmes ?? [];
  if (lawProgrammes.length && budget.programmes.length) {
    const { pairs, missing } = pairProgrammes(budget.programmes, lawProgrammes);
    const gaps: string[] = [];
    const labels: string[] = [];
    const unknown: string[] = [];
    for (const { doc, law: lp, byLabel } of pairs) {
      const name = `programme ${doc.key.padStart(3, "0")} « ${truncate(doc.label, 45)} »`;
      if (!lp) {
        unknown.push(name);
        continue;
      }
      if (!byLabel && labelSimilarity(doc.label, lp.libelle) < 0.5) labels.push(`${name} : intitulé LF ${lp.code} « ${lp.libelle} »`);
      else if (byLabel && programmeKey(lp.code) !== doc.key) labels.push(`${name} correspond au programme ${lp.code} « ${lp.libelle} », rang ${programmeKey(lp.code)} dans la LF`);
      rows.push({ scope: `Programme ${doc.key.padStart(3, "0")} — ${truncate(doc.label, 40)} (${lp.code})`, level: 1, column: law, document: doc.amounts.lf ?? null, law: lp.montant });
      const natureGaps: string[] = [];
      for (const k of TITRES) {
        const d = doc.natures[k]?.lf;
        const l = lp.natures[k] ?? 0;
        if (d === undefined && !l) continue;
        rows.push({ scope: `${k} ${LF.titres[k] ?? TITRE_SHORT[k]}`, level: 2, column: law, document: d ?? null, law: l });
        if (d !== undefined || Object.keys(doc.natures).length) {
          const g = (d ?? 0) - l;
          if (Math.abs(g) > tol) natureGaps.push(`${TITRE_SHORT[k]} ${signed(g)}`);
        }
      }
      if (doc.amounts.lf === undefined) continue;
      const gap = doc.amounts.lf - lp.montant;
      if (Math.abs(gap) > tol || natureGaps.length) {
        gaps.push(
          `${name} (${lp.code}) : ${money(doc.amounts.lf)} contre ${money(lp.montant)} dans la ${law}${Math.abs(gap) > tol ? `, écart ${signed(gap)}` : ""}${natureGaps.length ? ` — par titre : ${natureGaps.join(", ")}` : ""}`,
        );
      }
    }
    if (gaps.length) {
      out.push(
        anomaly({
          key: "programmes-lf",
          rule: "lf-programmes",
          category: "budget",
          severity: "majeure",
          title: `Montants ${LF.annee} des programmes différents de la ${law} (${gaps.length})`,
          detail: `${listSome(gaps, 6)}. Référence : ${law}, annexe « Présentation des programmes ministériels par nature économique de la dépense ».`,
          suggestion: `Reprendre pour chaque programme et chaque titre les montants de la ${law} (colonne ${LF.annee}), puis recalculer les années suivantes et les cumuls.`,
          location: tableLoc(ctx, budget.natureTable ?? budget.table),
        }),
      );
    }
    if (unknown.length || missing.length) {
      out.push(
        anomaly({
          key: "programmes-nomenclature",
          rule: "lf-programmes-nomenclature",
          category: "budget",
          severity: "majeure",
          title: `Programmes non conformes à la ${law} (${unknown.length + missing.length})`,
          detail: [
            unknown.length ? `Absents de la ${law} : ${listSome(unknown, 4)}` : "",
            missing.length ? `Inscrits dans la ${law} mais absents du document : ${missing.map((p) => `${p.code} « ${p.libelle} » (${money(p.montant)})`).join(" ; ")}` : "",
          ]
            .filter(Boolean)
            .join(". ") + ".",
          suggestion: `La liste des programmes de la ${who} est fixée par la ${law} : ${lawProgrammes.map((p) => `${p.code} ${p.libelle}`).join(", ")}.`,
          location: tableLoc(ctx, budget.table),
        }),
      );
    }
    if (labels.length) {
      out.push(
        anomaly({
          key: "intitules-lf",
          rule: "lf-intitules-programmes",
          category: "coherence",
          severity: "mineure",
          title: `Intitulés ou numéros de programmes différents de la ${law} (${labels.length})`,
          detail: listSome(labels, 5) + ".",
          suggestion: "Employer l'intitulé officiel et l'ordre des programmes de la loi de finances (programme support 21001 en premier, puis 22001, 22002…).",
          location: tableLoc(ctx, budget.table),
        }),
      );
    }
  } else {
    // Section sans budget-programme dans la LF : cadrage par titre.
    const natureGaps: string[] = [];
    for (const k of TITRES) {
      const d = budget.natures[k]?.lf;
      const l = section.titres[k]?.lf ?? 0;
      if (d === undefined) continue;
      rows.push({ scope: `${k} ${LF.titres[k] ?? TITRE_SHORT[k]}`, level: 1, column: law, document: d, law: l });
      const g = d - l;
      if (Math.abs(g) > tol) natureGaps.push(`titre ${k} (${TITRE_SHORT[k]}) : ${money(d)} contre ${money(l)}, écart ${signed(g)}`);
    }
    if (natureGaps.length) {
      out.push(
        anomaly({
          key: "titres-lf",
          rule: "lf-titres",
          category: "budget",
          severity: "majeure",
          title: `Répartition ${LF.annee} par titre différente de la ${law} (${natureGaps.length})`,
          detail: `${who} : ${listSome(natureGaps, 5)}.`,
          suggestion: `Reprendre les montants par titre de la ${law} (répartition par ministère, titre, chapitre et article).`,
          location: tableLoc(ctx, budget.natureTable ?? budget.table),
        }),
      );
    }
  }

  // Année de référence : LFR de l'année précédente.
  if (budget.total.lfr !== undefined) {
    rows.push({ scope: "Total", level: 0, column: lawR, document: budget.total.lfr, law: section.total.lfr });
    const issues: string[] = [];
    const gap = budget.total.lfr - section.total.lfr;
    if (Math.abs(gap) > tol) issues.push(`total : ${money(budget.total.lfr)} contre ${money(section.total.lfr)}, écart ${signed(gap)}${pct(gap, section.total.lfr)}`);
    for (const k of TITRES) {
      const d = budget.natures[k]?.lfr;
      const l = section.titres[k]?.lfr;
      if (d === undefined && !l) continue;
      rows.push({ scope: `${k} ${LF.titres[k] ?? TITRE_SHORT[k]}`, level: 1, column: lawR, document: d ?? null, law: l ?? 0 });
      if (!Object.keys(budget.natures).length) continue;
      const g = (d ?? 0) - (l ?? 0);
      if (Math.abs(g) > tol) issues.push(`titre ${k} (${TITRE_SHORT[k]}) : écart ${signed(g)}`);
    }
    if (issues.length) {
      out.push(
        anomaly({
          key: "lfr",
          rule: "lf-reference-lfr",
          category: "budget",
          severity: "majeure",
          title: `Colonne ${lawR} différente de la ${lawR} votée (${issues.length})`,
          detail: `${who} : ${listSome(issues, 6)}. Référence : colonne « ${lawR} » de la ${law}.`,
          suggestion: `L'année de référence doit reprendre les crédits de la ${lawR} tels qu'ils figurent dans la ${law} ; corriger la colonne ou préciser qu'il s'agit d'une autre base (exécution, LFI).`,
          location: tableLoc(ctx, budget.natureTable ?? budget.table),
        }),
      );
    }
  }
  return out;
}

// --- Libellés des titres (nature économique) ---

function titreLabels(ctx: DocContext): Anomaly[] {
  const issues: string[] = [];
  let first: TableInfo | null = null;
  const seen = new Set<string>();
  for (const t of ctx.tables) {
    if (t.empty || !isMoneyTable(t)) continue;
    t.body.forEach((row, r) => {
      const label = (row[t.labelCol] || rowLabel(t, r)).trim();
      if (rowKind(label) !== "nature") return;
      const m = norm(label).match(/^(?:titre\s*)?([0-9])\b/);
      if (!m) return;
      const code = m[1];
      const key = norm(label);
      if (seen.has(key)) return;
      seen.add(key);
      if (!TITRES.includes(code as TitreCode)) issues.push(`« ${truncate(label, 50)} » : le titre ${code} n'existe pas (titres 1 à 5)`);
      else if (!titreLabelMatches(code as TitreCode, label)) issues.push(`« ${truncate(label, 50)} » : le titre ${code} est « ${LF.titres[code]} »`);
      else return;
      first ??= t;
    });
  }
  if (!issues.length) return [];
  return [
    anomaly({
      key: "titres-libelles",
      rule: "lf-titres-libelles",
      category: "budget",
      severity: "majeure",
      title: `Numéro de titre et libellé de nature incompatibles (${issues.length})`,
      detail: listSome(issues, 5) + ".",
      suggestion: `Nomenclature de la LF ${LF.annee} : ${Object.entries(LF.titres).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      location: first ? tableLoc(ctx, first) : {},
    }),
  ];
}

// --- Imputations budgétaires citées (3-3-6-10-00, article 3-6-2…) ---

const CODE5_RE = /(^|[^\d-])([1-5])[-.](\d)[-.](\d)[-.](\d{2})[-.](\d{2})(?![\d-])/g;
const CODE3_RE = /(^|[^\d-])([1-5])-(\d)-(\d)(?![\d-]|[.,]\d)/g;
const CODE_CONTEXT_RE = /(imputation|article|ligne(?: budgetaire)?|nature(?: economique)?|compte|code)\s*(?:n°|no|:)?\s*$/;
const CODE_HEADER_RE = /imputation|code|nature|article|ligne|compte/;

const LEVELS: Record<number, ImputationLevel> = { 1: "titre", 2: "chapitre", 3: "article", 5: "paragraphe" };
function entriesOf(level: ImputationLevel): [string, string][] {
  const src = level === "titre" ? LF.titres : level === "chapitre" ? LF.chapitres : level === "article" ? LF.articles : LF.paragraphes;
  return Object.entries(src);
}

// Libellé cité juste après le code (« 3-6-2 Frais de mission », « 3-6-2 : … »).
function citedLabel(after: string): string {
  const m = after.match(/^\s*(?:[-–—:=]\s*|\(\s*)?([A-ZÀ-Ýa-zà-ÿ][^;.()\t\n]{3,90})/);
  if (!m) return "";
  const words = m[1].trim().split(/\s+/).slice(0, 12).join(" ");
  return words.replace(/\s+\d[\d\s.,]*$/, "").trim();
}

function imputations(ctx: DocContext): Anomaly[] {
  const unknown: string[] = [];
  const wrong: string[] = [];
  const differs: string[] = [];
  const seen = new Set<string>();
  let firstIdx = -1;
  let firstTable: TableInfo | null = null;

  const check = (code: string, label: string, where: () => void) => {
    const key = code + "|" + norm(label);
    if (seen.has(key)) return;
    seen.add(key);
    const parts = code.split("-");
    const found = imputationLabel(code);
    if (!found) {
      // Paragraphe inconnu mais article connu : simple paragraphe non ouvert
      // dans la LF ; sinon le code n'existe pas dans la nomenclature.
      const article = imputationLabel(parts.slice(0, 3).join("-"));
      const chapitre = imputationLabel(parts.slice(0, 2).join("-"));
      if (parts.length === 5 && article) return;
      unknown.push(`${code}${label ? ` « ${truncate(label, 40)} »` : ""} : ${chapitre ? `article ${parts.slice(0, 3).join("-")} inconnu du chapitre ${chapitre.label.toLowerCase()}` : `chapitre ${parts.slice(0, 2).join("-")} inexistant`}`);
      where();
      return;
    }
    if (!label || label.split(/\s+/).length < 2) return;
    const sim = labelSimilarity(found.label, label);
    if (sim >= 0.34) return;
    // Le libellé peut être celui du niveau supérieur (article pour un paragraphe).
    for (let n = parts.length - 1; n >= 1; n--) {
      if (!LEVELS[n]) continue;
      const parent = imputationLabel(parts.slice(0, n).join("-"));
      if (parent && labelSimilarity(parent.label, label) >= 0.5) return;
    }
    // Code qui correspond au libellé cité, à n'importe quel niveau (« Frais
    // de mission » est l'article 3-6-2).
    let best: [string, string] | null = null;
    let bestSim = 0;
    for (const lv of ["paragraphe", "article", "chapitre"] as ImputationLevel[]) {
      for (const e of entriesOf(lv)) {
        const s = labelSimilarity(e[1], label);
        if (s > bestSim) [best, bestSim] = [e, s];
      }
    }
    if (best && bestSim >= 0.6 && !code.startsWith(best[0]))
      wrong.push(`${code} « ${truncate(label, 45)} » : ce code est « ${found.label} » ; le libellé correspond à ${best[0]} (« ${best[1]} »)`);
    else differs.push(`${code} « ${truncate(label, 45)} » : libellé officiel « ${found.label} »`);
    where();
  };

  const scan = (text: string, requireContext: boolean, onHit: () => void) => {
    let m: RegExpExecArray | null;
    CODE5_RE.lastIndex = 0;
    while ((m = CODE5_RE.exec(text))) {
      const code = [m[2], m[3], m[4], m[5], m[6]].join("-");
      check(code, citedLabel(text.slice(m.index + m[0].length)), onHit);
    }
    CODE3_RE.lastIndex = 0;
    while ((m = CODE3_RE.exec(text))) {
      const start = m.index + m[1].length;
      if (requireContext && !CODE_CONTEXT_RE.test(norm(text.slice(Math.max(0, start - 30), start)))) continue;
      const code = [m[2], m[3], m[4]].join("-");
      check(code, citedLabel(text.slice(m.index + m[0].length)), onHit);
    }
  };

  ctx.blocks.forEach((b, i) => {
    if (b.kind === "paragraph" || b.kind === "heading") scan(b.text, true, () => (firstIdx < 0 ? (firstIdx = i) : 0));
  });
  for (const t of ctx.tables) {
    const codeCols = new Set(t.header.map((h, c) => (CODE_HEADER_RE.test(norm(h)) ? c : -1)).filter((c) => c >= 0));
    t.body.forEach((row) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        // Dans une colonne « Imputation », le libellé est souvent dans la cellule suivante.
        const next = row.slice(c + 1).find((x) => x && !/^[\d\s.,%-]+$/.test(x)) ?? "";
        const text = codeCols.has(c) && /^\s*[1-5](?:[-.]\d){2}(?:[-.]\d{2}){0,2}\s*$/.test(cell) ? `${cell.trim()} ${next}` : cell;
        scan(text, !codeCols.has(c), () => (firstTable ??= t));
      });
    });
  }

  const out: Anomaly[] = [];
  const loc = () => (firstTable ? tableLoc(ctx, firstTable) : firstIdx >= 0 ? blockLoc(ctx, firstIdx) : {});
  if (unknown.length || wrong.length) {
    out.push(
      anomaly({
        key: "imputations",
        rule: "lf-imputations",
        category: "budget",
        severity: "majeure",
        title: `Imputations budgétaires erronées (${unknown.length + wrong.length})`,
        detail: listSome([...wrong, ...unknown], 6) + ".",
        suggestion: `Utiliser les codes de la nomenclature budgétaire (titre-chapitre-article-paragraphe) et leurs libellés tels qu'ils figurent dans la LF ${LF.annee}.`,
        location: loc(),
      }),
    );
  }
  if (differs.length) {
    out.push(
      anomaly({
        key: "imputations-libelles",
        rule: "lf-imputations-libelles",
        category: "coherence",
        severity: "mineure",
        title: `Libellés d'imputation différents de la nomenclature (${differs.length})`,
        detail: listSome(differs, 6) + ".",
        suggestion: "Reprendre le libellé officiel du code (ou corriger le code s'il ne correspond pas à la dépense décrite).",
        location: loc(),
      }),
    );
  }
  return out;
}

// --- Point d'entrée ---

export function lfRules(ctx: DocContext, sectionCode?: string): { link: BudgetLink | null; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [...titreLabels(ctx), ...imputations(ctx)];
  let match: SectionMatch | null = null;
  if (sectionCode) {
    const s = sectionByCode(sectionCode);
    if (s) match = { section: s, evidence: "section choisie manuellement", manual: true };
  } else match = detectSection(ctx.blocks, ctx.doc.fileName);
  if (!match) return { link: null, anomalies };

  const { section } = match;
  const rows: LfComparisonRow[] = [];
  const budget = readBudget(ctx);
  // Le cadrage ne vaut que pour un document couvrant tout le ministère :
  // CDMT, ou tableau de synthèse par programme.
  const whole = ctx.kind === "cdmt" || (budget !== null && budget.programmes.length >= 2);
  if (budget && whole) anomalies.push(...cadrage(ctx, section, budget, rows));
  if (whole && section.total.lf === 0 && section.total.lfr > 0) {
    anomalies.push(
      anomaly({
        key: "section-sans-credits",
        rule: "lf-section-sans-credits",
        category: "budget",
        severity: "majeure",
        title: `Aucun crédit ouvert à la section ${section.code} dans la LF ${LF.annee}`,
        detail: `La LF ${LF.annee} n'ouvre aucun crédit à la section ${section.code} (${section.nom}), dotée de ${money(section.total.lfr)} en LFR ${LF.anneeLfr} : le ministère a vraisemblablement été fusionné ou réorganisé.`,
        suggestion: "Vérifier la section de rattachement du document (voir la liste des sections de la loi de finances) et reprendre les crédits de la nouvelle section.",
        location: {},
      }),
    );
  }
  const link: BudgetLink = {
    annee: LF.annee,
    anneeLfr: LF.anneeLfr,
    source: LF.source,
    section: {
      code: section.code,
      nom: section.nom,
      lf: section.total.lf,
      lfr: section.total.lfr,
      programmes: (section.programmes ?? []).map((p) => ({ code: p.code, libelle: p.libelle, montant: p.montant })),
    },
    evidence: match.evidence,
    manual: match.manual,
    comparison: rows,
  };
  return { link, anomalies };
}


// --- La loi de finances elle-même ---

// Chargée dans DataLab, la loi de finances n'est pas contrôlée : on vérifie
// seulement qu'elle correspond au référentiel intégré, sinon on indique
// comment le régénérer.
export function lfDocumentNotice(ctx: DocContext): Anomaly[] {
  const text = norm(
    ctx.blocks
      .slice(0, 600)
      .map((b) => (b.kind === "paragraph" || b.kind === "heading" ? b.text : b.kind === "table" ? b.rows.slice(0, 3).flat().join(" ") : ""))
      .join(" "),
  );
  const y = text.match(/loi de finances (?:initiale |rectificative )?(?:pour l.annee )?((?:19|20)\d{2})/) ?? text.match(/\blfi? ((?:19|20)\d{2})\b/);
  const year = y ? parseInt(y[1], 10) : null;
  const rectificative = /loi de finances rectificative/.test(text);
  const same = year === LF.annee && !rectificative;
  const summary = `${LF.sections.length} sections budgétaires, ${LF.sections.filter((s) => s.programmes?.length).length} ministères en budget-programme, ${Object.keys(LF.paragraphes).length} imputations`;
  return [
    anomaly({
      key: "loi-finances",
      rule: "lf-reference",
      category: "budget",
      severity: "info",
      title: same ? `Loi de finances ${LF.annee} : référentiel déjà intégré` : `Loi de finances ${year ?? "non datée"}${rectificative ? " (rectificative)" : ""} : référentiel à mettre à jour`,
      detail: same
        ? `Ce document est la loi de finances qui sert de référence aux contrôles (${summary}). Il n'est pas contrôlé comme un rapport.`
        : `Le référentiel intégré est la LF ${LF.annee} (${LF.source} : ${summary}). Les documents continueront d'être comparés à cette loi tant que le référentiel n'est pas régénéré.`,
      suggestion: same
        ? "Charger les CDMT, budgets-programmes et rapports des ministères : leurs montants, programmes et imputations seront comparés à cette loi."
        : `Régénérer le référentiel à partir de ce fichier : node scripts/lf-referentiel.mjs "${ctx.doc.fileName}", puis relancer l'application.`,
      location: {},
    }),
  ];
}
