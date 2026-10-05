// Catalogue des types de graphiques : rôles des colonnes, options de mise en
// forme applicables, équivalent Python (plotly.express / seaborn /
// matplotlib) — plus la création d'un graphique avec des colonnes choisies
// automatiquement, le changement de type et les graphiques recommandés.

import type {
  Aggregation,
  ChartConfig,
  ChartType,
  ColumnInfo,
  ColumnKind,
  RoleKey,
} from "./types";
import { DEFAULT_COLORSCALE, DEFAULT_FONT, DEFAULT_PALETTE } from "./palettes";

export type Family =
  | "comparaison"
  | "evolution"
  | "composition"
  | "distribution"
  | "relation"
  | "flux"
  | "indicateur"
  | "carte";

export const FAMILIES: { id: Family; label: string }[] = [
  { id: "comparaison", label: "Comparaison" },
  { id: "evolution", label: "Évolution" },
  { id: "composition", label: "Répartition & hiérarchie" },
  { id: "distribution", label: "Distribution statistique" },
  { id: "relation", label: "Relations & corrélations" },
  { id: "flux", label: "Flux, polaire & 3D" },
  { id: "indicateur", label: "Indicateurs (KPI)" },
  { id: "carte", label: "Cartes géographiques" },
];

// Groupes d'options affichés dans le panneau « Format ».
export type Feature =
  | "axes"
  | "y2"
  | "legend"
  | "labels"
  | "labelPos"
  | "numbers"
  | "palette"
  | "varyColors"
  | "colorscale"
  | "opacity"
  | "barMode"
  | "barStyle"
  | "line"
  | "markers"
  | "fill"
  | "pie"
  | "hist"
  | "kde"
  | "box"
  | "horizontal"
  | "trend"
  | "bubble"
  | "waterfall"
  | "gauge"
  | "kpi"
  | "corr"
  | "contour"
  | "combo"
  | "sortTop"
  | "dateBucket"
  | "map";

export interface RoleSpec {
  key: RoleKey;
  label: string;
  hint?: string;
  accepts: ColumnKind[];
  required: boolean;
  multiple?: boolean;
  min?: number; // nombre minimal de colonnes (rôles multiples)
  max?: number;
}

export interface ChartTypeDef {
  id: ChartType;
  label: string;
  family: Family;
  description: string;
  python: string;
  roles: RoleSpec[];
  features: Feature[];
  aggs: Aggregation[]; // vide = pas d'agrégation
  defaults?: Partial<ChartConfig>;
  // Au moins un de ces ensembles de rôles doit être complet (ex. zone, ou
  // latitude et longitude).
  requireAny?: { label: string; sets: RoleKey[][] };
}

const ANY: ColumnKind[] = ["category", "date", "number"];
const NUM: ColumnKind[] = ["number"];
const CAT: ColumnKind[] = ["category", "date"];

const AGGS: Aggregation[] = ["sum", "mean", "median", "count", "distinct", "min", "max"];
const AGGS_RAW: Aggregation[] = [...AGGS, "none"];
const AGGS_ADD: Aggregation[] = ["sum", "count"];

const COMMON: Feature[] = ["numbers", "palette", "legend"];
const CARTESIAN: Feature[] = [...COMMON, "axes", "labels"];

const role = {
  categories: (label = "Axe X (catégories)"): RoleSpec => ({
    key: "x",
    label,
    accepts: ANY,
    required: true,
  }),
  values: (hint = "Vide = nombre de lignes. Plusieurs colonnes = plusieurs séries."): RoleSpec => ({
    key: "y",
    label: "Valeurs",
    hint,
    accepts: NUM,
    required: false,
    multiple: true,
  }),
  value: (required = false): RoleSpec => ({
    key: "y",
    label: "Valeur",
    hint: required ? undefined : "Vide = nombre de lignes",
    accepts: NUM,
    required,
    max: 1,
  }),
  legend: (label = "Légende (séries)", hint = "Une série par modalité de cette colonne"): RoleSpec => ({
    key: "group",
    label,
    hint,
    accepts: ANY,
    required: false,
    max: 1,
  }),
  numbers: (label = "Variable(s) numérique(s)"): RoleSpec => ({
    key: "y",
    label,
    accepts: NUM,
    required: true,
    multiple: true,
  }),
  num: (key: RoleKey, label: string, required = true): RoleSpec => ({
    key,
    label,
    accepts: NUM,
    required,
    max: 1,
  }),
};

