#!/usr/bin/env node
// Génère le référentiel « Loi de finances » utilisé par le contrôle des
// documents (lib/documents/lf-data.ts) à partir du PDF de la loi de finances :
//   - sections budgétaires (code ministère/institution → intitulé) ;
//   - montants LFR N-1 et LF N par section et par titre (nature économique) ;
//   - programmes (code, intitulé, montant LF N par nature) des ministères en
//     budget-programme ;
//   - nomenclature des imputations (titre, chapitre, article, paragraphe) ;
//   - sources de financement et budgets d'affectation spéciale (BAS).
//
// Usage : node scripts/lf-referentiel.mjs chemin/loi-de-finances.pdf [sortie.ts]
// Nécessite « pdftotext » (Poppler ; fourni avec Git pour Windows).
// À relancer à chaque nouvelle loi de finances (initiale ou rectificative).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pdf, out = "lib/documents/lf-data.ts"] = process.argv.slice(2);
if (!pdf) {
  console.error("Usage : node scripts/lf-referentiel.mjs loi-de-finances.pdf [sortie.ts]");
  process.exit(1);
}

let raw;
try {
  raw = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", pdf, "-"], { maxBuffer: 256 << 20 }).toString("utf8");
} catch (e) {
  console.error("pdftotext introuvable ou en échec (installer Poppler ou Git pour Windows) :", e.message);
  process.exit(1);
}
// Les montants sont séparés par des espaces insécables : on normalise tout.
const pages = raw.split("\f").map((p) => p.split(/\r?\n/).map((l) => l.replace(/[\s  ]+/g, " ").trim()).filter(Boolean));
const warnings = [];

