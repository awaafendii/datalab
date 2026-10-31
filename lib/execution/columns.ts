import type { Dataset } from "@/lib/types";
import { norm } from "@/lib/documents/text";
import { parseNumber } from "@/lib/documents/numbers";
import type { ExecColumnMapping } from "./types";

// Devine le rôle de chaque colonne d'un tableau d'exécution budgétaire à
// partir de son en-tête (mots-clés, sans accents ni casse) et, pour les
// colonnes de montants, de la proportion de valeurs réellement numériques.
// L'utilisateur peut ensuite corriger ce mappage dans l'interface.

// Mots-clés par rôle. Les listes « montant » sont volontairement spécifiques
// pour éviter les collisions (« crédits de paiement » = paiement, pas
// dotation ; « crédits ouverts » = dotation).
const DOTATION_KW = [
  "dotation",
  "credits ouverts",
  "credit ouvert",
  "credits votes",
  "credit vote",
  "ouverture",
  "budget",
  "prevision",
  "previsions",
  "prevu",
  "enveloppe",
  "lfi",
  "loi de finances",
  "initial",
  "initiale",
  "notifie",
  "notification",
  "autorise",
  "autorisation budgetaire",
];
const ENGAGEMENT_KW = ["engagement", "engage", "engagements", "ae", "autorisation d'engagement"];
const PAIEMENT_KW = [
  "paiement",
  "paiements",
  "paye",
  "payes",
  "ordonnancement",
  "ordonnance",
  "mandatement",
  "mandate",
  "mandat",
  "decaissement",
  "decaisse",
  "realisation",
  "realise",
  "execution",
  "execute",
  "depense reelle",
  "depenses reelles",
  "liquidation",
  "cp",
];
const LABEL_KW = [
  "libelle",
  "intitule",
  "designation",
  "programme",
  "action",
  "activite",
  "rubrique",
  "nature",
  "chapitre",
  "poste",
  "ligne budgetaire",
  "objet",
];
const CODE_KW = ["code", "imputation", "numero", "reference", "n°", "ndeg", "section"];

// Proportion de valeurs non vides réellement numériques dans une colonne.
function numericShare(dataset: Dataset, col: string): number {
  let seen = 0;
  let numeric = 0;
  for (const row of dataset.rows) {
    const v = row[col];
    if (v === null || v === undefined || v === "") continue;
    seen++;
    if (typeof v === "number" && Number.isFinite(v)) numeric++;
    else if (typeof v === "string" && parseNumber(v) !== null) numeric++;
  }
  return seen === 0 ? 0 : numeric / seen;
}

// Index du mot-clé trouvé dans l'en-tête (-1 sinon). Un index faible = mot-clé
// plus prioritaire, sert à départager.
function keywordRank(header: string, keywords: string[]): number {
  const h = norm(header);
  for (let i = 0; i < keywords.length; i++) {
    const kw = norm(keywords[i]);
    // « cp » / « ae » / « n° » : correspondance de mot entier pour éviter les
    // faux positifs (« cadre de performance » contient « cp »).
    if (kw.length <= 3) {
      if (new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(h)) return i;
    } else if (h.includes(kw)) {
      return i;
    }
  }
  return -1;
}

export function detectColumns(dataset: Dataset): ExecColumnMapping {
  const cols = dataset.columns;
  const shares = new Map(cols.map((c) => [c, numericShare(dataset, c)]));
  const taken = new Set<string>();

  // Meilleure colonne pour un rôle de montant : en-tête correspondant et
  // valeurs majoritairement numériques, non déjà attribuée.
  const pickAmount = (keywords: string[]): string | null => {
    let best: string | null = null;
    let bestRank = Infinity;
    for (const c of cols) {
      if (taken.has(c)) continue;
      if ((shares.get(c) ?? 0) < 0.5) continue;
      const rank = keywordRank(c, keywords);
      if (rank >= 0 && rank < bestRank) {
        best = c;
        bestRank = rank;
      }
    }
    if (best) taken.add(best);
    return best;
  };

  // Dotation d'abord (mots-clés les plus spécifiques), puis paiement (pour
  // capter « crédits de paiement »), puis engagement.
  const dotation = pickAmount(DOTATION_KW);
  const paiement = pickAmount(PAIEMENT_KW);
  const engagement = pickAmount(ENGAGEMENT_KW);

  // Libellé : colonne de texte correspondant à un mot-clé, sinon la première
  // colonne majoritairement textuelle.
  const pickText = (keywords: string[], requireKeyword: boolean): string | null => {
    let best: string | null = null;
    let bestRank = Infinity;
    for (const c of cols) {
      if (taken.has(c)) continue;
      if ((shares.get(c) ?? 0) >= 0.5) continue; // on veut du texte
      const rank = keywordRank(c, keywords);
      if (rank >= 0 && rank < bestRank) {
        best = c;
        bestRank = rank;
      } else if (!requireKeyword && best === null && rank < 0) {
        best = c; // premier candidat textuel, à défaut de mot-clé
      }
    }
    if (best) taken.add(best);
    return best;
  };

  const label = pickText(LABEL_KW, true) ?? pickText(LABEL_KW, false);
  const code = pickText(CODE_KW, true);

  return { label, code, dotation, engagement, paiement };
}