export const CHART_TYPES: ChartTypeDef[] = [
  // ---------------------------------------------------------------- Comparaison
  {
    id: "column",
    label: "Histogramme groupé (colonnes)",
    family: "comparaison",
    description: "Compare des valeurs entre catégories avec des barres verticales — groupées, empilées ou empilées à 100 %.",
    python: "px.bar · sns.barplot · plt.bar",
    roles: [role.categories(), role.values(), role.legend()],
    features: [...CARTESIAN, "labelPos", "barMode", "barStyle", "varyColors", "opacity", "sortTop", "dateBucket"],
    aggs: AGGS,
  },
  {
    id: "bar",
    label: "Barres horizontales",
    family: "comparaison",
    description: "Barres horizontales : idéal pour de longs libellés ou un classement.",
    python: "px.bar(orientation='h') · sns.barplot · plt.barh",
    roles: [role.categories("Catégories (axe vertical)"), role.values(), role.legend()],
    features: [...CARTESIAN, "labelPos", "barMode", "barStyle", "varyColors", "opacity", "sortTop", "dateBucket"],
    aggs: AGGS,
  },
  {
    id: "lollipop",
    label: "Sucettes (lollipop)",
    family: "comparaison",
    description: "Variante allégée des barres : une tige et un point par catégorie.",
    python: "plt.stem · plt.hlines + plt.scatter",
    roles: [role.categories(), role.values(), role.legend()],
    features: [...CARTESIAN, "markers", "varyColors", "sortTop", "dateBucket"],
    aggs: AGGS,
    defaults: { markers: true, markerSize: 12 },
  },
  {
    id: "pareto",
    label: "Pareto",
    family: "comparaison",
    description: "Barres triées par ordre décroissant et courbe du cumul en % (règle des 80/20).",
    python: "plt.bar + ax.twinx().plot (cumul)",
    roles: [role.categories(), role.value()],
    features: [...CARTESIAN, "y2", "labelPos", "barStyle", "line", "markers", "opacity"],
    aggs: AGGS,
    defaults: { markers: true },
  },
  {
    id: "combo",
    label: "Combiné colonnes + courbe",
    family: "comparaison",
    description: "Chaque valeur en colonnes, courbe ou aire, sur l'axe principal ou secondaire (comme le graphique combiné d'Excel).",
    python: "plt.bar + ax.twinx().plot",
    roles: [
      role.categories(),
      { key: "y", label: "Valeurs", hint: "Choisissez au moins deux colonnes", accepts: NUM, required: true, multiple: true },
    ],
    features: [...CARTESIAN, "y2", "combo", "barStyle", "line", "markers", "opacity", "sortTop", "dateBucket"],
    aggs: AGGS,
    defaults: { markers: true },
  },
  // ------------------------------------------------------------------ Évolution
  {
    id: "line",
    label: "Courbes",
    family: "evolution",
    description: "Évolution d'une ou plusieurs valeurs dans le temps ou le long d'un axe ordonné.",
    python: "px.line · sns.lineplot · plt.plot",
    roles: [role.categories("Axe X (temps ou catégories)"), role.values(), role.legend()],
    features: [...CARTESIAN, "line", "markers", "dateBucket"],
    aggs: AGGS_RAW,
    defaults: { markers: true },
  },
  {
    id: "area",
    label: "Aires",
    family: "evolution",
    description: "Courbes remplies, superposées ou empilées (en valeur ou à 100 %).",
    python: "px.area · plt.fill_between · plt.stackplot",
    roles: [role.categories("Axe X (temps ou catégories)"), role.values(), role.legend()],
    features: [...CARTESIAN, "barMode", "line", "markers", "opacity", "dateBucket"],
    aggs: AGGS_RAW,
    defaults: { barMode: "stack", markers: false, opacity: 0.75 },
  },
  {
    id: "waterfall",
    label: "Cascade",
    family: "evolution",
    description: "Contributions positives et négatives successives jusqu'au total (pont budgétaire).",
    python: "go.Waterfall",
    roles: [role.categories("Étapes (axe X)"), role.value(true)],
    features: [...CARTESIAN, "labelPos", "waterfall", "barStyle", "dateBucket"],
    aggs: AGGS,
    defaults: { labels: true, sort: "none", showTotal: true },
  },
  {
    id: "candlestick",
    label: "Chandeliers (OHLC)",
    family: "evolution",
    description: "Ouverture, plus haut, plus bas et clôture par période (cours, prix, stocks).",
    python: "go.Candlestick · mplfinance.plot",
    roles: [
      { key: "x", label: "Date / période", accepts: ANY, required: true },
      role.num("open", "Ouverture"),
      role.num("high", "Plus haut"),
      role.num("low", "Plus bas"),
      role.num("close", "Clôture"),
    ],
    features: ["numbers", "palette", "axes", "legend", "dateBucket"],
    aggs: [],
    defaults: { legend: "hidden" },
  },
  {
    id: "gantt",
    label: "Diagramme de Gantt",
    family: "evolution",
    description: "Planning : une barre par tâche, de sa date de début à sa date de fin.",
    python: "px.timeline",
    roles: [
      { key: "x", label: "Tâche / activité", accepts: ANY, required: true },
      { key: "start", label: "Date de début", accepts: ["date"], required: true },
      { key: "end", label: "Date de fin", accepts: ["date"], required: true },
      role.legend("Couleur (catégorie)", "Ex. : responsable, statut, programme"),
    ],
    features: [...COMMON, "axes", "labels", "barStyle", "opacity"],
    aggs: [],
  },
  // --------------------------------------------------- Répartition & hiérarchie
  {
    id: "pie",
    label: "Secteurs (camembert)",
    family: "composition",
    description: "Part de chaque catégorie dans le total.",
    python: "px.pie · plt.pie",
    roles: [role.categories("Catégories"), role.value()],
    features: [...COMMON, "labels", "pie", "sortTop", "dateBucket"],
    aggs: AGGS,
    defaults: { labels: true, hole: 0, topN: 10, others: true },
  },
  {
    id: "donut",
    label: "Anneau (donut)",
    family: "composition",
    description: "Secteurs évidés : même lecture que le camembert, total lisible au centre.",
    python: "px.pie(hole=0.5)",
    roles: [role.categories("Catégories"), role.value()],
    features: [...COMMON, "labels", "pie", "sortTop", "dateBucket"],
    aggs: AGGS,
    defaults: { labels: true, hole: 0.55, topN: 10, others: true },
  },
  {
    id: "treemap",
    label: "Compartimentage (treemap)",
    family: "composition",
    description: "Rectangles imbriqués proportionnels aux valeurs, sur un ou plusieurs niveaux.",
    python: "px.treemap · squarify.plot",
    roles: [
      { key: "path", label: "Niveaux (du plus général au plus fin)", accepts: CAT, required: true, multiple: true, min: 1 },
      role.value(),
    ],
    features: [...COMMON, "labels", "colorscale"],
    aggs: AGGS_ADD,
    defaults: { labels: true, legend: "hidden" },
  },
  {
    id: "sunburst",
    label: "Rayons de soleil (sunburst)",
    family: "composition",
    description: "Hiérarchie en anneaux concentriques : du centre (niveau 1) vers l'extérieur.",
    python: "px.sunburst",
    roles: [
      { key: "path", label: "Niveaux (du centre vers l'extérieur)", accepts: CAT, required: true, multiple: true, min: 1 },
      role.value(),
    ],
    features: [...COMMON, "labels", "colorscale"],
    aggs: AGGS_ADD,
    defaults: { labels: true, legend: "hidden" },
  },
  {
    id: "icicle",
    label: "Stalactites (icicle)",
    family: "composition",
    description: "Hiérarchie en bandes empilées, lisible de gauche à droite.",
    python: "px.icicle",
    roles: [
      { key: "path", label: "Niveaux (du plus général au plus fin)", accepts: CAT, required: true, multiple: true, min: 1 },
      role.value(),
    ],
    features: [...COMMON, "labels", "colorscale"],
    aggs: AGGS_ADD,
    defaults: { labels: true, legend: "hidden" },
  },
  {
    id: "funnel",
    label: "Entonnoir",
    family: "composition",
    description: "Étapes successives d'un processus et taux de passage d'une étape à l'autre.",
    python: "px.funnel",
    roles: [role.categories("Étapes"), role.value()],
    features: [...COMMON, "labels", "varyColors", "opacity", "sortTop"],
    aggs: AGGS,
    defaults: { labels: true, sort: "value-desc", legend: "hidden" },
  },
  // -------------------------------------------------------------- Distribution
  {
    id: "histogram",
    label: "Histogramme de distribution",
    family: "distribution",
    description: "Répartition des valeurs d'une variable numérique par classes, avec courbe de densité optionnelle.",
    python: "px.histogram · sns.histplot · plt.hist",
    roles: [role.numbers(), role.legend("Couleur (sous-groupes)", "Un histogramme par modalité")],
    features: [...CARTESIAN, "hist", "kde", "barMode", "barStyle", "opacity", "horizontal"],
    aggs: [],
    defaults: { barMode: "overlay", opacity: 0.75, barGap: 0.05 },
  },
  {
    id: "box",
    label: "Boîte à moustaches",
    family: "distribution",
    description: "Médiane, quartiles, étendue et valeurs atypiques — par catégorie si besoin.",
    python: "px.box · sns.boxplot · plt.boxplot",
    roles: [
      role.numbers(),
      { key: "x", label: "Catégories (axe)", hint: "Une boîte par catégorie", accepts: ANY, required: false },
      role.legend("Couleur (sous-groupes)", "Boîtes côte à côte par modalité"),
    ],
    features: [...COMMON, "axes", "box", "horizontal", "opacity"],
    aggs: [],
  },
  {
    id: "violin",
    label: "Violon",
    family: "distribution",
    description: "Forme complète de la distribution (densité) avec la boîte à moustaches à l'intérieur.",
    python: "px.violin · sns.violinplot",
    roles: [
      role.numbers(),
      { key: "x", label: "Catégories (axe)", hint: "Un violon par catégorie", accepts: ANY, required: false },
      role.legend("Couleur (sous-groupes)", "Violons côte à côte par modalité"),
    ],
    features: [...COMMON, "axes", "box", "horizontal", "opacity"],
    aggs: [],
    defaults: { boxPoints: "outliers" },
  },
  {
    id: "density",
    label: "Courbe de densité (KDE)",
    family: "distribution",
    description: "Estimation lissée de la distribution (noyau gaussien), comparable entre groupes.",
    python: "sns.kdeplot · scipy.stats.gaussian_kde",
    roles: [role.numbers(), role.legend("Couleur (sous-groupes)", "Une courbe par modalité")],
    features: [...COMMON, "axes", "kde", "line", "fill", "opacity"],
    aggs: [],
    defaults: { fill: true, opacity: 0.35, lineShape: "spline" },
  },
  {
    id: "ecdf",
    label: "Fonction de répartition (ECDF)",
    family: "distribution",
    description: "Part cumulée des observations inférieures ou égales à chaque valeur.",
    python: "px.ecdf · sns.ecdfplot",
    roles: [role.numbers(), role.legend("Couleur (sous-groupes)", "Une courbe par modalité")],
    features: [...COMMON, "axes", "line"],
    aggs: [],
    defaults: { lineShape: "hv" },
  },
  {
    id: "strip",
    label: "Nuage par catégorie (strip)",
    family: "distribution",
    description: "Chaque observation en point, dispersée par catégorie : montre toutes les valeurs.",
    python: "px.strip · sns.stripplot",
    roles: [
      role.numbers(),
      { key: "x", label: "Catégories (axe)", accepts: ANY, required: false },
      role.legend("Couleur (sous-groupes)"),
    ],
    features: [...COMMON, "axes", "markers", "horizontal", "opacity"],
    aggs: [],
    defaults: { markerSize: 7, opacity: 0.7 },
  },
  // ----------------------------------------------------------------- Relations
  {
    id: "scatter",
    label: "Nuage de points",
    family: "relation",
    description: "Relation entre deux variables numériques, avec courbe de tendance (linéaire, polynomiale, exponentielle…).",
    python: "px.scatter · sns.scatterplot / regplot · plt.scatter",
    roles: [
      { key: "x", label: "Axe X", accepts: ["number", "date"], required: true },
      { key: "y", label: "Axe Y", hint: "Plusieurs colonnes = plusieurs séries", accepts: NUM, required: true, multiple: true },
      role.legend("Couleur", "Catégorie → une couleur par modalité ; nombre → dégradé"),
    ],
    features: [...CARTESIAN, "markers", "trend", "opacity", "colorscale"],
    aggs: [],
    defaults: { markerSize: 9, opacity: 0.8 },
  },
  {
    id: "bubble",
    label: "Bulles",
    family: "relation",
    description: "Nuage de points dont la taille des bulles représente une troisième variable.",
    python: "px.scatter(size=…) · plt.scatter(s=…)",
    roles: [
      { key: "x", label: "Axe X", accepts: ["number", "date"], required: true },
      role.num("y", "Axe Y"),
      role.num("size", "Taille des bulles"),
      role.legend("Couleur", "Catégorie → une couleur par modalité ; nombre → dégradé"),
    ],
    features: [...CARTESIAN, "bubble", "opacity", "colorscale"],
    aggs: [],
    defaults: { opacity: 0.7 },
  },
  {
    id: "heatmap",
    label: "Carte de chaleur",
    family: "relation",
    description: "Tableau croisé coloré : une case par couple (colonne, ligne), couleur selon la valeur.",
    python: "px.density_heatmap · sns.heatmap(pivot_table)",
    roles: [
      { key: "x", label: "Colonnes (axe X)", accepts: ANY, required: true },
      { key: "group", label: "Lignes (axe Y)", accepts: ANY, required: true, max: 1 },
      role.value(),
    ],
    features: ["numbers", "axes", "labels", "colorscale", "dateBucket"],
    aggs: AGGS,
  },
  {
    id: "correlation",
    label: "Matrice de corrélation",
    family: "relation",
    description: "Coefficients de Pearson entre toutes les paires de variables numériques.",
    python: "sns.heatmap(df.corr(), annot=True)",
    roles: [{ key: "dims", label: "Variables numériques", accepts: NUM, required: true, multiple: true, min: 2 }],
    features: ["labels", "colorscale", "corr"],
    aggs: [],
    defaults: { colorscale: "RdBu", labels: true, decimals: 2 },
  },
  {
    id: "density2d",
    label: "Densité 2D",
    family: "relation",
    description: "Concentration des points dans le plan, en contours ou en carreaux (utile pour beaucoup de points).",
    python: "px.density_contour · sns.kdeplot(x, y) · plt.hist2d",
    roles: [
      { key: "x", label: "Axe X", accepts: NUM, required: true },
      role.num("y", "Axe Y"),
    ],
    features: ["axes", "colorscale", "contour", "markers"],
    aggs: [],
    defaults: { colorscale: "Blues", contour: true, markers: false, markerSize: 4 },
  },
  {
    id: "splom",
    label: "Matrice de nuages (pairplot)",
    family: "relation",
    description: "Un nuage de points pour chaque paire de variables, d'un seul coup d'œil.",
    python: "px.scatter_matrix · sns.pairplot",
    roles: [
      { key: "dims", label: "Variables numériques (2 à 8)", accepts: NUM, required: true, multiple: true, min: 2, max: 8 },
      role.legend("Couleur"),
    ],
    features: [...COMMON, "markers", "opacity"],
    aggs: [],
    defaults: { markerSize: 5, opacity: 0.7 },
  },
  {
    id: "parallel",
    label: "Coordonnées parallèles",
    family: "relation",
    description: "Chaque ligne du tableau devient un trait traversant les axes des variables choisies.",
    python: "px.parallel_coordinates · pd.plotting.parallel_coordinates",
    roles: [
      { key: "dims", label: "Variables numériques", accepts: NUM, required: true, multiple: true, min: 2 },
      role.legend("Couleur", "Nombre → dégradé ; catégorie → un axe supplémentaire"),
    ],
    features: ["numbers", "colorscale"],
    aggs: [],
  },
  // ------------------------------------------------------ Flux, polaire & 3D
  {
    id: "sankey",
    label: "Diagramme de Sankey",
    family: "flux",
    description: "Flux entre catégories successives (source → destination), épaisseur proportionnelle aux volumes.",
    python: "go.Sankey",
    roles: [
      { key: "path", label: "Étapes du flux (source → cible…)", accepts: CAT, required: true, multiple: true, min: 2 },
      role.value(),
    ],
    features: ["numbers", "palette", "opacity"],
    aggs: AGGS_ADD,
    defaults: { opacity: 0.45 },
  },
  {
    id: "radar",
    label: "Radar (toile d'araignée)",
    family: "flux",
    description: "Compare plusieurs séries sur un ensemble d'axes disposés en cercle.",
    python: "px.line_polar · plt.subplot(polar=True)",
    roles: [role.categories("Axes du radar (catégories)"), role.values(), role.legend()],
    features: [...COMMON, "line", "markers", "fill", "opacity", "sortTop"],
    aggs: AGGS,
    defaults: { fill: true, opacity: 0.35, markers: true, sort: "none" },
  },
  {
    id: "polarBar",
    label: "Barres polaires (rose des vents)",
    family: "flux",
    description: "Barres disposées en cercle : directions, saisons, mois de l'année…",
    python: "px.bar_polar",
    roles: [role.categories("Secteurs (catégories)"), role.values(), role.legend()],
    features: [...COMMON, "varyColors", "opacity", "sortTop"],
    aggs: AGGS,
    defaults: { sort: "none" },
  },
  {
    id: "scatter3d",
    label: "Nuage de points 3D",
    family: "flux",
    description: "Trois variables numériques dans l'espace ; faites pivoter le graphique à la souris.",
    python: "px.scatter_3d · Axes3D.scatter",
    roles: [
      role.num("x", "Axe X"),
      role.num("y", "Axe Y"),
      role.num("z", "Axe Z"),
      role.legend("Couleur", "Catégorie → une couleur par modalité ; nombre → dégradé"),
      role.num("size", "Taille des points (optionnel)", false),
    ],
    features: [...COMMON, "markers", "opacity", "colorscale"],
    aggs: [],
    defaults: { markerSize: 5, opacity: 0.85 },
  },
  // ---------------------------------------------------------------- Indicateurs
  {
    id: "kpi",
    label: "Carte KPI",
    family: "indicateur",
    description: "Chiffre clé en grand (une carte par valeur), avec écart à un objectif.",
    python: "go.Indicator(mode='number+delta')",
    roles: [{ key: "y", label: "Valeur(s)", hint: "Vide = nombre de lignes", accepts: NUM, required: false, multiple: true, max: 6 }],
    features: ["numbers", "palette", "kpi"],
    aggs: AGGS,
    defaults: { height: 220 },
  },
  {
    id: "gauge",
    label: "Jauge",
    family: "indicateur",
    description: "Valeur positionnée entre un minimum et un maximum, avec objectif et zones colorées.",
    python: "go.Indicator(mode='gauge+number')",
    roles: [role.value()],
    features: ["numbers", "palette", "gauge"],
    aggs: AGGS,
    defaults: { height: 300 },
  },
  // -------------------------------------------------------------------- Cartes
  {
    id: "choropleth",
    label: "Carte choroplèthe",
    family: "carte",
    description:
      "Zones colorées selon la valeur : régions ou préfectures de Guinée, pays d'Afrique ou du monde (fonds de carte inclus, hors ligne).",
    python: "px.choropleth · geopandas.plot(column=…)",
    roles: [
      {
        key: "x",
        label: "Zone géographique",
        hint: "Noms ou codes de régions, préfectures ou pays (accents et « Région de… » tolérés)",
        accepts: ["category"],
        required: true,
      },
      role.value(),
    ],
    features: ["numbers", "labels", "colorscale", "map"],
    aggs: AGGS,
    defaults: { colorscale: "YlOrRd", height: 460, legend: "hidden" },
  },
  {
    id: "mapBubble",
    label: "Carte à bulles",
    family: "carte",
    description:
      "Une bulle par zone (au centre de la région, de la préfecture ou du pays) ou par point de coordonnées, de taille proportionnelle à la valeur.",
    python: "px.scatter_geo · px.scatter_map",
    roles: [
      {
        key: "x",
        label: "Zone géographique",
        hint: "Ou bien renseignez la latitude et la longitude",
        accepts: ["category"],
        required: false,
      },
      { key: "lat", label: "Latitude", accepts: NUM, required: false, max: 1 },
      { key: "lon", label: "Longitude", accepts: NUM, required: false, max: 1 },
      { ...role.value(), label: "Valeur (taille des bulles)" },
      role.legend("Couleur", "Catégorie → une couleur par modalité ; nombre → dégradé"),
    ],
    features: ["numbers", "labels", "palette", "legend", "colorscale", "bubble", "opacity", "map"],
    aggs: AGGS,
    defaults: { height: 460, opacity: 0.75, maxBubble: 45, legend: "top" },
    requireAny: { label: "Zone géographique, ou Latitude et Longitude", sets: [["x"], ["lat", "lon"]] },
  },
];

