// Module « Suivi d'exécution budgétaire » : à partir d'un tableau d'exécution
// (dotations / engagements / paiements par programme, action, titre ou
// imputation), calcule les taux d'exécution, détecte les sur- et
// sous-consommations et rapproche éventuellement le total des crédits votés
// de la loi de finances en vigueur (lib/documents/lf.ts).
//
// Tout est pur et sérialisable : aucune dépendance au DOM, testable.

export type ExecSeverity = "bloquante" | "majeure" | "mineure" | "info";

export const EXEC_SEVERITY_ORDER: Record<ExecSeverity, number> = {
  bloquante: 0,
  majeure: 1,
  mineure: 2,
  info: 3,
};

// Statut synthétique d'une ligne d'exécution.
export type ExecStatus =
  | "depassement" // engagements ou paiements au-delà de la dotation
  | "non-execute" // dotation non nulle, rien d'engagé ni payé
  | "sous-execution" // taux d'exécution sous le seuil d'alerte
  | "normal"
  | "indetermine"; // montants manquants / ligne non exploitable

// Rôle de chaque colonne du fichier, deviné puis ajustable par l'utilisateur.
export interface ExecColumnMapping {
  label: string | null; // libellé (programme, action, nature…)
  code: string | null; // code / imputation (facultatif)
  dotation: string | null; // crédits ouverts / votés / budget
  engagement: string | null;
  paiement: string | null; // ordonnancement / décaissement / dépense réelle
}

export interface ExecAlert {
  severity: ExecSeverity;
  rule: string; // code machine (depassement, paiement-sup-engagement…)
  message: string;
  line?: number; // index de ligne source concernée (absent = alerte globale)
  label?: string; // libellé de la ligne, pour l'affichage
}

export interface ExecLine {
  index: number; // index de la ligne dans le dataset source
  label: string;
  code: string | null;
  isTotalRow: boolean; // ligne de total/sous-total détectée (exclue des agrégats)
  dotation: number | null;
  engagement: number | null;
  paiement: number | null;
  tauxEngagement: number | null; // engagement / dotation
  tauxExecution: number | null; // paiement / dotation
  tauxDecaissement: number | null; // paiement / engagement
  disponible: number | null; // dotation - engagement
  statut: ExecStatus;
  alerts: ExecAlert[];
}

export interface ExecTotals {
  dotation: number;
  engagement: number;
  paiement: number;
  disponible: number;
  tauxEngagement: number | null;
  tauxExecution: number | null;
  lignes: number; // nombre de lignes agrégées (hors lignes de total)
}

// Rapprochement du total des dotations avec les crédits votés d'une section
// budgétaire de la loi de finances.
export interface LfReconciliation {
  sectionCode: string;
  sectionNom: string;
  dotationDocument: number; // somme des dotations du fichier
  creditsVotes: number; // montant voté (LF de l'année)
  ecart: number; // document - loi
  ecartPct: number; // écart relatif aux crédits votés (0..1)
  conforme: boolean; // |ecartPct| <= tolérance
}

export interface ExecThresholds {
  // Taux d'exécution (paiement/dotation) en dessous duquel une ligne dotée
  // est signalée en sous-exécution.
  sousExecution: number;
  // Marge au-delà de 100 % tolérée avant de parler de dépassement (arrondis).
  depassementTolerance: number;
  // Écart relatif toléré lors du rapprochement avec la loi de finances.
  lfTolerance: number;
}

export const DEFAULT_EXEC_THRESHOLDS: ExecThresholds = {
  sousExecution: 0.5,
  depassementTolerance: 0.001,
  lfTolerance: 0.01,
};

export interface ExecutionReport {
  mapping: ExecColumnMapping;
  lines: ExecLine[];
  totals: ExecTotals;
  alerts: ExecAlert[]; // toutes les alertes, triées par gravité
  reconciliation: LfReconciliation | null;
  warnings: string[]; // ex. colonne non identifiée, lignes ignorées
}
