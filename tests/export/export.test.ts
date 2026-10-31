import { describe, it, expect } from "vitest";
import type { Dataset } from "@/lib/types";
import { analyzeDataset } from "@/lib/analyze";
import { autoKpis } from "@/lib/kpi/kpi";
import { autoPivotConfig } from "@/lib/pivot/engine";
import { autoClusterAndRegression } from "@/lib/ml";
import { buildXLSX } from "@/lib/export-xlsx";
import { buildPDF } from "@/lib/export-pdf";
import { buildDOCX } from "@/lib/export-docx";

// Jeu de données synthétique : 2 catégorielles + 2 numériques, assez de lignes
// pour que le clustering (k=3) et la régression s'exécutent.
function sampleSheet() {
  const regions = ["Nord", "Sud", "Est", "Ouest"];
  const programmes = ["A", "B", "C"];
  const rows = [];
  for (let i = 0; i < 24; i++) {
    rows.push({
      Région: regions[i % regions.length],
      Programme: programmes[i % programmes.length],
      Montant: 100 + i * 37 + (i % 5) * 11,
      Effectif: 10 + (i % 7) * 3,
    });
  }
  const dataset: Dataset = { columns: ["Région", "Programme", "Montant", "Effectif"], rows, fileName: "demo.xlsx" };
  const analysis = analyzeDataset(dataset);
  const { kmeans, regression } = autoClusterAndRegression(dataset, analysis.profile);
  return {
    name: "Feuille 1",
    dataset,
    analysis,
    manualLog: [],
    kpis: autoKpis(analysis.profile),
    pivot: autoPivotConfig(analysis.profile),
    kmeans,
    regression,
  };
}

const bytesOf = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

describe("export unifié — génération des trois formats", () => {
  it("l'ANOVA/clustering/régression sont bien disponibles pour l'export", () => {
    const s = sampleSheet();
    expect(s.kmeans).not.toBeNull();
    expect(s.regression).not.toBeNull();
    expect(s.kpis.length).toBeGreaterThan(0);
  });

  it("génère un Excel (.xlsx) non vide, signature ZIP", async () => {
    const s = sampleSheet();
    const out = bytesOf(await buildXLSX("demo.xlsx", [s]));
    expect(out.length).toBeGreaterThan(2000);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x4b); // 'K'
  }, 30000);

  it("génère un Word (.docx) non vide, signature ZIP", async () => {
    const s = sampleSheet();
    const out = bytesOf(await buildDOCX("demo.xlsx", [s]));
    expect(out.length).toBeGreaterThan(2000);
    expect(out[0]).toBe(0x50);
    expect(out[1]).toBe(0x4b);
  }, 30000);

  it("génère un PDF (%PDF) non vide", async () => {
    const s = sampleSheet();
    const out = bytesOf(await buildPDF("demo.xlsx", [s]));
    expect(out.length).toBeGreaterThan(1000);
    const head = String.fromCharCode(out[0], out[1], out[2], out[3]);
    expect(head).toBe("%PDF");
  }, 30000);
});
