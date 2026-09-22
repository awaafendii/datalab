// Types partagés de la plateforme d'analyse de données.

export type CellValue = string | number | boolean | null;

export type Row = Record<string, CellValue>;

export type ColumnType = "number" | "date" | "boolean" | "string" | "empty";

export interface Dataset {
  columns: string[];
  rows: Row[];
  fileName: string;
  // true si le fichier source n'avait pas de ligne d'en-têtes détectable :
  // les noms de colonnes ont été générés automatiquement (Valeur 1, Date 2…).
  headerInferred?: boolean;
}

// --- Fichiers multi-feuilles (Excel) ---

// Une feuille telle que lue depuis le fichier source, avant tout nettoyage.
export interface SheetInput {
  name: string;
  dataset: Dataset;
}

// Résultat du parsing d'un fichier : un CSV produit toujours une seule
// "feuille" ; un classeur Excel peut en produire plusieurs.
export interface WorkbookInput {
  fileName: string;
  sheets: SheetInput[];
}

export interface NumericStats {
  count: number;
  missing: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
}

export interface CategoricalStats {
  count: number;
  missing: number;
  unique: number;
  top: { value: string; count: number }[];
}

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  count: number;        // valeurs non vides
  missing: number;      // valeurs vides
  missingPct: number;
  unique: number;
  numeric?: NumericStats;
  categorical?: CategoricalStats;
  outliers?: number;    // nombre de valeurs hors [Q1-1.5*IQR, Q3+1.5*IQR]
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  totalMissing: number;
  columns: ColumnProfile[];
}

// Options de nettoyage / apurement.
export type MissingStrategy =
  | "none"        // ne rien faire
  | "drop-rows"   // supprimer les lignes contenant au moins un vide
  | "mean"        // imputer par la moyenne (num) / mode (catégoriel)
  | "median"      // imputer par la médiane (num) / mode (catégoriel)
  | "mode"        // imputer par le mode
  | "zero"        // imputer par 0 (num) / "" (autre)
  | "constant";   // imputer par une constante fournie

export type OutlierStrategy =
  | "none"    // ne rien faire
  | "remove"  // supprimer les lignes contenant un outlier numérique
  | "cap";    // ramener les outliers aux bornes (winsorisation IQR)

export interface CleaningOptions {
  trimStrings: boolean;
  removeDuplicates: boolean;
  standardizeEmpty: boolean;      // "", "NA", "N/A", "null", "-" => null
  coerceNumbers: boolean;         // convertir les colonnes majoritairement numériques
  missingStrategy: MissingStrategy;
  missingConstant: string;
  outlierStrategy: OutlierStrategy;
  outlierThreshold: number;       // multiplicateur d'IQR (défaut 1.5)
}

export interface CleaningStep {
  label: string;
  detail: string;
}

export interface CleaningResult {
  dataset: Dataset;
  steps: CleaningStep[];
  rowsBefore: number;
  rowsAfter: number;
}

export interface Correlation {
  a: string;
  b: string;
  r: number;
}

export interface HistogramBin {
  label: string;
  count: number;
}

export interface ColumnAnalysis {
  name: string;
  type: ColumnType;
  histogram?: HistogramBin[];       // colonnes numériques
  categories?: { label: string; count: number }[]; // colonnes catégorielles
}

export interface Analysis {
  profile: DatasetProfile;
  correlations: Correlation[];
  columnAnalyses: ColumnAnalysis[];
  observations: string[];
}

// --- Machine Learning : clustering (k-means) & régression linéaire ---

export interface KMeansClusterStat {
  cluster: number;
  size: number;
  share: number; // % des lignes utilisées
  means: Record<string, number>; // moyenne de chaque colonne sélectionnée dans ce groupe
}

export interface KMeansPoint {
  rowIndex: number;
  cluster: number;
  values: Record<string, number>; // valeurs originales des colonnes sélectionnées
}

export interface ElbowPoint {
  k: number;
  inertia: number;
}

export interface KMeansResult {
  columns: string[];
  k: number;
  rowsUsed: number;
  rowsSkipped: number;
  sampled: boolean; // vrai si calculé sur un échantillon (gros volumes)
  iterations: number;
  inertia: number;
  clusters: KMeansClusterStat[];
  points: KMeansPoint[];
  elbow: ElbowPoint[];
}

export interface RegressionCoefficient {
  name: string; // nom du prédicteur
  coefficient: number;
  standardized?: number; // coefficient standardisé (comparabilité entre variables)
}

export interface RegressionPoint {
  rowIndex: number;
  actual: number;
  predicted: number;
  residual: number;
  x?: number; // valeur du prédicteur (régression simple uniquement)
}

export interface RegressionResult {
  target: string;
  predictors: string[];
  rowsUsed: number;
  rowsSkipped: number;
  intercept: number;
  coefficients: RegressionCoefficient[];
  r2: number;
  adjustedR2: number;
  rmse: number;
  mae: number;
  equation: string;
  points: RegressionPoint[];
}

// --- Compréhension du contexte : secteur d'activité & facteurs clés ---

// Catégories reconnues par le dictionnaire heuristique local (lib/sectors.ts).
// L'analyse IA optionnelle n'est pas limitée à cette liste : elle renvoie son
// propre libellé libre dans `sectorLabel`, `sector` reste "inconnu" pour elle.
export type SectorId =
  | "rh"
  | "ventes"
  | "finance"
  | "sante"
  | "education"
  | "immobilier"
  | "logistique"
  | "marketing"
  | "inconnu";

export interface HeaderSuggestion {
  column: string; // nom de colonne actuel
  suggestion: string; // nom proposé (IA uniquement) — informatif, non appliqué automatiquement
}

export interface ContextResult {
  source: "heuristic" | "ai";
  sector: SectorId;
  sectorLabel: string;
  confidence: number; // 0..1
  matchedKeywords: string[]; // mots-clés ayant permis la détection (heuristique)
  keyColumns: string[]; // colonnes du dataset jugées pertinentes pour l'analyse
  rationale: string; // courte explication (français)
  headerSuggestions: HeaderSuggestion[];
}

// État du pipeline (nettoyage + analyse) pour une feuille donnée. Chaque
// feuille d'un classeur multi-onglets est traitée indépendamment : ses
// propres réglages de nettoyage, son propre résultat, sa propre analyse.
export interface SheetState {
  name: string;
  dataset: Dataset; // données brutes de la feuille, telles que chargées
  options: CleaningOptions;
  result: CleaningResult | null; // null tant que la feuille n'a pas été nettoyée
  analysis: Analysis | null;
  // Résultat de l'analyse IA optionnelle pour cette feuille, si l'utilisateur
  // l'a activée ; null => on affiche l'analyse heuristique locale par défaut.
  aiContext: ContextResult | null;
}

export const DEFAULT_CLEANING: CleaningOptions = {
  trimStrings: true,
  removeDuplicates: true,
  standardizeEmpty: true,
  coerceNumbers: true,
  missingStrategy: "median",
  missingConstant: "",
  outlierStrategy: "none",
  outlierThreshold: 1.5,
};
