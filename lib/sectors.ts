// Détection heuristique du secteur d'activité et des colonnes clés, à partir
// des seuls noms de colonnes. Aucune donnée n'est envoyée nulle part : c'est
// un dictionnaire de mots-clés comparé localement, dans le navigateur.
//
// C'est le mode par défaut (toujours actif). Le mode IA optionnel
// (lib/context-ai.ts) prend le relais quand l'utilisateur l'active
// explicitement, avec une compréhension plus fine mais qui nécessite
// d'envoyer un échantillon de données à l'API Claude.

import type { ContextResult, SectorId } from "./types";

interface SectorDef {
  id: SectorId;
  label: string;
  keywords: string[];
}

const SECTORS: SectorDef[] = [
  {
    id: "rh",
    label: "Ressources humaines",
    keywords: [
      "salaire", "salary", "matricule", "poste", "departement", "service",
      "anciennete", "conge", "employe", "effectif", "embauche", "manager",
      "contrat", "cdi", "cdd", "recrutement", "collaborateur",
    ],
  },
  {
    id: "ventes",
    label: "Ventes / Commerce",
    keywords: [
      "produit", "prix", "montant", "quantite", "vente", "client", "commande",
      "panier", "remise", "categorie", "chiffre affaire", "ca", "facture",
      "reference produit", "boutique", "magasin",
    ],
  },
  {
    id: "finance",
    label: "Finance / Comptabilité",
    keywords: [
      "credit", "debit", "solde", "tva", "compte", "budget", "depense",
      "recette", "taux", "interet", "echeance", "devise", "transaction",
      "virement", "bilan",
    ],
  },
  {
    id: "sante",
    label: "Santé",
    keywords: [
      "patient", "diagnostic", "traitement", "medecin", "hopital",
      "consultation", "tension", "poids", "taille", "imc", "pathologie",
      "symptome", "dossier medical", "vaccin",
    ],
  },
  {
    id: "education",
    label: "Éducation",
    keywords: [
      "etudiant", "eleve", "note", "matiere", "classe", "moyenne", "examen",
      "diplome", "ecole", "universite", "enseignant", "cours", "credit ects",
    ],
  },
  {
    id: "immobilier",
    label: "Immobilier",
    keywords: [
      "surface", "loyer", "piece", "chambre", "adresse", "bien", "location",
      "quartier", "etage", "copropriete", "charges", "prix m2",
    ],
  },
  {
    id: "logistique",
    label: "Logistique / Stock",
    keywords: [
      "stock", "entrepot", "livraison", "transporteur", "reference", "sku",
      "expedition", "delai", "fournisseur", "entrepôt", "colis", "tracking",
    ],
  },
  {
    id: "marketing",
    label: "Marketing / CRM",
    keywords: [
      "campagne", "clic", "impression", "conversion", "lead", "canal",
      "budget pub", "taux conversion", "segment", "prospect", "abonne",
      "newsletter", "ctr",
    ],
  },
];

// Retire les accents et met en minuscules pour une comparaison robuste
// ("Département" ~ "departement").
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface SectorMatch {
  sector: SectorId;
  sectorLabel: string;
  confidence: number;
  matchedKeywords: string[];
  keyColumns: string[];
}

export function detectSector(columns: string[]): SectorMatch {
  const normCols = columns.map((c) => ({ raw: c, norm: normalize(c) }));

  let best: { def: SectorDef; score: number; matched: string[]; cols: Set<string> } | null =
    null;

  for (const def of SECTORS) {
    let score = 0;
    const matched: string[] = [];
    const cols = new Set<string>();
    for (const kw of def.keywords) {
      const nkw = normalize(kw);
      const hit = normCols.find((c) => c.norm.includes(nkw));
      if (hit) {
        score += 1;
        matched.push(kw);
        cols.add(hit.raw);
      }
    }
    if (!best || score > best.score) {
      best = { def, score, matched, cols };
    }
  }

  if (!best || best.score === 0) {
    return {
      sector: "inconnu",
      sectorLabel: "Non déterminé",
      confidence: 0,
      matchedKeywords: [],
      keyColumns: [],
    };
  }

  // Score normalisé : ~3 mots-clés (ou 35% du dictionnaire du secteur)
  // suffisent pour une confiance maximale. Approximatif par construction.
  const confidence = Math.min(1, best.score / Math.max(3, best.def.keywords.length * 0.35));

  return {
    sector: best.def.id,
    sectorLabel: best.def.label,
    confidence: Math.round(confidence * 100) / 100,
    matchedKeywords: best.matched,
    keyColumns: Array.from(best.cols),
  };
}

// Point d'entrée utilisé par l'UI : enveloppe detectSector dans le format
// ContextResult commun aux deux sources (heuristique / IA).
export function detectContextHeuristic(columns: string[]): ContextResult {
  const match = detectSector(columns);
  const rationale =
    match.sector === "inconnu"
      ? "Aucun mot-clé de secteur connu n'a été reconnu dans les noms de colonnes."
      : `Détecté à partir de mot(s)-clé(s) trouvé(s) dans les noms de colonnes : ${match.matchedKeywords.join(", ")}.`;

  return {
    source: "heuristic",
    sector: match.sector,
    sectorLabel: match.sectorLabel,
    confidence: match.confidence,
    matchedKeywords: match.matchedKeywords,
    keyColumns: match.keyColumns,
    rationale,
    headerSuggestions: [],
  };
}