const BY_ID = new Map(CHART_TYPES.map((d) => [d.id, d]));

export function chartDef(type: ChartType): ChartTypeDef {
  return BY_ID.get(type) ?? CHART_TYPES[0];
}

export function hasFeature(type: ChartType, f: Feature): boolean {
  return chartDef(type).features.includes(f);
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

export const AGG_LABELS: Record<Aggregation, string> = {
  sum: "Somme",
  mean: "Moyenne",
  median: "Médiane",
  count: "Nombre",
  distinct: "Nombre distinct",
  min: "Minimum",
  max: "Maximum",
  none: "Aucun (valeurs brutes)",
};

// « de salaire », « d'âge »
export function deCol(col: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(col.trim()) ? `d'${col}` : `de ${col}`;
}

export function measureLabel(agg: Aggregation, col: string | null): string {
  if (!col) return "Nombre de lignes";
  if (agg === "none") return col;
  return `${AGG_LABELS[agg]} ${deCol(col)}`;
}

// Titre proposé quand l'utilisateur n'en saisit pas.
export function autoTitle(cfg: ChartConfig): string {
  const r = (k: RoleKey) => cfg.roles[k] ?? [];
  const x = r("x")[0];
  const ys = r("y");
  const group = r("group")[0];
  const join = (cols: string[]) =>
    cols.length <= 2 ? cols.join(" et ") : `${cols.slice(0, 2).join(", ")}…`;
  const measure = ys.length > 1 ? join(ys) : measureLabel(cfg.agg, ys[0] ?? null);
  switch (cfg.type) {
    case "histogram":
    case "box":
    case "violin":
    case "density":
    case "ecdf":
    case "strip":
      return ys.length ? `Distribution ${deCol(join(ys))}${x ? ` par ${x}` : ""}` : "Distribution";
    case "scatter":
    case "bubble":
    case "density2d":
      return ys.length && x ? `${join(ys)} selon ${x}` : "Nuage de points";
    case "scatter3d":
      return x && ys[0] && r("z")[0] ? `${x}, ${ys[0]} et ${r("z")[0]}` : "Nuage 3D";
    case "correlation":
      return "Matrice de corrélation";
    case "splom":
      return "Matrice de nuages de points";
    case "parallel":
      return "Coordonnées parallèles";
    case "treemap":
    case "sunburst":
    case "icicle":
      return r("path").length ? `${measure} par ${r("path").join(" › ")}` : measure;
    case "sankey":
      return r("path").length ? `Flux ${r("path").join(" → ")}` : "Flux";
    case "candlestick":
      return x ? `Cours par ${x}` : "Chandeliers";
    case "gantt":
      return "Planning";
    case "heatmap":
      return x && group ? `${measure} par ${x} et ${group}` : measure;
    case "kpi":
    case "gauge":
      return measure;
    default:
      return x ? `${measure} par ${x}${group && ys.length <= 1 ? ` et ${group}` : ""}` : measure;
  }
}

// ---------------------------------------------------------------------------
// Création, changement de type, recommandations
// ---------------------------------------------------------------------------

export function newChartId(): string {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function baseConfig(type: ChartType): ChartConfig {
  const def = chartDef(type);
  const cfg: ChartConfig = {
    id: newChartId(),
    type,
    roles: {},
    agg: def.aggs[0] ?? "sum",
    dateBucket: "none",
    sort: "auto",
    topN: 0,
    others: false,
    showTitle: true,
    title: "",
    titleAlign: "left",
    xTitle: null,
    yTitle: null,
    y2Title: null,
    palette: DEFAULT_PALETTE,
    colors: {},
    varyColors: false,
    colorscale: DEFAULT_COLORSCALE,
    reverseScale: false,
    scaleFrom: "#eff4ff",
    scaleTo: "#1d4ed8",
    opacity: 1,
    background: "transparent",
    bgColor: "#ffffff",
    fontFamily: DEFAULT_FONT,
    fontSize: 12,
    legend: "top",
    labels: false,
    labelPosition: "auto",
    decimals: -1,
    unit: "auto",
    prefix: "",
    suffix: "",
    grid: true,
    xAngle: null,
    yLog: false,
    yMin: null,
    yMax: null,
    barMode: "group",
    barGap: 0.2,
    cornerRadius: 3,
    lineShape: "linear",
    lineWidth: 2,
    dash: "solid",
    markers: false,
    markerSize: 8,
    markerSymbol: "circle",
    fill: false,
    hole: 0,
    pieText: "percent",
    horizontal: false,
    bins: 0,
    histNorm: "count",
    cumulative: false,
    kde: false,
    bandwidth: 1,
    boxPoints: "outliers",
    showMean: true,
    notched: false,
    trend: "none",
    movingWindow: 3,
    maxBubble: 40,
    showTotal: true,
    target: null,
    gaugeMin: null,
    gaugeMax: null,
    gaugeBands: true,
    gaugeShape: "angular",
    triangle: true,
    contour: true,
    seriesRender: {},
    seriesAxis: {},
    mapLevel: "auto",
    height: 380,
    span: 1,
  };
  return { ...cfg, ...def.defaults };
}

const ID_RE = /^(id|n°|no|num|numero|numéro|code|matricule|index|rang|#)$|(^id[_\s-])|([_\s-]id$)/i;

// Identifiant probable : nom typique (id, code, matricule…) ou colonne texte
// dont presque chaque valeur est unique (noms de personnes, libellés).
function looksLikeId(c: ColumnInfo): boolean {
  if (ID_RE.test(c.name.trim())) return true;
  return c.kind === "category" && c.count >= 5 && c.unique / c.count > 0.8;
}

interface PickOptions {
  prefer: ColumnKind[];
  maxUnique?: number;
  exclude: Set<string>;
  nameHint?: RegExp;
  preferGeo?: boolean; // colonnes dont les valeurs sont des lieux (cartes)
}

// Noms de colonnes typiques de certains rôles (Gantt, chandeliers).
const NAME_HINTS: Partial<Record<RoleKey, RegExp>> = {
  start: /d[ée]but|start|commencement|lancement|ouverture/i,
  end: /fin|end|[ée]ch[ée]ance|cl[ôo]ture|achèvement/i,
  open: /ouv|open|d[ée]but/i,
  high: /haut|high|max/i,
  low: /bas|low|min/i,
  close: /cl[ôo]t|close|ferm|fin/i,
  lat: /^lat|latitude/i,
  lon: /^lon|^lng|longitude/i,
};

// Colonnes candidates pour un rôle, les plus pertinentes d'abord : type
// préféré, colonnes clés suggérées par la détection de contexte, faible
// cardinalité pour les catégories, identifiants en dernier.
function rankColumns(
  columns: ColumnInfo[],
  spec: RoleSpec,
  suggested: string[],
  opts: PickOptions,
): ColumnInfo[] {
  const sugg = new Set(suggested);
  return columns
    .filter((c) => spec.accepts.includes(c.kind) && !opts.exclude.has(c.name))
    .map((c) => {
      let score = 0;
      const pref = opts.prefer.indexOf(c.kind);
      score += pref === -1 ? 0 : (opts.prefer.length - pref) * 100;
      if (sugg.has(c.name)) score += 40;
      if (opts.nameHint?.test(c.name)) score += 60;
      if (opts.preferGeo && c.geo) score += 250;
      if (looksLikeId(c)) score -= c.kind === "number" || ID_RE.test(c.name.trim()) ? 300 : 120;
      if (c.kind !== "number" || spec.accepts.length > 1) {
        if (opts.maxUnique !== undefined) {
          if (c.unique > opts.maxUnique) score -= 150;
          else if (c.unique >= 2 && c.unique <= 12) score += 30;
          else if (c.unique >= 2) score += 10;
        }
      }
      if (c.unique <= 1) score -= 200;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.c);
}

function preferFor(type: ChartType, key: RoleKey): { prefer: ColumnKind[]; maxUnique?: number } {
  if (key === "x") {
    if (type === "line" || type === "area" || type === "candlestick")
      return { prefer: ["date", "number", "category"], maxUnique: 400 };
    if (type === "scatter" || type === "bubble" || type === "density2d" || type === "scatter3d")
      return { prefer: ["number", "date"] };
    if (type === "box" || type === "violin" || type === "strip")
      return { prefer: ["category"], maxUnique: 12 };
    if (type === "gantt") return { prefer: ["category"], maxUnique: 200 };
    if (type === "heatmap") return { prefer: ["category", "date"], maxUnique: 40 };
    return { prefer: ["category", "date", "number"], maxUnique: 30 };
  }
  if (key === "group") {
    if (type === "heatmap") return { prefer: ["category", "date"], maxUnique: 40 };
    return { prefer: ["category"], maxUnique: 10 };
  }
  if (key === "path") return { prefer: ["category"], maxUnique: 30 };
  if (key === "start" || key === "end") return { prefer: ["date"] };
  return { prefer: ["number"] };
}

function columnOk(columns: Map<string, ColumnInfo>, spec: RoleSpec, name: string): boolean {
  const c = columns.get(name);
  return Boolean(c && spec.accepts.includes(c.kind));
}

// Complète les rôles obligatoires manquants (et la valeur des graphiques
// agrégés, pour ne pas montrer un simple comptage quand un nombre existe).
export function autofillRoles(
  type: ChartType,
  roles: ChartConfig["roles"],
  columns: ColumnInfo[],
  suggested: string[] = [],
  fillValue = true, // false : laisse la valeur vide (comptage des lignes)
): ChartConfig["roles"] {
  const def = chartDef(type);
  const byName = new Map(columns.map((c) => [c.name, c]));
  const out: ChartConfig["roles"] = {};
  const used = new Set<string>();

  // 1. Garde ce qui est compatible.
  for (const spec of def.roles) {
    const kept = (roles[spec.key] ?? []).filter(
      (n) => columnOk(byName, spec, n) && !used.has(n),
    );
    const max = spec.multiple ? (spec.max ?? Infinity) : 1;
    const v = kept.slice(0, max);
    v.forEach((n) => used.add(n));
    if (v.length) out[spec.key] = v;
  }

  // 2. Remplit les rôles obligatoires (et la valeur des graphiques agrégés).
  for (const spec of def.roles) {
    const current = out[spec.key] ?? [];
    const min = spec.multiple ? Math.max(spec.min ?? 1, 1) : 1;
    const wantsValue = fillValue && spec.key === "y" && def.aggs.length > 0 && type !== "kpi";
    // Nombre visé : le minimum, deux séries pour un graphique combiné, et
    // jusqu'à six variables pour une matrice partie de zéro.
    let desired = min;
    if (type === "combo" && spec.key === "y") desired = Math.max(desired, 2);
    if (spec.key === "dims" && current.length === 0) desired = Math.max(desired, Math.min(spec.max ?? 6, 6));
    if (current.length >= desired) continue;
    if (!spec.required && !(wantsValue && current.length === 0)) continue;
    const { prefer, maxUnique } = preferFor(type, spec.key);
    const ranked = rankColumns(columns, spec, suggested, {
      prefer,
      maxUnique,
      exclude: used,
      nameHint: NAME_HINTS[spec.key],
      preferGeo: spec.key === "x" && chartDef(type).family === "carte",
    });
    const picked = ranked.slice(0, desired - current.length);
    // Une valeur facultative n'est ajoutée que si elle est réellement
    // numérique et pas un identifiant.
    const filtered = spec.required ? picked : picked.filter((c) => !looksLikeId(c));
    if (filtered.length === 0) continue;
    filtered.forEach((c) => used.add(c.name));
    out[spec.key] = [...current, ...filtered.map((c) => c.name)];
  }

  // Carte à bulles : une colonne de lieux, à défaut des coordonnées.
  if (type === "mapBubble" && !out.x?.length && !(out.lat?.length && out.lon?.length)) {
    const place = columns.find((c) => c.geo && !used.has(c.name));
    const lat = columns.find((c) => c.kind === "number" && NAME_HINTS.lat!.test(c.name));
    const lon = columns.find((c) => c.kind === "number" && NAME_HINTS.lon!.test(c.name));
    if (place) out.x = [place.name];
    else if (lat && lon) {
      out.lat = [lat.name];
      out.lon = [lon.name];
    }
  }
  return out;
}

export function createChart(
  type: ChartType,
  columns: ColumnInfo[],
  suggested: string[] = [],
  roles: ChartConfig["roles"] = {},
  overrides: Partial<ChartConfig> = {},
  fillValue = true,
): ChartConfig {
  const cfg = { ...baseConfig(type), ...overrides };
  cfg.roles = autofillRoles(type, roles, columns, suggested, fillValue);
  // Beaucoup de dates distinctes : regroupement mensuel par défaut.
  const x = cfg.roles.x?.[0];
  const xInfo = columns.find((c) => c.name === x);
  if (xInfo?.kind === "date" && xInfo.unique > 36 && hasFeature(type, "dateBucket")) {
    cfg.dateBucket = "month";
  }
  return cfg;
}

// Change le type d'un graphique en conservant tout ce qui peut l'être :
// colonnes compatibles (avec passerelles entre rôles proches), mise en forme
// et couleurs choisies.
export function changeChartType(
  cfg: ChartConfig,
  type: ChartType,
  columns: ColumnInfo[],
  suggested: string[] = [],
): ChartConfig {
  if (cfg.type === type) return cfg;
  const def = chartDef(type);
  const old = cfg.roles;
  const byName = new Map(columns.map((c) => [c.name, c]));
  const isNum = (n: string) => byName.get(n)?.kind === "number";
  const keys = new Set(def.roles.map((r) => r.key));
  const roles: ChartConfig["roles"] = { ...old };

  if (keys.has("dims") && !old.dims?.length) {
    roles.dims = [...(old.y ?? []), ...(old.x ?? []), ...(old.size ?? []), ...(old.z ?? [])].filter(isNum);
  }
  if (keys.has("y") && !old.y?.length && old.dims?.length) {
    roles.y = old.dims.filter((n) => n !== old.x?.[0]);
  }
  if (keys.has("path") && !old.path?.length) {
    roles.path = [...(old.x ?? []), ...(old.group ?? [])];
  }
  if (keys.has("x") && !old.x?.length && old.path?.length) {
    roles.x = [old.path[0]];
    if (keys.has("group") && !old.group?.length && old.path[1]) roles.group = [old.path[1]];
  }
  // Pour les nuages, l'axe X numérique peut venir de la 1re valeur.
  if ((type === "scatter" || type === "bubble" || type === "density2d" || type === "scatter3d") && old.x?.[0] && !isNum(old.x[0]) && byName.get(old.x[0])?.kind !== "date") {
    const ys = old.y ?? old.dims ?? [];
    roles.x = ys.slice(0, 1);
    roles.y = ys.slice(1);
  }
  if (type === "scatter3d" && !old.z?.length) {
    const ys = roles.y ?? [];
    if (ys.length > 1) roles.z = [ys[1]];
  }
  // Un nombre continu (montants…) ne fait pas un bon axe de catégories : il
  // donnerait une barre par valeur. On laisse le remplissage automatique
  // choisir une vraie colonne de catégories.
  const xInfo = roles.x?.[0] ? byName.get(roles.x[0]) : undefined;
  const discrete = def.aggs.length > 0 && type !== "line" && type !== "area";
  if (discrete && xInfo?.kind === "number" && xInfo.unique > 50) delete roles.x;

  const next: ChartConfig = {
    ...cfg,
    ...(def.defaults ?? {}),
    type,
    roles: autofillRoles(type, roles, columns, suggested),
    agg: def.aggs.includes(cfg.agg) ? cfg.agg : (def.aggs[0] ?? "sum"),
  };
  if (!hasFeature(type, "dateBucket")) next.dateBucket = "none";
  else {
    // Beaucoup de dates distinctes : regroupement mensuel, comme à la création.
    const x = next.roles.x?.[0] ? byName.get(next.roles.x[0]) : undefined;
    if (x?.kind === "date" && x.unique > 36 && next.dateBucket === "none") next.dateBucket = "month";
  }
  return next;
}

// Graphiques recommandés (comme « Graphiques recommandés » d'Excel) selon les
// types de colonnes disponibles.
export function recommendCharts(columns: ColumnInfo[], suggested: string[] = []): ChartConfig[] {
  const usable = columns.filter((c) => c.unique > 1);
  const nums = usable.filter((c) => c.kind === "number" && !looksLikeId(c));
  const dates = usable.filter((c) => c.kind === "date");
  const cats = usable.filter((c) => c.kind === "category" && c.unique <= 30 && !looksLikeId(c));
  const smallCats = cats.filter((c) => c.unique <= 8);
  const out: ChartConfig[] = [];
  const add = (type: ChartType, roles: ChartConfig["roles"], overrides: Partial<ChartConfig> = {}) => {
    if (out.length < 4) out.push(createChart(type, columns, suggested, roles, overrides));
  };

  if (dates.length && nums.length) add("line", { x: [dates[0].name], y: [nums[0].name] });
  const place = usable.find((c) => c.geo);
  if (place) add("choropleth", { x: [place.name], y: nums.length ? [nums[0].name] : [] });
  if (cats.length && nums.length) add("column", { x: [cats[0].name], y: [nums[0].name] }, { sort: "value-desc" });
  if (smallCats.length) add("donut", { x: [smallCats[0].name] });
  if (nums.length >= 2) add("scatter", { x: [nums[0].name], y: [nums[1].name] }, { trend: "linear" });
  if (nums.length >= 3) add("correlation", { dims: nums.slice(0, 8).map((c) => c.name) });
  if (nums.length) add("histogram", { y: [nums[0].name] }, { kde: true });
  if (nums.length && cats.length) add("box", { y: [nums[0].name], x: [cats[0].name] });
  if (cats.length >= 2) add("heatmap", { x: [cats[0].name], group: [cats[1].name] });
  if (out.length === 0 && cats.length) add("column", { x: [cats[0].name] });
  return out;
}
