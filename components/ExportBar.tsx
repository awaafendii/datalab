"use client";

import { useState } from "react";
import { FileText, FileSpreadsheet, FileType2 } from "lucide-react";
import type { Data, Layout } from "plotly.js";
import type {
  Analysis,
  ChartImage,
  Dataset,
  KMeansResult,
  ManualLogEntry,
  RegressionResult,
} from "@/lib/types";
import type { ChartConfig } from "@/lib/charts/types";
import { LIGHT_THEME } from "@/lib/charts/types";
import { autoTitle, chartDef } from "@/lib/charts/catalog";
import { buildFigure } from "@/lib/charts/build";
import { columnInfos } from "@/lib/charts/data";
import { autoClusterAndRegression } from "@/lib/ml";
import type { ExcelChartInput } from "@/lib/export-xlsx";
import type { KpiDef } from "@/lib/kpi/kpi";
import type { PivotConfig } from "@/lib/pivot/types";

export interface ExportSheetInput {
  name: string;
  dataset: Dataset;
  analysis: Analysis;
  charts: ChartConfig[]; // graphiques personnalisés de la feuille
  manualLog: ManualLogEntry[]; // décisions manuelles de nettoyage
  kpis: KpiDef[]; // indicateurs clés (tels que configurés à l'écran)
  pivot: PivotConfig; // tableau croisé dynamique (tel que configuré à l'écran)
}

interface Props {
  fileName: string;
  sheets: ExportSheetInput[];
}

type Kind = "xlsx" | "pdf" | "docx";

// Largeur de rendu des images (px CSS) : nette sur une page A4, rendue en
// double résolution par Plotly.
const IMAGE_WIDTH = 1000;

function dataUrlBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ML_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

// Figure Plotly du clustering : nuage de points sur les deux premières
// variables, une couleur par groupe.
function clusterFigure(km: KMeansResult): { data: Data[]; layout: Partial<Layout> } {
  const [cx, cy] = km.columns;
  const byCluster = new Map<number, { x: number[]; y: number[] }>();
  for (const p of km.points) {
    const g = byCluster.get(p.cluster) ?? byCluster.set(p.cluster, { x: [], y: [] }).get(p.cluster)!;
    g.x.push(p.values[cx]);
    g.y.push(p.values[cy]);
  }
  const data = [...byCluster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([c, g]) =>
        ({
          type: "scatter",
          mode: "markers",
          name: `Groupe ${c + 1}`,
          x: g.x,
          y: g.y,
          marker: { color: ML_COLORS[c % ML_COLORS.length], size: 7 },
        }) as Data,
    );
  const layout: Partial<Layout> = {
    title: { text: `Clustering k-means — ${cx} × ${cy}` },
    height: 440,
    margin: { t: 50, r: 20, b: 50, l: 60 },
    xaxis: { title: { text: cx } },
    yaxis: { title: { text: cy } },
    legend: { orientation: "h" },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
  };
  return { data, layout };
}

// Figure Plotly de la régression : observé vs prédit, avec la droite y = x.
function regressionFigure(reg: RegressionResult): { data: Data[]; layout: Partial<Layout> } {
  const xs = reg.points.map((p) => p.actual);
  const ys = reg.points.map((p) => p.predicted);
  const min = Math.min(...xs, ...ys);
  const max = Math.max(...xs, ...ys);
  const data: Data[] = [
    { type: "scatter", mode: "markers", name: "Observations", x: xs, y: ys, marker: { color: "#2563eb", size: 7 } } as Data,
    { type: "scatter", mode: "lines", name: "y = x", x: [min, max], y: [min, max], line: { color: "#dc2626", dash: "dash" } } as Data,
  ];
  const layout: Partial<Layout> = {
    title: { text: `Régression — observé vs prédit (${reg.target})` },
    height: 440,
    margin: { t: 50, r: 20, b: 50, l: 60 },
    xaxis: { title: { text: "Observé" } },
    yaxis: { title: { text: "Prédit" } },
    legend: { orientation: "h" },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
  };
  return { data, layout };
}

