import type { Anomaly } from "../types";
import type { DocContext } from "../structure";
import { COMMON_UPPERCASE, SIGLES } from "../referentiel";
import { editDistance, norm, romanToInt, STOPWORDS, truncate, upperRatio } from "../text";
import { anomaly, blockLoc, listSome } from "./util";

// Sigles et abréviations : définitions contradictoires (dans le document,
// avec le référentiel ou entre documents), sigles employés sans être
// définis, graphies concurrentes (« BAS/FCE » et « FCE/BAS »).

export interface SigleDefinition {
  sigle: string;
  expansion: string;
  index: number; // bloc
  source: "liste" | "texte";
}

const SIGLE_TOKEN = /^[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*(?:[-/&][A-Z0-9][A-Za-z0-9]*)*$/;

function isSigle(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 14 || !SIGLE_TOKEN.test(t)) return false;
  if ((t.match(/[A-Z]/g) ?? []).length < 2) return false;
  if (romanToInt(t) !== null) return false;
  if (/^[IVXLC]+(-\d+)+$/.test(t)) return false; // numéro de section « II-1 »
  return true;
}

// « TICs », « PTFs » : pluriel à la française d'un sigle.
const singular = (s: string) => (/[A-Z]s$/.test(s) ? s.slice(0, -1) : s);

