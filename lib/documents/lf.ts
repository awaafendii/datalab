import type { DocBlock } from "./types";
import { LF_DATA } from "./lf-data";
import { norm, truncate } from "./text";

// Référentiel « Loi de finances en vigueur » : sections budgétaires (codes
// ministères/institutions), montants par titre et par programme, nomenclature
// des imputations (titre-chapitre-article-paragraphe) et sources de
// financement. Les données sont générées depuis le PDF de la loi par
// scripts/lf-referentiel.mjs (lf-data.ts) ; ce fichier fournit les recherches.

export type TitreCode = "1" | "2" | "3" | "4" | "5";

export interface LfMontant {
  lfr: number; // LFR de l'année précédente
  lf: number; // loi de finances de l'année
}

export interface LfProgramme {
  code: string; // « 21001 » (pilotage et soutien), « 22001 »… (programmes opérationnels)
  libelle: string;
  montant: number; // LF de l'année
  natures: Partial<Record<TitreCode, number>>;
}

export interface LfSection {
  code: string; // « 34 »
  nom: string;
  total: LfMontant;
  titres: Partial<Record<TitreCode, LfMontant>>;
  programmes?: LfProgramme[]; // ministères en budget-programme
}

export interface LoiDeFinances {
  annee: number;
  anneeLfr: number;
  source: string;
  sections: LfSection[];
  titres: Record<string, string>;
  chapitres: Record<string, string>;
  articles: Record<string, string>;
  paragraphes: Record<string, string>;
  sources: string[];
  bas: { nom: string; sigle: string; lfr: number; lf: number }[];
}

export const LF: LoiDeFinances = LF_DATA;

export function sectionByCode(code: string): LfSection | undefined {
  return LF.sections.find((s) => s.code === code);
}

// --- Nomenclature des imputations ---

export type ImputationLevel = "titre" | "chapitre" | "article" | "paragraphe";

// Libellé officiel d'un code « 3 », « 3-3 », « 3-3-6 » ou « 3-3-6-10-00 ».
export function imputationLabel(code: string): { level: ImputationLevel; label: string } | null {
  const parts = code.split("-");
  if (parts.length === 1) return LF.titres[code] ? { level: "titre", label: LF.titres[code] } : null;
  if (parts.length === 2) return LF.chapitres[code] ? { level: "chapitre", label: LF.chapitres[code] } : null;
  if (parts.length === 3) return LF.articles[code] ? { level: "article", label: LF.articles[code] } : null;
  if (parts.length === 5) return LF.paragraphes[code] ? { level: "paragraphe", label: LF.paragraphes[code] } : null;
  return null;
}

// Titre (nature économique) d'un libellé de ligne : « 2 Dépenses de
// personnel », « Titre 3 », « Dépenses de biens et services ».
export function titreOf(label: string): TitreCode | null {
  const t = norm(label);
  const num = t.match(/^(?:titre\s*|t)?([1-5])\s+(?:[-–—:.]\s*)?(?:depenses?|charges?|interets?)\b/) ?? t.match(/^titre\s*([1-5])\b/);
  if (num) return num[1] as TitreCode;
  if (/^(charges financieres|interets)( de la dette)?\b/.test(t)) return "1";
  if (/^depenses? de personnel\b/.test(t)) return "2";
  if (/^depenses? de biens et services\b/.test(t)) return "3";
  if (/^depenses? de transferts?\b/.test(t)) return "4";
  if (/^depenses? d.investissements?$/.test(t)) return "5";
  return null;
}

// Le libellé cité est-il celui du titre ? (« 4 Dépenses d'investissement »
// ne l'est pas.)
export function titreLabelMatches(code: TitreCode, label: string): boolean {
  const t = norm(label).replace(/^(?:titre\s*|t)?[1-5]\s*[-–—:.]?\s*/, "");
  const patterns: Record<TitreCode, RegExp> = {
    "1": /dette|interets|charges financieres/,
    "2": /personnel|salaires/,
    "3": /biens et services|fonctionnement/,
    "4": /transferts?|subventions/,
    "5": /investissements?|capital|equipement/,
  };
  return patterns[code].test(t);
}

// --- Programmes ---

// Numéro canonique d'un programme : « Programme 001 » → 1 ; code LF « 21001 »
// (pilotage et soutien) → 1, « 22001 » → 2, « 22002 » → 3… : c'est l'ordre
// retenu par les CDMT (programme support en premier).
export function programmeKey(code: string): string {
  const m = code.match(/^2([12])(\d{3})$/);
  if (!m) return String(parseInt(code, 10));
  const n = parseInt(m[2], 10);
  return String(m[1] === "1" ? n : n + 1);
}

const STOP = new Set(["de", "la", "le", "les", "l", "et", "du", "des", "d", "a", "au", "aux", "en", "pour", "sur", "par"]);
export function significantWords(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// Similarité de deux intitulés (mots significatifs communs / plus long).
export function labelSimilarity(a: string, b: string): number {
  const wa = new Set(significantWords(a).map((w) => w.replace(/s$/, "")));
  const wb = new Set(significantWords(b).map((w) => w.replace(/s$/, "")));
  if (!wa.size || !wb.size) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size);
}

// --- Rattachement d'un document à une section ---

