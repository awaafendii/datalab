"use client";

import { useState } from "react";
import { FileText, FileSpreadsheet, FileType2 } from "lucide-react";
import type { Analysis, ChartImage, Dataset, ManualLogEntry } from "@/lib/types";
import type { ChartConfig } from "@/lib/charts/types";
import { LIGHT_THEME } from "@/lib/charts/types";
import { autoTitle, chartDef } from "@/lib/charts/catalog";
import { buildFigure } from "@/lib/charts/build";
import { columnInfos } from "@/lib/charts/data";
import type { ExcelChartInput } from "@/lib/export-xlsx";

export interface ExportSheetInput {
  name: string;
  dataset: Dataset;
  analysis: Analysis;
  charts: ChartConfig[]; // graphiques personnalisés de la feuille
  manualLog: ManualLogEntry[]; // décisions manuelles de nettoyage
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
      if (kind === "xlsx") {
        const charts = withCharts && chartCount > 0 ? await excelCharts() : sheets.map(() => []);
        setProgress(null);
        const { exportXLSX } = await import("@/lib/export-xlsx");
        await exportXLSX(
          fileName,
          sheets.map((s, i) => ({ name: s.name, dataset: s.dataset, analysis: s.analysis, manualLog: s.manualLog, excelCharts: charts[i] })),
        );
        return;
      }
      const images = withCharts && chartCount > 0 ? await renderCharts() : sheets.map(() => []);
      setProgress(null);
      const withImages = sheets.map((s, i) => ({ ...s, charts: images[i] }));
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
          ? `L'Excel regroupe un onglet de données par feuille (${sheets.length}) plus un sommaire, un profil, des corrélations et des observations combinés, chaque liste étant un vrai tableau Excel (filtres, tri, style). Le PDF et le Word produisent un rapport complet avec une section par feuille.`
          : "L'Excel contient les données nettoyées + le profil + les corrélations + les observations, chaque liste étant un vrai tableau Excel (filtres, tri, style). Le PDF et le Word produisent un rapport complet."}
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