// --- Outils ---

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`´]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();

// Montants en groupes de milliers séparés par des espaces : « 1 101 361 600 393 ».
const isFirstGroup = (t) => /^-?\d{1,3}$/.test(t);
const isGroup = (t) => /^\d{3}$/.test(t);
const toNumber = (groups) => Number(groups.join("").replace(/^(-?)0+(?=\d)/, "$1"));

function validNumber(groups) {
  return groups.length > 0 && isFirstGroup(groups[0]) && groups.slice(1).every(isGroup);
}

// Découpe les jetons numériques de fin de ligne en `count` montants. Avec
// trois montants (LFR, LF, écart), l'écart doit valoir LF − LFR.
function trailingAmounts(line, count) {
  const tokens = line.split(" ");
  let start = tokens.length;
  while (start > 0 && /^-?\d{1,3}$/.test(tokens[start - 1])) start--;
  const nums = tokens.slice(start);
  const label = tokens.slice(0, start).join(" ");
  if (count === 1) {
    // Le montant commence au premier groupe qui rend la suite valide.
    for (let i = 0; i < nums.length; i++) {
      if (validNumber(nums.slice(i))) return { label: [label, ...nums.slice(0, i)].join(" ").trim(), values: [toNumber(nums.slice(i))] };
    }
    return null;
  }
  const found = [];
  for (let s = 0; s < Math.min(nums.length, 6); s++) {
    const rest = nums.slice(s);
    for (let i = 1; i < rest.length - 1; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const a = rest.slice(0, i), b = rest.slice(i, j), c = rest.slice(j);
        if (!validNumber(a) || !validNumber(b) || !validNumber(c)) continue;
        const [x, y, z] = [toNumber(a), toNumber(b), toNumber(c)];
        if (y - x === z) found.push({ label: [label, ...nums.slice(0, s)].join(" ").trim(), values: [x, y, z] });
      }
    }
    if (found.length) break;
  }
  return found.length ? found[0] : null;
}

// Majuscules sans accents de la LF → casse de phrase accentuée.
const ACCENTS = {
  depenses: "dépenses", depense: "dépense", financieres: "financières", financiere: "financière", interets: "intérêts",
  specifiques: "spécifiques", electricite: "électricité", telecommunications: "télécommunications", representation: "représentation",
  reparations: "réparations", deplacement: "déplacement", menages: "ménages", residents: "résidents", immobilisations: "immobilisations",
  etablissements: "établissements", tresor: "trésor", securite: "sécurité", societes: "sociétés", prets: "prêts",
  participations: "participations", materiel: "matériel", equipements: "équipements", etrangers: "étrangers", exterieur: "extérieur",
  exterieure: "extérieure", interieur: "intérieur", interieure: "intérieure", activites: "activités", generale: "générale",
};
function sentenceCase(s) {
  if (/[a-zà-ÿ]/.test(s)) return s.replace(/\s+/g, " ").trim();
  const words = s.toLowerCase().replace(/\s+/g, " ").trim().split(" ").map((w) => ACCENTS[w] ?? w);
  const t = words.join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const tidyLabel = (s) => s.replace(/\s+/g, " ").replace(/,(?=\S)/g, ", ").replace(/\s+([,.])/g, "$1").trim();

// --- Année ---

const header = pages.slice(0, 120).flat().join(" ");
const yearMatch = header.match(/LFR\s+((?:19|20)\d{2})\s+LFI?\s+((?:19|20)\d{2})/);
const annee = yearMatch ? Number(yearMatch[2]) : Number((header.match(/LOI DE FINANCES\s+((?:19|20)\d{2})/) ?? [])[1]);
const anneeLfr = yearMatch ? Number(yearMatch[1]) : annee - 1;
if (!annee) {
  console.error("Année de la loi de finances introuvable.");
  process.exit(1);
}

// --- Sections (table des matières) ---

const tocText = pages
  .slice(0, 8)
  .flat()
  .join(" ")
  .replace(/\s+/g, " ");
const sections = new Map();
for (const m of tocText.matchAll(/\b(\d{2})\s*-\s*([A-ZÉÈ][^\d]+?)\s+\d{1,3}\s*-\s*\d{1,3}\b/g)) {
  if (!sections.has(m[1])) sections.set(m[1], { code: m[1], nom: tidyLabel(m[2]), total: null, titres: {}, programmes: undefined });
}
if (sections.size < 10) warnings.push(`seulement ${sections.size} sections lues dans la table des matières`);

// --- Répartition par ministère, titre, chapitre et article ---

const titres = {};
const chapitres = {};
const articles = {};
let current = null; // section en cours
let pendingTotals = [];
let pending = null;
const naturePages = pages.filter((p) => p.some((l) => /^Nature de d[ée]pense\s+LFR/.test(l)));
function emitNature(line) {
  const parsed = trailingAmounts(line, 3);
  if (!parsed) return false;
  const [lfr, lf] = parsed.values;
  const m = parsed.label.match(/^(\d{2})\s+([1-5])(?:\s+T([1-5])\s+(.+)|\s+(\d)\s+(\d)\s+(.+)|\s+(\d)\s+(.+))$/);
  if (!m) return false;
  const code = m[1];
  const sec = sections.get(code) ?? { code, nom: `Section ${code}`, total: null, titres: {} };
  if (!sections.has(code)) {
    sections.set(code, sec);
    warnings.push(`section ${code} absente de la table des matières`);
  }
  if (current !== code) {
    // Première ligne d'une section : les totaux qui précèdent sont celui de la
    // section puis celui du premier type de budget.
    current = code;
    if (pendingTotals.length) sec.total = { lfr: pendingTotals[0][0], lf: pendingTotals[0][1] };
  }
  pendingTotals = [];
  if (m[3]) {
    const t = m[3];
    const prev = sec.titres[t] ?? { lfr: 0, lf: 0 };
    sec.titres[t] = { lfr: prev.lfr + lfr, lf: prev.lf + lf };
    titres[t] ??= sentenceCase(m[4]);
  } else if (m[5]) {
    articles[`${m[2]}-${m[5]}-${m[6]}`] ??= tidyLabel(sentenceCase(m[7]));
  } else {
    chapitres[`${m[2]}-${m[8]}`] ??= tidyLabel(sentenceCase(m[9]));
  }
  return true;
}
for (const page of naturePages) {
  for (const line of page) {
    if (/^(Nature de d[ée]pense|Imputation$|\d{1,3}$)/.test(line)) continue;
    const onlyAmounts = /^-?\d{1,3}(?: \d{3})*(?: -?\d{1,3}(?: \d{3})*){2}$/.test(line) ? trailingAmounts(line, 3) : null;
    if (onlyAmounts && !onlyAmounts.label) {
      if (pending) {
        emitNature(pending + " " + line);
        pending = null;
      } else pendingTotals.push(onlyAmounts.values);
      continue;
    }
    const candidate = pending ? pending + " " + line : line;
    if (/^\d{2}\s+[1-5]\b/.test(candidate)) {
      if (emitNature(candidate)) pending = null;
      else pending = candidate;
    } else pending = null; // pied de page (intitulé du ministère, type de budget)
  }
}
for (const s of sections.values()) {
  const sum = Object.values(s.titres).reduce((a, t) => ({ lfr: a.lfr + t.lfr, lf: a.lf + t.lf }), { lfr: 0, lf: 0 });
  if (!s.total) s.total = sum;
  else if (Math.abs(sum.lf - s.total.lf) > 1 || Math.abs(sum.lfr - s.total.lfr) > 1)
    warnings.push(`section ${s.code} : somme des titres (${sum.lf}) ≠ total (${s.total.lf})`);
}

// --- Programmes par nature économique (ministères en budget-programme) ---

const NATURE_OF = [
  [/^charges financi[eè]res/i, "1"],
  [/^d[ée]penses de personnel/i, "2"],
  [/^d[ée]penses de biens et services/i, "3"],
  [/^d[ée]penses de transferts?/i, "4"],
  [/^d[ée]penses d.investissements?/i, "5"],
];
const programmePages = pages.filter(
  (p) => p.some((l) => /^Libell[ée] LFI? \d{4}/.test(l)) && p.some((l) => /^2\d{4}\s*-/.test(l)) && p.some((l) => NATURE_OF.some(([re]) => re.test(l))),
);
function sectionByName(name) {
  const key = (s) => new Set(norm(s).replace(/[^a-z ]/g, " ").split(" ").filter((w) => w.length > 3 && w !== "ministere"));
  const a = key(name);
  let best = null;
  let bestScore = 0;
  for (const s of sections.values()) {
    const b = key(s.nom);
    const inter = [...a].filter((w) => b.has(w)).length;
    const score = inter / Math.max(a.size, b.size);
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return bestScore >= 0.6 ? best : null;
}
let ministry = null;
let programme = null;
let buf = null;
const flushLine = (text) => {
  const nat = NATURE_OF.find(([re]) => re.test(text));
  const parsed = trailingAmounts(text, 1);
  if (!parsed) return false;
  const value = parsed.values[0];
  if (nat) {
    if (programme) programme.natures[nat[1]] = (programme.natures[nat[1]] ?? 0) + value;
    titres[nat[1]] = tidyLabel(parsed.label.charAt(0).toUpperCase() + parsed.label.slice(1).toLowerCase());
    return true;
  }
  const pm = parsed.label.match(/^(2\d{4})\s*-\s*(.+)$/);
  if (pm) {
    if (!ministry) return true;
    programme = { code: pm[1], libelle: tidyLabel(pm[2].charAt(0).toUpperCase() + pm[2].slice(1)), montant: value, natures: {} };
    ministry.programmes.push(programme);
    return true;
  }
  const sec = sectionByName(parsed.label);
  if (!sec) {
    warnings.push(`ministère non reconnu dans l'annexe des programmes : « ${parsed.label} »`);
    ministry = null;
    return true;
  }
  if (Math.abs(sec.total.lf - value) > 1) warnings.push(`section ${sec.code} : total des programmes ${value} ≠ total LF ${sec.total.lf}`);
  sec.programmes = [];
  ministry = sec;
  programme = null;
  return true;
};
for (const page of programmePages) {
  for (const line of page) {
    if (/^(Libell[ée]|Pr[ée]sentation|R[ée]partition|\d{1,3}$)/.test(line)) continue;
    const text = buf ? buf + " " + line : line;
    if (flushLine(text)) buf = null;
    else buf = text;
  }
}
for (const s of sections.values()) {
  for (const p of s.programmes ?? []) {
    const sum = Object.values(p.natures).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - p.montant) > 1) warnings.push(`programme ${s.code}/${p.code} : natures ${sum} ≠ montant ${p.montant}`);
  }
}