export interface SectionMatch {
  section: LfSection;
  evidence: string; // extrait qui a permis le rattachement
  manual: boolean; // choisi par l'utilisateur
}

// Sigle usuel d'une section : « Ministère de l'Enseignement Supérieur et de
// la Recherche Scientifique » → MESRS.
export function sectionSigle(nom: string): string {
  return nom
    .replace(/[’']/g, " ")
    .split(/[\s,/-]+/)
    .filter((w) => w && /^[A-ZÉÈÀ]/.test(w) && !STOP.has(norm(w)))
    .map((w) => norm(w).charAt(0).toUpperCase())
    .join("");
}

const INSTITUTION_RE =
  /\b(minist[eè]re|pr[ée]sidence de la r[ée]publique|primature|secr[ée]tariat g[ée]n[ée]ral|cour (?:supr[êe]me|des comptes)|conseil national de la transition|haute autorit[ée]|grande chancellerie|administration et contr[ôo]le des grands projets)\b/gi;
const CONNECTORS = /^(de|la|le|les|l'|l’|d'|d’|du|des|et|à|aux|au|chargé|en)$/i;

// Intitulé d'institution cité dans un texte : « Ministère de l'Enseignement
// Supérieur et de la Recherche Scientifique (MESRS) a… » → jusqu'au dernier
// mot à majuscule.
function institutionPhrases(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  INSTITUTION_RE.lastIndex = 0;
  while ((m = INSTITUTION_RE.exec(text))) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    // « l'Enseignement » → « l' » + « Enseignement ».
    const tokens = rest
      .replace(/(['’])/g, "$1 ")
      .split(/\s+/)
      .filter((x) => x && x !== ",");
    const kept: string[] = [];
    let last = 0;
    for (const tok of tokens) {
      const w = tok.replace(/^[(«"]+|[)»".;:,]+$/g, "");
      if (!w) break;
      if (CONNECTORS.test(w) || /^(l|d)['’]$/i.test(w)) {
        kept.push(w);
        continue;
      }
      if (/^[A-ZÉÈÀÂÎÔÛÇ]/.test(w)) {
        kept.push(w);
        last = kept.length;
        if (/[).;:]$/.test(tok)) break;
        continue;
      }
      break;
    }
    out.push((m[0] + " " + kept.slice(0, last).join(" ")).replace(/\s+/g, " ").replace(/(['’])\s+/g, "$1").trim());
  }
  return out;
}

function phraseScore(phrase: string, section: LfSection): number {
  const own = new Set(significantWords(section.nom).filter((w) => w !== "ministere"));
  const cited = new Set(significantWords(phrase).filter((w) => w !== "ministere"));
  if (!own.size || !cited.size) return 0;
  const inter = [...own].filter((w) => cited.has(w)).length;
  const recall = inter / own.size;
  const precision = inter / cited.size;
  // Intitulé complet (éventuellement enrichi : « … et de l'Innovation »).
  if (recall >= 0.75 && precision >= 0.5) return recall + precision;
  return 0;
}

// Section du document : intitulés d'institution cités (en priorité sur la
// page de garde), sigle de la section, mention explicite « section 34 ».
export function detectSection(blocks: DocBlock[], fileName: string): SectionMatch | null {
  // Preuve retenue : la plus forte (intitulé cité > « section 34 » > sigle).
  const scores = new Map<string, { score: number; evidence: string; strength: number }>();
  const add = (s: LfSection, score: number, evidence: string, strength: number) => {
    const cur = scores.get(s.code) ?? { score: 0, evidence, strength };
    cur.score += score;
    if (strength > cur.strength) [cur.evidence, cur.strength] = [evidence, strength];
    scores.set(s.code, cur);
  };
  const texts: { text: string; weight: number }[] = [{ text: fileName.replace(/[_.-]+/g, " "), weight: 1 }];
  blocks.forEach((b, i) => {
    const weight = i < 25 ? 3 : 1;
    if (b.kind === "heading" || b.kind === "paragraph") texts.push({ text: b.text, weight });
    else if (b.kind === "table" && i < 25) texts.push({ text: b.rows.flat().join(" "), weight });
  });
  const sigles = LF.sections.map((s) => ({ s, sigle: sectionSigle(s.nom) })).filter((x) => x.sigle.length >= 4);
  for (const { text, weight } of texts) {
    for (const phrase of institutionPhrases(text)) {
      let best: LfSection | null = null;
      let bestScore = 0;
      for (const s of LF.sections) {
        const sc = phraseScore(phrase, s);
        if (sc > bestScore) [best, bestScore] = [s, sc];
      }
      if (best) add(best, weight * 2, truncate(phrase, 110), 3);
    }
    const explicit = norm(text).match(/\bsection (?:budgetaire )?(?:n° ?)?(\d{2})\b/);
    if (explicit) {
      const s = sectionByCode(explicit[1]);
      if (s) add(s, weight * 3, `section ${explicit[1]}`, 2);
    }
    for (const { s, sigle } of sigles) {
      if (new RegExp(`(?:^|[^A-Za-z])${sigle}(?![A-Za-z])`).test(text)) add(s, weight * 0.5, sigle, 1);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length || ranked[0][1].score < 2) return null;
  const section = sectionByCode(ranked[0][0])!;
  return { section, evidence: ranked[0][1].evidence, manual: false };
}