export default function ExportBar({ fileName, sheets }: Props) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withCharts, setWithCharts] = useState(true);
  const multi = sheets.length > 1;
  const chartCount = sheets.reduce((n, s) => n + s.charts.length, 0);

  // Images PNG des graphiques personnalisés, feuille par feuille (thème clair,
  // fond blanc, comme les exports d'images du créateur).
  const renderCharts = async (): Promise<ChartImage[][]> => {
    const { figureToPng } = await import("@/components/charts/PlotlyChart");
    const out: ChartImage[][] = [];
    let done = 0;
    for (const s of sheets) {
      const columns = columnInfos(s.analysis.profile);
      const images: ChartImage[] = [];
      for (const cfg of s.charts) {
        done++;
        setProgress(`Préparation des graphiques (${done}/${chartCount})…`);
        const fig = buildFigure(cfg, { dataset: s.dataset, columns, theme: LIGHT_THEME, exporting: true });
        if (fig.empty) continue;
        const img = await figureToPng(fig, IMAGE_WIDTH);
        images.push({ title: cfg.title.trim() || autoTitle(cfg), ...img });
      }
      out.push(images);
    }
    return out;
  };

  // Graphiques pour Excel : tableau des données tracées + graphique Excel
  // natif quand le type existe dans Excel, image PNG sinon.
  const excelCharts = async (): Promise<ExcelChartInput[][]> => {
    const out: ExcelChartInput[][] = [];
    let done = 0;
    for (const s of sheets) {
      const columns = columnInfos(s.analysis.profile);
      const items: ExcelChartInput[] = [];
      for (const cfg of s.charts) {
        done++;
        setProgress(`Préparation des graphiques (${done}/${chartCount})…`);
        const fig = buildFigure(cfg, { dataset: s.dataset, columns, theme: LIGHT_THEME, exporting: true });
        if (fig.empty || !fig.excel) continue;
        const item: ExcelChartInput = {
          title: cfg.title.trim() || autoTitle(cfg),
          typeLabel: chartDef(cfg.type).label,
          excel: fig.excel,
          height: cfg.height,
        };
        if (!fig.excel.native) {
          const { figureToPng } = await import("@/components/charts/PlotlyChart");
          const img = await figureToPng(fig, IMAGE_WIDTH);
          item.image = dataUrlBytes(img.dataUrl);
          item.imageWidth = img.width;
          item.imageHeight = img.height;
        }
        items.push(item);
      }
      out.push(items);
    }
    return out;
  };

  const run = async (kind: Kind) => {
    setError(null);
    setBusy(kind);
    try {
      // Clustering (k-means) et régression calculés pour l'export, par feuille.
      setProgress("Calcul du clustering et de la régression…");
      const ml = sheets.map((s) => autoClusterAndRegression(s.dataset, s.analysis.profile));

      // Graphiques ML (nuage des groupes, observé/prédit) en images PNG.
      setProgress("Préparation des graphiques d'analyse…");
      const { figureToPng } = await import("@/components/charts/PlotlyChart");
      const mlImgs: { cluster?: ChartImage; regression?: ChartImage }[] = [];
      for (let i = 0; i < sheets.length; i++) {
        const o: { cluster?: ChartImage; regression?: ChartImage } = {};
        const km = ml[i].kmeans;
        if (km && km.columns.length >= 2 && km.points.length > 0) {
          o.cluster = { title: "Clustering (k-means)", ...(await figureToPng(clusterFigure(km), 900)) };
        }
        const reg = ml[i].regression;
        if (reg && reg.points.length > 0) {
          o.regression = { title: "Régression linéaire", ...(await figureToPng(regressionFigure(reg), 900)) };
        }
        mlImgs.push(o);
      }
      setProgress(null);

      if (kind === "xlsx") {
        const charts = withCharts && chartCount > 0 ? await excelCharts() : sheets.map(() => []);
        setProgress(null);
        const { exportXLSX } = await import("@/lib/export-xlsx");
        await exportXLSX(
          fileName,
          sheets.map((s, i) => ({
            name: s.name,
            dataset: s.dataset,
            analysis: s.analysis,
            manualLog: s.manualLog,
            excelCharts: charts[i],
            kpis: s.kpis,
            pivot: s.pivot,
            kmeans: ml[i].kmeans,
            regression: ml[i].regression,
            clusterImage: mlImgs[i].cluster,
            regressionImage: mlImgs[i].regression,
          })),
        );
        return;
      }
      const images = withCharts && chartCount > 0 ? await renderCharts() : sheets.map(() => []);
      setProgress(null);
      const withImages = sheets.map((s, i) => ({
        ...s,
        charts: images[i],
        kmeans: ml[i].kmeans,
        regression: ml[i].regression,
        clusterImage: mlImgs[i].cluster,
        regressionImage: mlImgs[i].regression,
      }));
      if (kind === "pdf") {
        const { exportPDF } = await import("@/lib/export-pdf");
        await exportPDF(fileName, withImages);
      } else {
        const { exportDOCX } = await import("@/lib/export-docx");
        await exportDOCX(fileName, withImages);
      }
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Erreur") +
          " — l'export a échoué, réessayez.",
      );
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <div>
      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => run("xlsx")}
          disabled={busy !== null}
        >
          {busy === "xlsx" ? <span className="spinner" /> : <FileSpreadsheet size={18} />}
          Exporter en Excel
        </button>
        <button className="btn" onClick={() => run("pdf")} disabled={busy !== null}>
          {busy === "pdf" ? <span className="spinner dark" /> : <FileText size={18} />}
          Exporter en PDF
        </button>
        <button className="btn" onClick={() => run("docx")} disabled={busy !== null}>
          {busy === "docx" ? <span className="spinner dark" /> : <FileType2 size={18} />}
          Exporter en Word
        </button>
      </div>
      {chartCount > 0 && (
        <label className="cb-toggle" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={withCharts} onChange={(e) => setWithCharts(e.target.checked)} />
          Inclure les {chartCount} graphique{chartCount > 1 ? "s" : ""} personnalisé{chartCount > 1 ? "s" : ""} dans
          les exports
        </label>
      )}
      {progress && (
        <p className="hint" style={{ marginTop: 8 }}>
          <span className="spinner dark" /> {progress}
        </p>
      )}
      <p className="hint" style={{ marginTop: 10 }}>
        {multi
          ? `Un seul document par format rassemble tout : un onglet de données par feuille (${sheets.length}), un sommaire, le profil, les corrélations et les observations combinés, chaque liste étant un vrai tableau Excel (filtres, tri, style). Le PDF et le Word produisent le même rapport, une section par feuille.`
          : "Un seul document par format rassemble tout : données nettoyées, profil, corrélations et observations, chaque liste étant un vrai tableau Excel (filtres, tri, style). Le PDF et le Word produisent le même rapport."}
        {" "}
        Chaque document inclut aussi les indicateurs (KPI), les statistiques
        descriptives, les fréquences, le tableau croisé dynamique, le clustering
        (k-means) et la régression linéaire.
        {chartCount > 0 &&
          " Les graphiques personnalisés y sont repris : dans l'Excel, un onglet « Graphiques » contient le tableau de données de chacun et le graphique Excel natif correspondant, modifiable (image pour les types sans équivalent dans Excel : carte, Sankey, boîte à moustaches…) ; dans le PDF et le Word, des images haute définition."}
      </p>
      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
