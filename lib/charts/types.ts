// Types du créateur de graphiques (paramétrage façon Excel / Power BI).
//
// Un graphique est entièrement décrit par un ChartConfig sérialisable : type,
// colonnes affectées à chaque rôle (axe X, valeurs, légende…), calcul
// d'agrégation et mise en forme. lib/charts/build.ts le traduit en figure
// Plotly ; rien d'autre n'est stocké.

import type { MapLevel } from "./geo";

export type ChartType =
  // Comparaison
  | "column"
  | "bar"
  | "lollipop"
  | "pareto"
  | "combo"
  // Évolution
  | "line"
  | "area"
  | "waterfall"
  | "candlestick"
  | "gantt"
  // Répartition & hiérarchie
  | "pie"
  | "donut"
  | "treemap"
  | "sunburst"
  | "icicle"
  | "funnel"
  // Distribution
  | "histogram"
  | "box"
  | "violin"
  | "density"
  | "ecdf"
  | "strip"
  // Relations
  | "scatter"
  | "bubble"
  | "heatmap"
  | "correlation"
  | "density2d"
  | "splom"
  | "parallel"
  // Flux, polaire & 3D
  | "sankey"
  | "radar"
  | "polarBar"
  | "scatter3d"
  // Indicateurs
  | "kpi"
  | "gauge"
  // Cartes géographiques
  | "choropleth"
  | "mapBubble";

// Rôle d'une colonne dans un graphique. Le libellé affiché dépend du type
// (ex. « group » = « Légende » pour des colonnes, « Lignes » pour une carte
// de chaleur) : voir lib/charts/catalog.ts.
export type RoleKey =
  | "x"
  | "y"
  | "group"
  | "size"
  | "z"
  | "path"
  | "dims"
  | "open"
  | "high"
  | "low"
  | "close"
  | "start"
  | "end"
  | "lat"
  | "lon";

export type ColumnKind = "number" | "date" | "category";

export interface ColumnInfo {
  name: string;
  kind: ColumnKind;
  unique: number; // valeurs distinctes
  count: number; // valeurs non vides
  geo?: MapLevel; // fond de carte reconnu dans ses valeurs (régions, pays…)
}

export type Aggregation =
  | "sum"
  | "mean"
  | "median"
  | "count"
  | "distinct"
  | "min"
  | "max"
  | "none";

export type DateBucket = "none" | "day" | "month" | "quarter" | "year";

export type SortMode =
  | "auto"
  | "none"
  | "label-asc"
  | "label-desc"
  | "value-desc"
  | "value-asc";

export type LegendPosition = "top" | "bottom" | "left" | "right" | "hidden";
export type LabelPosition = "auto" | "inside" | "outside";
// « auto » : millions ou milliards selon l'ordre de grandeur des valeurs.
export type DisplayUnit = "auto" | "none" | "k" | "M" | "Md";
export type BarMode = "group" | "stack" | "percent" | "overlay";
export type LineShape = "linear" | "spline" | "hv";
export type DashStyle = "solid" | "dash" | "dot" | "dashdot";
export type MarkerSymbol =
  | "circle"
  | "square"
  | "diamond"
  | "triangle-up"
  | "cross"
  | "x"
  | "star";
export type TrendKind =
  | "none"
  | "linear"
  | "poly2"
  | "poly3"
  | "exp"
  | "log"
  | "power"
  | "movavg";
export type BoxPoints = "none" | "outliers" | "all";
export type HistNorm = "count" | "percent" | "density";
export type PieText = "percent" | "value" | "label" | "label+percent" | "label+value";
export type SeriesRender = "bar" | "line" | "area";

export interface ChartConfig {
  id: string;
  type: ChartType;

  // --- Données ---
  roles: Partial<Record<RoleKey, string[]>>;
  agg: Aggregation;
  dateBucket: DateBucket;
  sort: SortMode;
  topN: number; // 0 = toutes les catégories
  others: boolean; // regrouper les catégories écartées dans « Autres »

