import type { Anomaly, Severity } from "../types";
import type { DocContext, TableInfo } from "../structure";
import { CDMT_PROGRAMME_SECTIONS, CDMT_TABLES } from "../referentiel";
import { excerpt, fmt, norm, plural, truncate } from "../text";
import { anomaly, blockLoc, listSome, rowLabel, tableLoc } from "./util";
import { isMoneyTable, rowKind } from "./tables";
import { sameExpansion } from "./sigles";
import { programmeKey } from "../lf";

// Contrôles propres au Cadre de Dépenses à Moyen Terme (canevas commun à
// tous les ministères) : rubriques de chaque programme, tableaux attendus,
// cohérence du cadrage financier entre tableaux et avec le texte,
// responsables des actions, intitulés des programmes, période couverte.

const SEVERITY_RANK: Record<Severity, number> = { bloquante: 0, majeure: 1, mineure: 2, info: 3 };
const worst = (list: Severity[]): Severity => list.sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] ?? "mineure";

// « PROGRAMME 002 — Enseignement supérieur », « Programme 2 : … »,
// « PROGRAMME N° 003 - … », « 34002 - Programme 2 : … » → "2".
export function programmeNumber(label: string): string | null {
  const m = norm(label).match(/programme\s*(?:n°|no|n)?\s*0*(\d{1,3})\b/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// --- Rubriques de chaque programme ---

function programmeSections(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const programmes = ctx.headings.filter((h) => /^programme\s*(n°\s*)?\d/.test(norm(h.title || h.block.text)) || /^programme\s*(n°\s*)?\d/.test(norm(h.block.text)));
  for (const p of programmes) {
    const k = ctx.headings.indexOf(p);
    const children: string[] = [];
    for (let j = k + 1; j < ctx.headings.length && ctx.headings[j].block.level > p.block.level; j++) children.push(norm(ctx.headings[j].block.text));
    // Rubriques sans titre : on cherche aussi dans les courts paragraphes de la section.
    const end = ctx.headings.slice(k + 1).find((h) => h.block.level <= p.block.level)?.index ?? ctx.blocks.length;
    for (let i = p.index + 1; i < end; i++) {
      const b = ctx.blocks[i];
      if (b.kind === "paragraph" && b.text.length < 90) children.push(norm(b.text));
    }
    const missing = CDMT_PROGRAMME_SECTIONS.filter((s) => !children.some((c) => s.patterns.some((re) => re.test(c))));
    if (!missing.length) continue;
    out.push(
      anomaly({
        key: `programme:${p.block.id}`,
        rule: "cdmt-rubriques-programme",
        category: "completude",
        severity: worst(missing.map((m) => m.severity)),
        title: `Rubriques manquantes dans « ${truncate(p.block.text, 50)} » (${missing.length})`,
        detail: `Le canevas du CDMT prévoit pour chaque programme : description et objectifs, actions prioritaires, indicateurs de performance, coût (par nature et source de financement), intervenants. Absent : ${missing.map((m) => m.label).join(", ")}.`,
        suggestion: `Ajouter ${missing.length > 1 ? "les rubriques manquantes" : "la rubrique manquante"} en suivant le canevas de la lettre circulaire du Ministère du Budget.`,
        location: blockLoc(ctx, p.index),
      }),
    );
  }
  return out;
}

// --- Tableaux attendus ---

function expectedTables(ctx: DocContext): Anomaly[] {
  const titles = [...ctx.tables.map((t) => norm(t.title)), ...ctx.headings.map((h) => norm(h.block.text))];
  const missing = CDMT_TABLES.filter((t) => !titles.some((x) => t.pattern.test(x)));
  if (!missing.length) return [];
  return [
    anomaly({
      key: "tableaux-canevas",
      rule: "cdmt-tableaux-attendus",
      category: "completude",
      severity: worst(missing.map((m) => m.severity)),
      title: `Tableaux du canevas introuvables (${missing.length})`,
      detail: `Tableaux attendus dans un CDMT et non trouvés (d'après les légendes) : ${missing.map((m) => m.label).join(" ; ")}.`,
      suggestion: "Ajouter ces tableaux avec une légende explicite (« Tableau n : … ») pour que le cadrage puisse être contrôlé.",
      location: {},
    }),
  ];
}

// --- Cadrage financier : les montants des programmes sont les mêmes partout ---

export interface Synthese {
  t: TableInfo;
  cols: Map<string, number>; // clé de colonne (« 2026 », « lfr 2025 », « 2026-2028 ») → index
  programmes: Map<string, number>; // numéro de programme → ligne
  totalRow: number | undefined;
}

const colKey = (h: string) => norm(h.split(" > ").pop() ?? h).replace(/\s+/g, " ").replace(/[–—]/g, "-");

function programmeRows(t: TableInfo): Map<string, number> {
  const rows = new Map<string, number>();
  t.body.forEach((_, r) => {
    if (t.totalRows.includes(r)) return;
    const label = rowLabel(t, r);
    if (rowKind(label) !== "programme") return;
    const n = programmeNumber(label);
    if (n && !rows.has(n)) rows.set(n, r);
  });
  return rows;
}

export function findSynthese(ctx: DocContext): Synthese | null {
  let best: Synthese | null = null;
  for (const t of ctx.tables) {
    if (t.empty || !isMoneyTable(t) || t.yearCols.filter((y) => !y.relative).length < 2) continue;
    const programmes = programmeRows(t);
    if (programmes.size < 2) continue;
    // La synthèse ne contient que des lignes de programme (pas de détail).
    const detail = t.body.filter((_, r) => !t.totalRows.includes(r) && !programmes.has(programmeNumber(rowLabel(t, r)) ?? "")).length;
    const cols = new Map<string, number>();
    t.header.forEach((h, c) => {
      if (t.kinds[c] === "count") cols.set(colKey(h), c);
    });
    const candidate: Synthese = { t, cols, programmes, totalRow: t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop() };
    const score = programmes.size * 10 - detail;
    const bestScore = best ? best.programmes.size * 10 - best.t.body.filter((_, r) => !best!.t.totalRows.includes(r) && !best!.programmes.has(programmeNumber(rowLabel(best!.t, r)) ?? "")).length : -Infinity;
    if (score > bestScore) best = candidate;
  }
  return best;
}

function programmeTotals(ctx: DocContext, s: Synthese): Anomaly[] {
  const issues: string[] = [];
  let firstTable: TableInfo | null = null;
  const grand = (t: TableInfo, c: number) => {
    const tr = t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop();
    return tr === undefined ? null : t.nums[tr][c]?.value ?? null;
  };
  for (const t of ctx.tables) {
    if (t === s.t || t.empty || !isMoneyTable(t)) continue;
    const rows = programmeRows(t);
    if (!rows.size) continue;
    const common = t.header.map((h, c) => ({ c, ref: s.cols.get(colKey(h)) })).filter((x) => x.ref !== undefined && t.kinds[x.c] === "count");
    if (!common.length) continue;
    // Même périmètre que la synthèse : même total général, ou tableau d'un seul programme.
    const sameScope =
      rows.size === 1 ||
      common.some((x) => {
        const a = grand(t, x.c);
        const b = s.totalRow !== undefined ? s.t.nums[s.totalRow][x.ref!]?.value ?? null : null;
        return a !== null && b !== null && Math.abs(a - b) < 1;
      });
    if (!sameScope) continue;
    for (const [n, r] of rows) {
      const ref = s.programmes.get(n);
      if (ref === undefined) {
        issues.push(`« ${truncate(t.title, 50)} » cite le programme ${n}, absent du tableau de synthèse`);
        firstTable ??= t;
        continue;
      }
      for (const x of common) {
        const a = t.nums[r][x.c]?.value;
        const b = s.t.nums[ref][x.ref!]?.value;
        if (a === undefined || b === undefined || Math.abs(a - b) < 1) continue;
        issues.push(`programme ${n}, ${t.header[x.c]} : ${fmt(a)} dans « ${truncate(t.title, 45)} » contre ${fmt(b)} dans la synthèse`);
        firstTable ??= t;
        break;
      }
    }
  }
  if (!issues.length) return [];
  return [
    anomaly({
      key: "cadrage-programmes",
      rule: "cdmt-cadrage-programmes",
      category: "budget",
      severity: "bloquante",
      title: `Montants des programmes différents d'un tableau à l'autre (${issues.length})`,
      detail: `Référence : « ${s.t.title} ». ${listSome(issues, 5)}.`,
      suggestion:
        "Le montant d'un programme doit être identique dans la synthèse, le tableau par nature, les tableaux du programme et les annexes : repartir de la synthèse validée (plafonds notifiés) et reporter les montants dans tous les tableaux.",
      location: tableLoc(ctx, firstTable ?? s.t),
    }),
  ];
}

// Montant lu dans le texte : « 2 588,21 milliards de GNF ».
const AMOUNT_RE = /(\d{1,3}(?:[   .]\d{3})*(?:,\d+)?)\s*(milliards?|millions?)\s+de\s+(?:gnf|fg|francs? guin[ée]ens?)/gi;

function amountsIn(text: string): { value: number; decimals: number; scale: number; index: number; raw: string }[] {
  const out: { value: number; decimals: number; scale: number; index: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text))) {
    const [intPart, dec = ""] = m[1].replace(/[   .]/g, "").split(",");
    const scale = /milliard/i.test(m[2]) ? 1e9 : 1e6;
    out.push({ value: Number(intPart + (dec ? "." + dec : "")) * scale, decimals: dec.length, scale, index: m.index, raw: m[0] });
  }
  return out;
}