// Forme comparable d'un développé de sigle : mots significatifs, sans
// accents ni pluriels.
export function expansionKey(s: string): string[] {
  return norm(s)
    .replace(/['’]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => w.replace(/(aux)$/, "al").replace(/[sx]$/, ""));
}

// Deux mots « identiques » malgré une variante d'écriture (Nzérékoré /
// N'Zérékoré, coquille d'une lettre).
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  return a.includes(b) || b.includes(a) || editDistance(a, b, 1) <= 1;
}

export function sameExpansion(a: string, b: string): boolean {
  const A = [...new Set(expansionKey(a))];
  const B = [...new Set(expansionKey(b))];
  if (!A.length || !B.length) return true;
  const inter = A.filter((w) => B.some((x) => sameWord(w, x))).length;
  // « Institut de Recherche en Biologie Appliquée de Guinée » et « Institut de
  // Recherche et de vulgarisation de l'Aulacodiculture de Guinée » partagent
  // trois mots sur cinq : deux structures différentes.
  return inter / Math.min(A.length, B.length) >= 0.75;
}

export function collectDefinitions(ctx: DocContext): SigleDefinition[] {
  const defs: SigleDefinition[] = [];
  // 1) Listes de sigles (tableaux à deux colonnes ou lignes « SIGLE : développé »).
  const inSiglesSection = (i: number) => (ctx.pathOf[i] ?? []).some((p) => /sigles|abreviations|acronymes/.test(norm(p)));
  for (const t of ctx.tables) {
    const rows = [t.header, ...t.body].filter((r) => r.filter(Boolean).length >= 2);
    const hits = rows.filter((r) => isSigle(r[0]) && r[1] && r[1].length > r[0].length);
    if (hits.length >= 3 && (hits.length / rows.length >= 0.6 || inSiglesSection(t.index))) {
      for (const r of hits) defs.push({ sigle: r[0].trim(), expansion: r.slice(1).filter(Boolean).join(" ").trim(), index: t.index, source: "liste" });
    }
  }
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    if (inSiglesSection(i)) {
      const m = b.text.match(/^([A-Z][A-Za-z0-9\-/&]{1,13})\s*(?::|–|-|\t|=)\s*(.{4,160})$/);
      if (m && isSigle(m[1])) defs.push({ sigle: m[1], expansion: m[2].trim(), index: i, source: "liste" });
    }
    // 2) Définitions dans le texte : « Programme Décennal de l'Éducation en
    // Guinée (ProDEG) » ou « BAS (Budget d'Affectation Spéciale) ». Les sigles
    // composés (« DAO/CAO ») sont ambigus et ne sont pas lus ainsi.
    const before = /([^()]{6,160}?)\s*\(\s*([A-Z][A-Za-z0-9-]{1,13})\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = before.exec(b.text))) {
      const sigle = m[2];
      if (!isSigle(sigle)) continue;
      const expansion = expansionBefore(m[1], sigle);
      if (expansion) defs.push({ sigle, expansion: expansion.replace(/^[lLdD][’']/, ""), index: i, source: "texte" });
    }
    const after = /(?:^|[^A-Za-z0-9])([A-Z][A-Za-z0-9-]{1,13})\s*\(\s*(\p{Lu}[^()]{5,120})\)/gu;
    while ((m = after.exec(b.text))) {
      const sigle = m[1];
      const expansion = m[2].trim().replace(/[,;:.]$/, "");
      if (isSigle(sigle) && plausibleExpansion(expansion, sigle)) defs.push({ sigle, expansion, index: i, source: "texte" });
    }
  });
  return defs;
}

// Initiales des mots d'un développé (« l'Éducation » compte pour « é »).
function initials(expansion: string): string {
  return expansion
    .split(/\s+/)
    .map((w) => norm(w.replace(/^[«"“(]+/, "")).replace(/^[a-z]'/, ""))
    .filter(Boolean)
    .map((w) => w[0])
    .join("");
}

// Le développé doit « expliquer » le sigle : ses lettres capitales se
// retrouvent, dans l'ordre, parmi les initiales (au moins 60 %), sans
// traverser une fin de phrase.
function plausibleExpansion(expansion: string, sigle: string): boolean {
  if (/[.;!?]\s/.test(expansion) || expansion.split(/\s+/).length > 12 || expansion.split(/\s+/).length < 2) return false;
  const letters = norm(sigle.replace(/[^A-Z]/g, ""));
  const init = initials(expansion);
  if (!letters || init[0] !== letters[0]) return false;
  let k = 0;
  let found = 0;
  for (const ch of letters) {
    const at = init.indexOf(ch, k);
    if (at >= 0) {
      found++;
      k = at + 1;
    }
  }
  return found / letters.length >= 0.6;
}

function expansionBefore(text: string, sigle: string): string | null {
  const words = text.trim().split(/\s+/).slice(-14);
  const first = norm(sigle)[0];
  for (let k = words.length - 2; k >= 0; k--) {
    const w = norm(words[k].replace(/^[«"“(]+/, "")).replace(/^[a-z]'/, "");
    if (w[0] !== first) continue;
    const candidate = words.slice(k).join(" ").replace(/[,;:]$/, "");
    if (plausibleExpansion(candidate, sigle)) return candidate;
  }
  return null;
}

export function sigleRules(ctx: DocContext): { anomalies: Anomaly[]; definitions: SigleDefinition[] } {
  const out: Anomaly[] = [];
  const defs = collectDefinitions(ctx);
  const bySigle = new Map<string, SigleDefinition[]>();
  for (const d of defs) {
    const list = bySigle.get(d.sigle) ?? [];
    list.push(d);
    bySigle.set(d.sigle, list);
  }

  // Définitions contradictoires dans le document.
  for (const [sigle, list] of bySigle) {
    const distinct: SigleDefinition[] = [];
    for (const d of list) if (!distinct.some((x) => sameExpansion(x.expansion, d.expansion))) distinct.push(d);
    if (distinct.length >= 2) {
      out.push(
        anomaly({
          key: `conflit:${sigle}`,
          rule: "sigle-contradictoire",
          category: "sigles",
          severity: "majeure",
          title: `Sigle ${sigle} développé de ${distinct.length} façons`,
          detail: distinct.map((d) => `« ${truncate(d.expansion, 90)} »`).join(" / ") + ".",
          suggestion: `Retenir le développé officiel de ${sigle} et l'employer partout (liste des sigles et texte).`,
          location: blockLoc(ctx, distinct[1].index),
        }),
      );
    }
    // Écart avec le référentiel.
    const ref = SIGLES.find((s) => s.sigle === sigle && s.expansion);
    const doc = distinct[0];
    if (ref && doc && !sameExpansion(ref.expansion!, doc.expansion)) {
      out.push(
        anomaly({
          key: `ref:${sigle}`,
          rule: "sigle-referentiel",
          category: "sigles",
          severity: "mineure",
          title: `Sigle ${sigle} : développé à vérifier`,
          detail: `Le document définit ${sigle} comme « ${truncate(doc.expansion, 90)} » ; le référentiel indique « ${ref.expansion} ».`,
          suggestion: `Vérifier le développé officiel de ${sigle} et harmoniser (le référentiel se met à jour dans lib/documents/referentiel.ts s'il est en retard).`,
          location: blockLoc(ctx, doc.index),
        }),
      );
    }
  }

  // Sigles employés sans définition.
  const used = new Map<string, number>();
  const firstUse = new Map<string, number>();
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" || ctx.tocBlocks.has(i) || upperRatio(b.text) > 0.6) return;
    // Suites de mots en capitales (« CHEF DE MISSION », « MINISTERE DE LA
    // FONCTION PUBLIQUE ») : des titres ou des libellés, pas des sigles.
    const text = b.text.replace(/\p{Lu}{2,}(?:[\s'’]+\p{Lu}+)+/gu, (s) => " ".repeat(s.length));
    const re = /\b[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*(?:[-/][A-Z0-9][A-Za-z0-9]*)*\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const tk = singular(m[0]);
      if (!isSigle(tk) || COMMON_UPPERCASE.has(tk) || /^[IVXLC]+e$/.test(tk)) continue;
      const known = bySigle.has(tk) || SIGLES.some((r) => r.sigle === tk);
      // Mots à casse mixte (ArcGIS, SolidWorks) : noms de logiciels ou de
      // produits, sauf s'ils sont connus comme sigles (ProDEG).
      if (!known && /[a-z]/.test(tk)) continue;
      // Libellé de champ (« SITE : … »).
      if (/^\s*:/.test(text.slice(m.index + m[0].length))) continue;
      // Nom de famille en capitales (« Dr Mamoudou BAGAGA », « Mme Fatoumata BAH »).
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (!known && /^[A-Z]{3,}$/.test(tk) && /(\b(Dr|Dre|Pr|M\.|Mme|Mlle|Madame|Monsieur|Me)\s+|\p{Lu}\p{Ll}+\s+)$/u.test(before)) continue;
      used.set(tk, (used.get(tk) ?? 0) + 1);
      if (!firstUse.has(tk)) firstUse.set(tk, i);
    }
  });
  const hasList = defs.filter((d) => d.source === "liste").length >= 5;
  const defined = (s: string) => bySigle.has(s) || s.split(/[/-]/).every((p) => bySigle.has(p) || COMMON_UPPERCASE.has(p));
  const knownRef = (s: string) => s.split(/[/-]/).every((p) => SIGLES.some((r) => r.sigle === p) || COMMON_UPPERCASE.has(p));
  // Avec une liste de sigles, un sigle cité une seule fois hors liste est
  // souvent une coquille ou un terme technique : on ne signale que les
  // sigles récurrents.
  const undefinedList = [...used.keys()].filter(
    (s) => !defined(s) && (hasList ? (used.get(s) ?? 0) >= 2 : !knownRef(s)),
  );
  if (undefinedList.length) {
    undefinedList.sort((a, b) => (used.get(b) ?? 0) - (used.get(a) ?? 0));
    out.push(
      anomaly({
        key: "non-definis",
        rule: "sigles-non-definis",
        category: "sigles",
        severity: hasList ? "mineure" : "info",
        title: hasList
          ? `Sigles absents de la liste des sigles (${undefinedList.length})`
          : `Sigles employés sans être définis (${undefinedList.length})`,
        detail: `${listSome(undefinedList.map((s) => `${s} (×${used.get(s)})`), 15, ", ")}.`,
        suggestion: hasList
          ? "Compléter la liste des sigles et abréviations."
          : "Développer chaque sigle à sa première occurrence (« Libellé complet (SIGLE) ») ou ajouter une liste des sigles.",
        location: blockLoc(ctx, firstUse.get(undefinedList[0]) ?? 0),
      }),
    );
  }

  // Variantes d'un même sigle : casse (ProDEG / PRODEG), lettre en plus ou en
  // moins (ANFIVRI / ANFVRI), ancienne dénomination (MESRS / MESRSI).
  const all = new Map<string, number>(used);
  for (const d of defs) if (!all.has(d.sigle)) all.set(d.sigle, 0);
  // Les cellules de tableau comptent aussi (« contrat de performance avec le MESRSI »).
  for (const t of ctx.tables) {
    for (const row of t.body) {
      for (const c of row) {
        for (const tk of c.match(/\b[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/g) ?? []) {
          if (isSigle(tk)) all.set(tk, (all.get(tk) ?? 0) + 1);
        }
      }
    }
  }
  const tokens = [...all.keys()].filter((s) => !s.includes("/"));
  const variants: string[] = [];
  const reportedPairs = new Set<string>();
  for (let a = 0; a < tokens.length; a++) {
    for (let b = a + 1; b < tokens.length; b++) {
      const [x, y] = [tokens[a], tokens[b]];
      const key = [x, y].sort().join("|");
      if (reportedPairs.has(key)) continue;
      const sameCase = x.toUpperCase() === y.toUpperCase();
      // Lettre en plus ou en moins (ANFIVRI / ANFVRI). Une lettre remplacée
      // désigne le plus souvent une autre structure (CREDEB / CREDEK : deux
      // centres régionaux ; UK / UL : deux universités).
      const close = Math.min(x.length, y.length) >= 5 && x.length !== y.length && editDistance(x, y, 1) === 1;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      const extended = short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
      if (!sameCase && !close && !extended) continue;
      // Deux sigles officiels distincts (UK / UL, IST / ISTM) : pas une variante.
      if (SIGLES.some((r) => r.sigle === x) && SIGLES.some((r) => r.sigle === y) && !extended) continue;
      // Deux structures distinctes, chacune définie dans le document (IRBAG / IRVAG).
      const dx = bySigle.get(x)?.[0];
      const dy = bySigle.get(y)?.[0];
      if (dx && dy && !sameExpansion(dx.expansion, dy.expansion)) continue;
      if (extended && (all.get(long) ?? 0) > (all.get(short) ?? 0)) continue; // l'extension est la forme courante
      reportedPairs.add(key);
      variants.push(`${x} (×${all.get(x) || "liste"}) / ${y} (×${all.get(y) || "liste"})`);
    }
  }
  if (variants.length) {
    out.push(
      anomaly({
        key: "variantes",
        rule: "sigle-variantes",
        category: "sigles",
        severity: "mineure",
        title: `Sigles écrits de plusieurs façons (${variants.length})`,
        detail: `${listSome(variants, 6)}.`,
        suggestion: "Retenir la forme officielle de chaque sigle (dénomination actuelle de la structure) et l'appliquer dans tout le document, liste des sigles comprise.",
        location: {},
      }),
    );
  }

  // Graphies concurrentes : « BAS/FCE » et « FCE/BAS ».
  const slashForms = [...used.keys()].filter((s) => s.includes("/"));
  const reported = new Set<string>();
  for (const s of slashForms) {
    const rev = s.split("/").reverse().join("/");
    if (rev !== s && used.has(rev) && !reported.has(rev)) {
      reported.add(s);
      out.push(
        anomaly({
          key: `graphie:${s}`,
          rule: "sigle-graphie",
          category: "sigles",
          severity: "mineure",
          title: `Deux graphies : ${s} et ${rev}`,
          detail: `Le document écrit tantôt « ${s} » (×${used.get(s)}), tantôt « ${rev} » (×${used.get(rev)}).`,
          suggestion: "Choisir une seule forme et l'appliquer partout.",
          location: blockLoc(ctx, firstUse.get(s) ?? 0),
        }),
      );
    }
  }
  return { anomalies: out, definitions: defs };
}