  // --- Titres ---
  showTitle: boolean;
  title: string; // "" = titre automatique
  titleAlign: "left" | "center";
  xTitle: string | null; // null = automatique, "" = masqué
  yTitle: string | null;
  y2Title: string | null;

  // --- Couleurs ---
  palette: string; // id de palette (lib/charts/palettes.ts)
  colors: Record<string, string>; // couleur imposée par série / catégorie
  varyColors: boolean; // une couleur par catégorie (série unique)
  colorscale: string; // échelle continue (cartes de chaleur, densités…)
  reverseScale: boolean;
  scaleFrom: string; // échelle personnalisée : couleur basse
  scaleTo: string; // échelle personnalisée : couleur haute
  opacity: number;
  background: "transparent" | "custom";
  bgColor: string;

  // --- Texte ---
  fontFamily: string;
  fontSize: number;

  // --- Légende ---
  legend: LegendPosition;

  // --- Étiquettes de données & format des nombres ---
  labels: boolean;
  labelPosition: LabelPosition;
  decimals: number; // -1 = automatique
  unit: DisplayUnit;
  prefix: string;
  suffix: string;

  // --- Axes ---
  grid: boolean;
  xAngle: number | null; // null = automatique
  yLog: boolean;
  yMin: number | null;
  yMax: number | null;

  // --- Style ---
  barMode: BarMode;
  barGap: number;
  cornerRadius: number;
  lineShape: LineShape;
  lineWidth: number;
  dash: DashStyle;
  markers: boolean;
  markerSize: number;
  markerSymbol: MarkerSymbol;
  fill: boolean; // remplissage (radar, densité)
  hole: number; // anneau
  pieText: PieText;
  horizontal: boolean; // boîtes, violons, histogrammes, nuages par catégorie

  // --- Statistiques & options spécifiques ---
  bins: number; // 0 = automatique
  histNorm: HistNorm;
  cumulative: boolean;
  kde: boolean; // courbe de densité superposée à l'histogramme
  bandwidth: number; // multiplicateur de la largeur de bande (KDE)
  boxPoints: BoxPoints;
  showMean: boolean;
  notched: boolean;
  trend: TrendKind;
  movingWindow: number;
  maxBubble: number;
  showTotal: boolean; // cascade
  target: number | null; // jauge / carte KPI
  gaugeMin: number | null;
  gaugeMax: number | null;
  gaugeBands: boolean;
  gaugeShape: "angular" | "bullet";
  triangle: boolean; // matrice de corrélation : moitié inférieure seulement
  contour: boolean; // densité 2D : contours (sinon carreaux)
  seriesRender: Record<string, SeriesRender>; // graphique combiné
  seriesAxis: Record<string, "y" | "y2">; // graphique combiné
  mapLevel: "auto" | MapLevel; // fond de carte (cartes géographiques)

  // --- Disposition ---
  height: number;
  span: 1 | 2; // largeur dans le tableau de bord (demi / pleine)
}

// Thème visuel résolu à partir des variables CSS de l'application (clair /
// sombre), ou forcé en clair pour les exports d'images.
export interface ChartTheme {
  dark: boolean;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

export const LIGHT_THEME: ChartTheme = {
  dark: false,
  text: "#1a1f2e",
  muted: "#6b7280",
  grid: "#e2e6ef",
  surface: "#ffffff",
};

// Réglages de mise en forme recopiés par « Appliquer ce style à tous les
// graphiques » (reproduire la mise en forme). Les réglages propres aux données
// ou au type (colonnes, couleurs par série, bornes d'axes…) ne sont pas copiés.
export const STYLE_KEYS = [
  "titleAlign",
  "palette",
  "colorscale",
  "reverseScale",
  "scaleFrom",
  "scaleTo",
  "opacity",
  "background",
  "bgColor",
  "fontFamily",
  "fontSize",
  "legend",
  "labels",
  "labelPosition",
  "decimals",
  "unit",
  "prefix",
  "suffix",
  "grid",
  "barGap",
  "cornerRadius",
  "lineShape",
  "lineWidth",
  "dash",
  "markers",
  "markerSize",
  "markerSymbol",
  "height",
] as const satisfies readonly (keyof ChartConfig)[];
