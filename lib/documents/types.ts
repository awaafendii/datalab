// Types du module « Contrôle de documents » : structuration et détection
// d'anomalies dans les documents administratifs (rapports d'activités,
// rapports d'étude ou d'inspection, stratégies, CDMT, cahiers des charges,
// termes de référence, matrices d'indicateurs des directions…).

export type DocFormat = "docx" | "pdf" | "sheet";

// --- Contenu extrait d'un fichier, indépendamment de son format ---

export interface HeadingBlock {
  kind: "heading";
  id: string;
  level: number; // 1 = niveau le plus haut
  text: string;
  // true si le titre a été déduit de la mise en forme (PDF, paragraphe
  // numéroté ou en majuscules) plutôt que d'un style « Titre » du fichier.
  inferred: boolean;
  page?: number;
}

export interface ParagraphBlock {
  kind: "paragraph";
  id: string;
  text: string;
  list: boolean; // élément de liste à puces ou numérotée
  page?: number;
}

// Image, graphique ou dessin sans texte : utile pour ne pas signaler comme
// « vide » une section qui ne contient qu'une illustration.
export interface FigureBlock {
  kind: "figure";
  id: string;
  page?: number;
}

export interface TableBlock {
  kind: "table";
  id: string;
  // Grille de cellules. Une cellule fusionnée horizontalement porte son
  // texte dans la première colonne ; les colonnes couvertes valent "".
  rows: string[][];
  // Largeur de chaque cellule (1 par défaut, 0 = colonne couverte par une
  // fusion). Absent quand le format ne fournit pas l'information.
  spans?: number[][];
  // Nombre de lignes d'en-tête déclarées par le fichier (Word : « répéter
  // en haut de chaque page » ; Excel : en-têtes fusionnés recomposés).
  headerRows?: number;
  caption?: string; // titre fourni par le fichier (nom de feuille, titre de tableau)
  sheet?: string;
  page?: number;
}

export type DocBlock = HeadingBlock | ParagraphBlock | FigureBlock | TableBlock;

export interface DocModel {
  fileName: string;
  format: DocFormat;
  blocks: DocBlock[];
  pageCount?: number;
  pagesWithImages?: number[];
  // Limites de l'extraction à signaler à l'utilisateur (PDF scanné,
  // tableaux PDF lus comme du texte…).
  warnings: string[];
}

// --- Typologie documentaire ---

export type DocKind =
  | "rapport-activite"
  | "rapport-etude"
  | "rapport-inspection"
  | "strategie"
  | "cdmt"
  | "cahier-charges"
  | "tdr"
  | "matrice-indicateurs"
  | "loi-finances"
  | "autre";

// --- Anomalies ---

export type Severity = "bloquante" | "majeure" | "mineure" | "info";

export const SEVERITY_ORDER: Record<Severity, number> = { bloquante: 0, majeure: 1, mineure: 2, info: 3 };

export type AnomalyCategory =
  | "calcul"
  | "coherence"
  | "completude"
  | "structure"
  | "redaction"
  | "indicateurs"
  | "sigles"
  | "budget";

export interface AnomalyLocation {
  section?: string; // chemin des titres (« II.1 › II.1.2 … »)
  table?: string; // titre ou numéro du tableau
  row?: string; // libellé de la ligne concernée
  column?: string;
  sheet?: string;
  page?: number;
  blockId?: string;
}

export interface Anomaly {
  id: string; // stable d'une analyse à l'autre (sert à mémoriser le statut)
  rule: string;
  category: AnomalyCategory;
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string; // correction ou solution proposée
  excerpt?: string; // extrait exact du document
  location: AnomalyLocation;
}

export type AnomalyStatus = "a-traiter" | "corrigee" | "ignoree";

// --- Données structurées produites par l'analyse ---

export type IndicatorType =
  | "pourcentage"
  | "nombre"
  | "montant"
  | "delai"
  | "jalon"
  | "ratio"
  | "non-type";

export interface IndicatorRecord {
  source: string; // tableau ou section d'où provient l'indicateur
  department?: string;
  activity?: string;
  label: string;
  type: IndicatorType;
  reference?: string;
  target?: string;
  achieved?: string;
  rate?: string;
  funding?: string;
  owner?: string;
  verification?: string;
  period?: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  numbering: string | null;
  blockId: string;
  inferred: boolean;
  anomalyCount: number;
}

export interface TableSummary {
  blockId: string;
  title: string;
  section: string;
  rows: number;
  cols: number;
  header: string[];
  body: string[][];
}

export interface DepartmentMatch {
  id: string;
  label: string;
  score: number;
  evidence: string[];
}

export interface DocStats {
  words: number;
  paragraphs: number;
  headings: number;
  tables: number;
  figures: number;
  pages?: number;
}

// Rapprochement avec la loi de finances en vigueur (section budgétaire du
// document, montants comparés).
export interface LfComparisonRow {
  scope: string; // « Total », « Programme 001 — … (21001) », « 2 Dépenses de personnel »
  level: 0 | 1 | 2;
  column: string; // « LF 2026 », « LFR 2025 »
  document: number | null; // en GNF
  law: number; // en GNF
}

export interface BudgetLink {
  annee: number;
  anneeLfr: number;
  source: string;
  section: { code: string; nom: string; lf: number; lfr: number; programmes: { code: string; libelle: string; montant: number }[] };
  evidence: string;
  manual: boolean;
  comparison: LfComparisonRow[];
}

export interface DocAnalysis {
  fileName: string;
  format: DocFormat;
  kind: DocKind;
  kindDetected: DocKind;
  kindConfidence: number; // 0..1
  kindReasons: string[];
  departments: DepartmentMatch[];
  outline: OutlineItem[];
  tables: TableSummary[];
  indicators: IndicatorRecord[];
  stats: DocStats;
  anomalies: Anomaly[];
  warnings: string[];
  budget: BudgetLink | null;
}
