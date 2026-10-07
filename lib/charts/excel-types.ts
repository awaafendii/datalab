// Export Excel des graphiques personnalisés : pour chaque graphique, le
// tableau de ses données (valeurs réelles, telles qu'agrégées pour le tracé)
// et, quand Excel sait dessiner ce type, la description d'un graphique Excel
// natif relié à ce tableau (modifiable dans Excel). Les autres types sont
// exportés en image, à côté de leur tableau.

export type ExcelCell = string | number | boolean | Date | null;

export interface ChartTable {
  columns: string[];
  rows: ExcelCell[][];
  // Mise en forme conditionnelle « échelle de couleurs » sur les valeurs
  // numériques (cartes de chaleur, matrices de corrélation).
  colorScale?: { colors: [string, string, string]; min?: number; mid?: number; max?: number };
}

export type NativeKind = "col" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "bubble" | "radar";

export interface NativeTrend {
  type: "linear" | "poly" | "exp" | "log" | "power" | "movingAvg";
  order?: number; // polynomiale
  period?: number; // moyenne mobile
}

export interface NativeSeries {
  name: string;
  color: string;
  valueCol: number; // colonne des valeurs (Y) dans le tableau
  kind?: "col" | "line" | "area"; // graphique combiné
  secondary?: boolean; // axe secondaire
  xCol?: number; // nuage : colonne des X
  sizeCol?: number; // bulles : colonne des tailles
  rowStart?: number; // lignes utilisées (indices dans rows, inclus) ; par défaut toutes
  rowEnd?: number;
  pointColors?: string[]; // une couleur par catégorie (secteurs, « varier les couleurs »)
  literalName?: boolean; // nom écrit tel quel (séries d'un même tableau, ex. nuage par groupe)
  trend?: NativeTrend;
}

export interface NativeChart {
  kind: NativeKind;
  grouping: "clustered" | "stacked" | "percentStacked" | "standard";
  series: NativeSeries[];
  categoryCol: number;
  title: string | null;
  xTitle: string;
  yTitle: string;
  y2Title: string;
  legend: "t" | "b" | "l" | "r" | null;
  labels: "none" | "value" | "percent" | "category" | "categoryPercent" | "categoryValue";
  numFmt: string; // format des valeurs (axe, étiquettes)
  y2NumFmt?: string;
  y2Max?: number;
  dispUnit: "none" | "thousands" | "millions" | "billions";
  xNumFmt?: string; // nuage : format de l'axe X (dates)
  grid: boolean;
  logScale?: boolean;
  min?: number | null;
  max?: number | null;
  holeSize?: number; // anneau (10 à 90)
  smooth?: boolean;
  markers?: boolean;
  markerSize?: number;
  lineWidthPt?: number;
  dash?: boolean;
  gapWidth?: number; // 0 à 500 (% de la largeur d'une barre)
  overlap?: number; // -100 à 100
  radarFilled?: boolean;
  alpha?: number; // opacité des remplissages et marqueurs (0 à 1)
  reverseCategories?: boolean; // barres horizontales : 1re catégorie en haut
  font: string;
  fontSizePt: number;
}

export interface ExcelChartExport {
  table: ChartTable | null;
  native: NativeChart | null;
  note?: string; // précision affichée sous le titre dans Excel
}
