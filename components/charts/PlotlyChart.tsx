"use client";

import { useEffect, useRef, useState } from "react";
import type { Config, Data, Layout } from "plotly.js";
import { LIGHT_THEME, type ChartTheme } from "@/lib/charts/types";
import { loadPlotly, loadPlotlyCore, traceTypes, type PlotlyLib } from "./plotly-runtime";

export const PLOT_CONFIG: Partial<Config> = {
  locale: "fr",
  displaylogo: false,
  // Les exports passent par nos propres boutons (thème clair, fond opaque).
  modeBarButtonsToRemove: ["toImage", "lasso2d", "select2d"],
  // Fonds de carte servis par l'application (public/topojson) : aucun appel
  // au CDN de Plotly, les cartes fonctionnent hors ligne.
  topojsonURL: "/topojson/",
};

// Couleurs du thème courant, lues sur les variables CSS de l'application et
// mises à jour quand le système bascule entre clair et sombre.
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(LIGHT_THEME);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
      setTheme({
        dark: mq.matches,
        text: v("--text", LIGHT_THEME.text),
        muted: v("--muted", LIGHT_THEME.muted),
        grid: v("--border", LIGHT_THEME.grid),
        surface: v("--surface", LIGHT_THEME.surface),
      });
    };
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return theme;
}

type GraphDiv = HTMLDivElement & {
  layout?: { meta?: { legend?: string } };
  _fullLayout?: { _size?: { t: number; b: number } };
};

// Plotly n'empile pas un titre et une légende horizontale : une légende sur
// plusieurs lignes peut recouvrir le titre (en haut) ou les libellés de l'axe
// X (en bas). On mesure après rendu et on agrandit la marge d'autant.
async function fitLegend(P: PlotlyLib, el: GraphDiv): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const pos = el.layout?.meta?.legend;
    const size = el._fullLayout?._size;
    const legend = el.querySelector(".legend");
    if (!size || !legend || (pos !== "top" && pos !== "bottom")) return;
    const lb = legend.getBoundingClientRect();
    if (lb.height === 0) return;
    let update: Record<string, number> | null = null;
    if (pos === "top") {
      const title = el.querySelector(".gtitle");
      if (!title) return;
      const overlap = title.getBoundingClientRect().bottom + 6 - lb.top;
      if (overlap > 1) update = { "margin.t": Math.ceil(size.t + overlap) };
    } else {
      let bottom = -Infinity;
      el.querySelectorAll(".xaxislayer-above text, .g-xtitle text").forEach((n) => {
        bottom = Math.max(bottom, n.getBoundingClientRect().bottom);
      });
      if (!Number.isFinite(bottom)) return;
      const overlap = bottom + 6 - lb.top;
      if (overlap > 1) update = { "margin.b": Math.ceil(size.b + overlap) };
    }
    if (!update) return;
    // Clé pointée (« margin.t ») : ne modifie que ce côté de la marge.
    await P.relayout(el, update as unknown as Partial<Layout>);
  }
}

export type ImageFormat = "png" | "svg" | "jpeg";

type Figure = { data: Data[]; layout: Partial<Layout> };

// Rend une figure dans un conteneur hors écran à la largeur demandée (la
// légende y est ajustée comme à l'écran), exécute `use`, puis nettoie.
async function withOffscreenPlot<T>(
  figure: Figure,
  width: number,
  use: (P: PlotlyLib, el: GraphDiv) => Promise<T>,
): Promise<T> {
  const P = await loadPlotly(traceTypes(figure.data));
  const host = document.createElement("div") as GraphDiv;
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;`;
  document.body.appendChild(host);
  try {
    const layout = { ...JSON.parse(JSON.stringify(figure.layout)), width };
    await P.newPlot(host, figure.data, layout, { ...PLOT_CONFIG, staticPlot: true });
    await fitLegend(P, host);
    return await use(P, host);
  } finally {
    P.purge(host);
    host.remove();
  }
}

export async function downloadFigure(
  figure: Figure,
  format: ImageFormat,
  filename: string,
  width: number,
): Promise<void> {
  await withOffscreenPlot(figure, width, (P, el) =>
    P.downloadImage(el, {
      format,
      filename,
      width,
      height: figure.layout.height ?? 400,
      scale: format === "svg" ? 1 : 2,
    } as Parameters<PlotlyLib["downloadImage"]>[1]),
  );
}

// Image PNG (data URL) d'une figure, pour l'insérer dans un rapport PDF ou
// Word. `scale` 2 : rendu net à l'impression.
export async function figureToPng(
  figure: Figure,
  width: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const height = figure.layout.height ?? 400;
  const dataUrl = await withOffscreenPlot(figure, width, (P, el) =>
    P.toImage(el, { format: "png", width, height, scale: 2 } as Parameters<PlotlyLib["toImage"]>[1]),
  );
  return { dataUrl, width, height };
}

interface Props {
  data: Data[];
  layout: Partial<Layout>;
}

export default function PlotlyChart({ data, layout }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const signatureRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlotly(traceTypes(data)).then(
      async (P) => {
        const el = ref.current;
        if (cancelled || !el) return;
        try {
          // Plotly écrit dans l'objet layout reçu (plages calculées…) : on lui
          // passe une copie pour garder la figure d'origine intacte.
          const copy = JSON.parse(JSON.stringify(layout));
          // Plotly.react met à jour le graphique existant, mais échoue en
          // passant d'une famille de traces à une autre (ex. densité 2D →
          // matrice de nuages) : dans ce cas on redessine depuis zéro.
          const signature = data.map((d) => d.type ?? "scatter").join(",");
          if (signatureRef.current !== null && signatureRef.current !== signature) {
            P.purge(el);
            await P.newPlot(el, data, copy, PLOT_CONFIG);
          } else {
            await P.react(el, data, copy, PLOT_CONFIG);
          }
          signatureRef.current = signature;
          if (!cancelled) await fitLegend(P, el as GraphDiv);
          if (!cancelled) {
            setReady(true);
            setError(null);
          }
        } catch (e) {
          // Graphique dans un état incertain : le prochain rendu repart de zéro.
          signatureRef.current = "";
          if (!cancelled) setError(`Affichage impossible : ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      () => {
        if (!cancelled) {
          setError("Le moteur de graphiques n'a pas pu être chargé (connexion interrompue ?). Rechargez la page.");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data, layout]);

  // Suit la largeur du conteneur (panneau latéral, grille du tableau de bord).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        loadPlotlyCore()
          .then(async (P) => {
            const gd = el as GraphDiv;
            // Pas de redimensionnement d'un graphique resté en erreur.
            if (!el.isConnected || !gd._fullLayout || signatureRef.current === "") return;
            await P.Plots.resize(el);
            // La légende peut changer de nombre de lignes avec la largeur.
            await fitLegend(P, gd);
          })
          .catch(() => {});
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      loadPlotlyCore()
        .then((P) => P.purge(el))
        .catch(() => {});
    };
  }, []);

  return (
    <div className="cb-plot-wrap" style={{ minHeight: layout.height }}>
      {!ready && !error && <div className="cb-plot-status">Chargement du graphique…</div>}
      {error && <div className="error-box">{error}</div>}
      <div ref={ref} className="cb-plot" />
    </div>
  );
}