// --- Détail des crédits : nomenclature des paragraphes et sources ---

const detailText = pages
  .filter((p) => p.some((l) => /^Service B[ée]n[ée]ficiaire Imputation Nature Source/.test(l) || /Source fin LFR/.test(l)))
  .flat()
  .join(" ")
  .replace(/\s+/g, " ")
  .replace(/Code Min\. Service B[ée]n[ée]ficiaire Imputation Nature Source fin LFR \d{4} LFI? \d{4} Ecart/g, " ");
const variants = new Map(); // code → Map(libellé + source → nombre)
for (const chunk of detailText.split(/ (?=\d{2} \d{12} - )/)) {
  const m = chunk.match(/^\d{2} \d{12} - .+? (\d-\d-\d-\d{2}-\d{2}) (.+)$/);
  if (!m) continue;
  const tokens = m[2].split(" ");
  const k = tokens.findIndex((t) => /^-?\d{1,3}$/.test(t));
  if (k <= 0) continue;
  const text = tokens.slice(0, k).join(" ");
  const v = variants.get(m[1]) ?? new Map();
  v.set(text, (v.get(text) ?? 0) + 1);
  variants.set(m[1], v);
}
// Sources : ce qui diffère en fin de libellé entre les variantes d'un même code.
const sourceCount = new Map();
for (const v of variants.values()) {
  const list = [...v.keys()].map((k) => k.split(" "));
  if (list.length < 2) continue;
  let i = 0;
  while (list.every((w) => w.length > i) && new Set(list.map((w) => w[i].toLowerCase())).size === 1) i++;
  for (const w of list) {
    const suffix = w.slice(i).join(" ");
    if (suffix && w.length - i <= 3 && /^[A-ZÉ]/.test(suffix)) sourceCount.set(suffix, (sourceCount.get(suffix) ?? 0) + 1);
  }
}
// Sources usuelles (certaines n'apparaissent qu'avec un seul libellé et ne
// peuvent pas être déduites), puis sources déduites, sans doublon de casse.
const SEED_SOURCES = ["Ress. Propres", "Ress. Extérieures", "Contre Partie Finex", "Afd", "Titre D'État", "DTS", "C2D"];
const sources = [];
for (const s of [...SEED_SOURCES, ...sourceCount.keys()]) if (!sources.some((x) => x.toLowerCase() === s.toLowerCase())) sources.push(s);
const bySourceLength = [...sources].sort((a, b) => b.length - a.length);
const paragraphes = {};
for (const [code, v] of [...variants.entries()].sort()) {
  const labels = new Map();
  for (const [text, n] of v) {
    const src = bySourceLength.find((s) => text.toLowerCase().endsWith(" " + s.toLowerCase()));
    const label = src ? text.slice(0, text.length - src.length - 1) : text;
    labels.set(label, (labels.get(label) ?? 0) + n);
  }
  const best = [...labels.entries()].filter(([l]) => l.split(" ").length <= 14).sort((a, b) => b[1] - a[1])[0];
  if (best) paragraphes[code] = tidyLabel(best[0]);
}