// Deux montants sont « égaux » à l'arrondi près de celui qui est écrit.
function sameAmount(written: { value: number; decimals: number; scale: number }, exact: number): boolean {
  return Math.abs(written.value - exact) <= 0.5 * Math.pow(10, -written.decimals) * written.scale + 1;
}

function textAmounts(ctx: DocContext, s: Synthese): Anomaly[] {
  const out: Anomaly[] = [];
  // Tous les montants des tableaux budgétaires (pour reconnaître un sous-total cité).
  const known: number[] = [];
  for (const t of ctx.tables) if (isMoneyTable(t)) for (const row of t.nums) for (const n of row) if (n && n.value >= 1e6) known.push(n.value);
  const periodCol = [...s.cols.entries()].find(([k]) => /(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}/.test(k))?.[1];
  const yearCols = [...s.cols.entries()].filter(([k]) => /^(?:\D{0,8})(?:19|20)\d{2}$/.test(k));
  const grandPeriod = s.totalRow !== undefined && periodCol !== undefined ? s.t.nums[s.totalRow][periodCol]?.value ?? null : null;

  const envelope: string[] = [];
  const programme: string[] = [];
  let firstIdx = -1;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    for (const sentence of b.text.replace(/([.;!?])\s+/g, "$1\n").split("\n")) {
      const amounts = amountsIn(sentence);
      if (!amounts.length) continue;
      const nt = norm(sentence);
      // Enveloppe globale du CDMT : « le CDMT … mobilise une enveloppe globale
      // de X milliards », « l'enveloppe globale du CDMT s'élève à X ». Le
      // montant suit l'expression, et la phrase ne parle pas d'un programme
      // (« le Programme 003 mobilise une enveloppe globale de… »).
      const env = /(enveloppe (?:budgetaire )?(?:globale|totale)|budget (?:global|total))/.exec(nt);
      const afterEnv = env ? nt.slice(env.index + env[0].length) : "";
      const gap = afterEnv.match(/^([^.,;]{0,45}?)\d/)?.[1] ?? null;
      // « soit 12,39 % de l'enveloppe totale » : l'enveloppe est le dénominateur
      // d'une part, pas le montant cité.
      const share = env !== null && /(de l'|de la |du |des )$/.test(nt.slice(Math.max(0, env.index - 6), env.index));
      const aboutProgramme = env !== null && (share || /\bprogramme\b/.test(nt.slice(0, env.index) + (gap ?? "")));
      if (env && gap !== null && !aboutProgramme && grandPeriod !== null) {
        // Premier montant situé après l'expression.
        const a = amounts.find((x) => norm(sentence.slice(0, x.index)).length >= env.index) ?? amounts[0];
        if (!sameAmount(a, grandPeriod)) {
          const year = yearCols.find(([, c]) => s.totalRow !== undefined && sameAmount(a, s.t.nums[s.totalRow][c]?.value ?? NaN));
          envelope.push(
            `« ${excerpt(sentence, a.index, a.raw.length, 50)} » : ${year ? `c'est le total de la seule année ${year[0]}` : "ce montant ne correspond à aucun total du tableau de synthèse"} ; l'enveloppe ${s.t.header[periodCol!]} est de ${fmt(grandPeriod / 1e9, 2)} milliards de GNF`,
          );
          if (firstIdx < 0) firstIdx = i;
        }
        continue;
      }
      // Montant attribué à un programme précis.
      const progs = [...new Set((nt.match(/programme\s*(?:n°\s*)?0*\d{1,3}/g) ?? []).map((x) => programmeNumber(x)!))];
      if (progs.length !== 1) continue;
      const row = s.programmes.get(progs[0]);
      if (row === undefined) continue;
      for (const a of amounts) {
        if (known.some((v) => sameAmount(a, v))) continue;
        const expected = periodCol !== undefined ? s.t.nums[row][periodCol]?.value : undefined;
        programme.push(
          `programme ${progs[0]} : « ${excerpt(sentence, a.index, a.raw.length, 40)} » ne correspond à aucun montant des tableaux${expected ? ` (coût ${s.t.header[periodCol!]} : ${fmt(expected / 1e9, 2)} milliards)` : ""}`,
        );
        if (firstIdx < 0) firstIdx = i;
      }
    }
  });
  if (envelope.length) {
    out.push(
      anomaly({
        key: "enveloppe-globale",
        rule: "cdmt-enveloppe-globale",
        category: "budget",
        severity: "bloquante",
        title: `Enveloppe globale du CDMT incohérente (${plural(envelope.length, "mention")})`,
        detail: listSome(envelope, 4) + ".",
        suggestion: `Citer partout l'enveloppe de la période telle qu'elle figure dans « ${s.t.title} » (message du Ministre, résumé exécutif, conclusion), et préciser l'année lorsqu'un montant annuel est cité.`,
        location: blockLoc(ctx, firstIdx),
      }),
    );
  }
  if (programme.length) {
    out.push(
      anomaly({
        key: "montants-programmes-texte",
        rule: "cdmt-montants-texte",
        category: "budget",
        severity: "majeure",
        title: `Montants de programmes cités dans le texte introuvables dans les tableaux (${programme.length})`,
        detail: listSome(programme, 4) + ".",
        suggestion: "Reprendre dans le texte les montants exacts des tableaux (probablement issus d'une version antérieure du CDMT).",
        location: blockLoc(ctx, firstIdx),
      }),
    );
  }
  return out;
}

// --- Responsables des actions : identiques dans tous les tableaux ---

function actionOwners(ctx: DocContext): Anomaly[] {
  const owners = new Map<string, Map<string, string[]>>(); // code → responsable → sources
  const note = (code: string, owner: string, source: string) => {
    const o = owner.replace(/\s+/g, " ").trim();
    if (!o || o.length > 40 || /\d{4}/.test(o)) return;
    const byOwner = owners.get(code) ?? new Map<string, string[]>();
    const list = byOwner.get(o.toUpperCase()) ?? [];
    list.push(source);
    byOwner.set(o.toUpperCase(), list);
    owners.set(code, byOwner);
  };
  for (const t of ctx.tables) {
    const ownerCol = t.header.findIndex((h) => /responsab|services? responsables?|intervenants?/.test(norm(h)));
    t.body.forEach((row) => {
      const label = row.find((c) => c !== "") ?? "";
      const m = label.match(/^(\d{4})\s*[-–—]\s*(.+?)\s*(?:\(([A-Z][A-Za-z/&-]{1,12})\))?\s*$/);
      if (!m) return;
      if (m[3]) note(m[1], m[3], truncate(t.title, 40));
      else if (ownerCol >= 0 && row[ownerCol] && rowKind(label) === "action") {
        // Ligne d'en-tête d'action (pas une ligne d'indicateur) : le responsable de l'action.
        const isHeader = !/^indicateur/i.test(row.find((c, k) => k > 0 && c !== "") ?? "");
        if (isHeader) note(m[1], row[ownerCol], truncate(t.title, 40));
      }
    });
  }
  ctx.blocks.forEach((b) => {
    if (b.kind !== "paragraph" && b.kind !== "heading") return;
    const m = b.text.trim().match(/^(\d{4})\s*[-–—]\s*[^()]{3,120}\(([A-Z][A-Za-z/&-]{1,12})\)\s*$/);
    if (m) note(m[1], m[2], "texte");
  });
  const issues: string[] = [];
  for (const [code, byOwner] of [...owners.entries()].sort()) {
    if (byOwner.size < 2) continue;
    issues.push(`action ${code} : ${[...byOwner.entries()].map(([o, src]) => `${o} (${[...new Set(src)].slice(0, 2).join(", ")})`).join(" / ")}`);
  }
  if (!issues.length) return [];
  return [
    anomaly({
      key: "responsables-actions",
      rule: "cdmt-responsables-actions",
      category: "coherence",
      severity: "majeure",
      title: `Responsables d'actions différents selon les tableaux (${issues.length})`,
      detail: listSome(issues, 5) + ".",
      suggestion:
        "Désigner un seul responsable par action (celui du tableau des intervenants validé) et l'appliquer au tableau des indicateurs, au plan d'actions et au texte des actions prioritaires.",
      location: {},
    }),
  ];
}

// --- Intitulés des programmes et des actions ---

function names(ctx: DocContext): Anomaly[] {
  const found = new Map<string, Map<string, string>>(); // clé → intitulé normalisé → intitulé affiché
  const note = (key: string, name: string) => {
    const clean = name.replace(/\s*\([^)]*\)\s*$/, "").replace(/[.;:,]$/, "").trim();
    if (clean.length < 4 || clean.split(/\s+/).length > 14) return;
    const m = found.get(key) ?? new Map<string, string>();
    if (![...m.values()].some((x) => sameExpansion(x, clean))) m.set(norm(clean), clean);
    found.set(key, m);
  };
  const scan = (text: string) => {
    const p = text.match(/programme\s*(?:n°\s*)?0*(\d{1,3})\s*[-–—:]\s*(.+)$/i);
    if (p && !/\b(vise|represente|mobilise|beneficie|concentre|est|constitue|ambitionne)\b/i.test(p[2])) note(`Programme ${parseInt(p[1], 10)}`, p[2]);
  };
  ctx.blocks.forEach((b) => {
    if (b.kind === "heading") scan(b.text);
    else if (b.kind === "paragraph" && (b.list || b.text.length < 90)) scan(b.text);
    else if (b.kind === "table") for (const row of b.rows) if (row[0]) scan(row[0].trim());
  });
  // « Le Programme 3 : Recherche dans l'enseignement supérieur ambitionne… »
  ctx.blocks.forEach((b) => {
    if (b.kind !== "paragraph") return;
    const m = b.text.match(/programme\s*(?:n°\s*)?0*(\d{1,3})\s*:\s*([^,.;]+?)\s+(ambitionne|vise|comprend|regroupe)\b/i);
    if (m) note(`Programme ${parseInt(m[1], 10)}`, m[2]);
  });
  const issues: string[] = [];
  for (const [key, m] of found) if (m.size > 1) issues.push(`${key} : ${[...m.values()].map((v) => `« ${truncate(v, 60)} »`).join(" / ")}`);
  if (!issues.length) return [];
  return [
    anomaly({
      key: "intitules-programmes",
      rule: "cdmt-intitules",
      category: "coherence",
      severity: "mineure",
      title: `Intitulés de programme variables (${issues.length})`,
      detail: listSome(issues, 4) + ".",
      suggestion: "Employer partout l'intitulé officiel du programme (celui de la nomenclature budgétaire et de la PLEB).",
      location: {},
    }),
  ];
}

// --- Période du CDMT ---

function period(ctx: DocContext): Anomaly[] {
  const head = ctx.blocks
    .slice(0, 15)
    .map((b) => (b.kind === "heading" || b.kind === "paragraph" ? b.text : ""))
    .join(" ");
  const m = head.match(/(?:cdmt|moyen terme)[^0-9]{0,30}((?:19|20)\d{2})\s*[-–à]\s*((?:19|20)\d{2})/i);
  if (!m) return [];
  const from = parseInt(m[1], 10);
  const to = parseInt(m[2], 10);
  const expected: number[] = [];
  for (let y = from; y <= to; y++) expected.push(y);
  const issues: string[] = [];
  for (const t of ctx.tables) {
    if (t.empty || !isMoneyTable(t) || t.yearCols.length < 2) continue;
    const years = t.yearCols.filter((y) => !y.relative).map((y) => y.year);
    const missing = expected.filter((y) => !years.includes(y));
    if (missing.length) issues.push(`« ${truncate(t.title, 50)} » : ${missing.join(", ")} absent${missing.length > 1 ? "s" : ""}`);
  }
  if (to - from !== 2) issues.unshift(`la période annoncée (${from}-${to}) ne couvre pas trois années`);
  if (!issues.length) return [];
  return [
    anomaly({
      key: "periode-cdmt",
      rule: "cdmt-periode",
      category: "budget",
      severity: "majeure",
      title: `Période du CDMT mal couverte (${issues.length})`,
      detail: `CDMT ${from}-${to} : ${listSome(issues, 4)}.`,
      suggestion: "Chaque tableau financier doit présenter l'année de référence (LFI/LFR N-1) et les trois années du CDMT (N, N+1, N+2), avec leur cumul.",
      location: {},
    }),
  ];
}

export function cdmtRules(ctx: DocContext): Anomaly[] {
  if (ctx.kind !== "cdmt") return [];
  const out: Anomaly[] = [...programmeSections(ctx), ...expectedTables(ctx), ...actionOwners(ctx), ...names(ctx), ...period(ctx)];
  const s = findSynthese(ctx);
  if (s) out.push(...programmeTotals(ctx, s), ...textAmounts(ctx, s));
  else {
    out.push(
      anomaly({
        key: "synthese-absente",
        rule: "cdmt-synthese",
        category: "budget",
        severity: "bloquante",
        title: "Tableau de synthèse des coûts par programme introuvable",
        detail: "Aucun tableau ne présente les montants par programme (lignes « Programme 00x ») sur plusieurs années : le cadrage financier ne peut pas être vérifié.",
        suggestion: "Ajouter le tableau « Synthèse des coûts globaux des programmes » : une ligne par programme, colonnes LFI/LFR N-1, N, N+1, N+2 et cumul, ligne « Total général ».",
        location: {},
      }),
    );
  }
  return out;
}
