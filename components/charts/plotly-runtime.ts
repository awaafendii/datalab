// Chargement modulaire de Plotly.
//
// Le bundle complet de Plotly pèse ~4,6 Mo. On charge à la place le cœur
// (`plotly.js/lib/core`, sans aucune trace) puis, à la demande, uniquement
// les types de traces utilisés par les graphiques affichés : un histogramme
// en colonnes ne télécharge pas le moteur 3D (WebGL) ni celui des cartes.
// Chaque module est un fragment séparé, mis en cache par le navigateur.

import type { Data, PlotlyModule } from "plotly.js";
import { PLOTLY_LOCALE_FR } from "@/lib/charts/locale-fr";

export type PlotlyLib = typeof import("plotly.js/lib/core").default;

type Loader = () => Promise<unknown>;

// Une entrée par type de trace produit par lib/charts/build.ts.
const TRACE_MODULES: Record<string, Loader> = {
  scatter: () => import(/* webpackChunkName: "plotly-scatter" */ "plotly.js/lib/scatter"),
  bar: () => import(/* webpackChunkName: "plotly-bar" */ "plotly.js/lib/bar"),
  pie: () => import(/* webpackChunkName: "plotly-pie" */ "plotly.js/lib/pie"),
  histogram: () => import(/* webpackChunkName: "plotly-histogram" */ "plotly.js/lib/histogram"),
  histogram2d: () => import(/* webpackChunkName: "plotly-histogram2d" */ "plotly.js/lib/histogram2d"),
  histogram2dcontour: () =>
    import(/* webpackChunkName: "plotly-histogram2dcontour" */ "plotly.js/lib/histogram2dcontour"),
  box: () => import(/* webpackChunkName: "plotly-box" */ "plotly.js/lib/box"),
  violin: () => import(/* webpackChunkName: "plotly-violin" */ "plotly.js/lib/violin"),
  heatmap: () => import(/* webpackChunkName: "plotly-heatmap" */ "plotly.js/lib/heatmap"),
  waterfall: () => import(/* webpackChunkName: "plotly-waterfall" */ "plotly.js/lib/waterfall"),
  funnel: () => import(/* webpackChunkName: "plotly-funnel" */ "plotly.js/lib/funnel"),
  candlestick: () => import(/* webpackChunkName: "plotly-candlestick" */ "plotly.js/lib/candlestick"),
  treemap: () => import(/* webpackChunkName: "plotly-treemap" */ "plotly.js/lib/treemap"),
  sunburst: () => import(/* webpackChunkName: "plotly-sunburst" */ "plotly.js/lib/sunburst"),
  icicle: () => import(/* webpackChunkName: "plotly-icicle" */ "plotly.js/lib/icicle"),
  sankey: () => import(/* webpackChunkName: "plotly-sankey" */ "plotly.js/lib/sankey"),
  scatterpolar: () => import(/* webpackChunkName: "plotly-scatterpolar" */ "plotly.js/lib/scatterpolar"),
  barpolar: () => import(/* webpackChunkName: "plotly-barpolar" */ "plotly.js/lib/barpolar"),
  indicator: () => import(/* webpackChunkName: "plotly-indicator" */ "plotly.js/lib/indicator"),
  // WebGL : nuages de nombreux points, matrices, coordonnées parallèles, 3D.
  scattergl: () => import(/* webpackChunkName: "plotly-scattergl" */ "plotly.js/lib/scattergl"),
  splom: () => import(/* webpackChunkName: "plotly-splom" */ "plotly.js/lib/splom"),
  parcoords: () => import(/* webpackChunkName: "plotly-parcoords" */ "plotly.js/lib/parcoords"),
  scatter3d: () => import(/* webpackChunkName: "plotly-scatter3d" */ "plotly.js/lib/scatter3d"),
  // Cartes
  choropleth: () => import(/* webpackChunkName: "plotly-choropleth" */ "plotly.js/lib/choropleth"),
  scattergeo: () => import(/* webpackChunkName: "plotly-scattergeo" */ "plotly.js/lib/scattergeo"),
};

let core: Promise<PlotlyLib> | null = null;
const registered = new Map<string, Promise<void>>();

// Les modules CommonJS arrivent selon l'outil sous `.default` ou tels quels.
function unwrap<T>(mod: unknown): T {
  return ((mod as { default?: T }).default ?? mod) as T;
}

export function loadPlotlyCore(): Promise<PlotlyLib> {
  if (!core) {
    core = import(/* webpackChunkName: "plotly-core" */ "plotly.js/lib/core")
      .then((mod) => {
        const P = unwrap<PlotlyLib>(mod);
        try {
          P.register(PLOTLY_LOCALE_FR as PlotlyModule);
        } catch {
          // déjà enregistrée (rechargement à chaud en développement)
        }
        return P;
      })
      .catch((e) => {
        core = null;
        throw e;
      });
  }
  return core;
}

function ensureTrace(P: PlotlyLib, type: string): Promise<void> {
  const load = TRACE_MODULES[type];
  if (!load) return Promise.resolve();
  let p = registered.get(type);
  if (!p) {
    p = load()
      .then((mod) => P.register(unwrap<PlotlyModule>(mod)))
      .catch((e) => {
        registered.delete(type);
        throw e;
      });
    registered.set(type, p);
  }
  return p;
}

// Types de traces d'une figure (scatter par défaut, comme Plotly).
export function traceTypes(data: Data[]): string[] {
  return Array.from(new Set(data.map((d) => (d.type as string | undefined) ?? "scatter")));
}

// Cœur + modules nécessaires à ces types de traces.
export async function loadPlotly(types: Iterable<string> = []): Promise<PlotlyLib> {
  const P = await loadPlotlyCore();
  // Le cœur n'embarque aucune trace : « scatter » sert aussi d'étiquettes
  // texte (cartes, KDE…), on l'enregistre toujours.
  await Promise.all(["scatter", ...types].map((t) => ensureTrace(P, t)));
  return P;
}

// Préchargement discret, quand le navigateur est inactif : le premier
// graphique s'affiche alors sans attendre le téléchargement.
export function preloadPlotly(types: Iterable<string> = []): void {
  if (typeof window === "undefined") return;
  const list = Array.from(types);
  const run = () => {
    loadPlotly(list).catch(() => {
      // l'affichage réessaiera et signalera l'erreur le cas échéant
    });
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else window.setTimeout(run, 1200);
}