// --- Budgets d'affectation spéciale ---

const bas = [];
const basPage = pages.find((p) => p.some((l) => /D[ÉE]PENSES DES BUDGETS D.AFFECTATION SP[ÉE]CIALE/i.test(l)));
if (basPage) {
  let acc = null;
  for (const line of basPage) {
    const text = acc ? acc + " " + line : line;
    if (!/^Fonds\b/.test(text)) continue;
    const parsed = trailingAmounts(text, 3);
    if (!parsed) {
      acc = text;
      continue;
    }
    acc = null;
    const sm = parsed.label.match(/^(.+?)\s*\(([A-Z]{2,12})\)$/);
    bas.push({ nom: tidyLabel(sm ? sm[1] : parsed.label), sigle: sm ? sm[2] : "", lfr: parsed.values[0], lf: parsed.values[1] });
  }
}

// --- Écriture ---

const data = {
  annee,
  anneeLfr,
  source: path.basename(pdf),
  sections: [...sections.values()]
    .filter((s) => s.total && (s.total.lf || s.total.lfr))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((s) => ({ code: s.code, nom: s.nom, total: s.total, titres: s.titres, ...(s.programmes?.length ? { programmes: s.programmes } : {}) })),
  titres,
  chapitres: Object.fromEntries(Object.entries(chapitres).sort()),
  articles: Object.fromEntries(Object.entries(articles).sort()),
  paragraphes,
  sources: sources.sort(),
  bas,
};
const body = `// Fichier généré par scripts/lf-referentiel.mjs à partir de « ${data.source} ».
// Ne pas modifier à la main : relancer le script sur la nouvelle loi de finances.
import type { LoiDeFinances } from "./lf";

export const LF_DATA: LoiDeFinances = ${JSON.stringify(data, null, 1)};
`;
fs.writeFileSync(out, body, "utf8");
console.log(
  `LF ${annee} (LFR ${anneeLfr}) : ${data.sections.length} sections, ${data.sections.filter((s) => s.programmes).length} en budget-programme, ` +
    `${Object.keys(chapitres).length} chapitres, ${Object.keys(articles).length} articles, ${Object.keys(paragraphes).length} paragraphes, ` +
    `${sources.length} sources, ${bas.length} BAS → ${out}`,
);
for (const w of warnings) console.warn("  ! " + w);
