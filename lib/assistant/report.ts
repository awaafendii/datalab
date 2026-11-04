// Assistant IA — Phase 2 : rapport de synthèse / aide à la décision.
//
// À partir d'un tableau (le document produit en Phase 1, ou le jeu chargé),
// on calcule LOCALEMENT un résumé (stats + échantillon) qu'on envoie à l'IA ;
// l'IA rédige un rapport décisionnel structuré. Les lignes brutes complètes ne
// sont pas envoyées. Export Word (.docx) et Markdown (.md).

import type { CellValue, Row } from "../types";

export interface SynthesisReport {
  title: string;
  overview: string; // synthèse générale (1 paragraphe)
  findings: string[]; // constats chiffrés
  recommendations: string[]; // recommandations pour la décision
}

interface ReportResponse extends Partial<SynthesisReport> {
  error?: string;
}

function toNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    let s = v.trim().replace(/\s| /g, "").replace(/%/g, "");
    if (/,\d+$/.test(s) && !/\.\d/.test(s)) s = s.replace(",", ".");
    s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface TableSummary {
  columns: string[];
  rowCount: number;
  sampleRows: Row[];
  numericSummary: { column: string; count: number; sum: number; mean: number; min: number; max: number }[];
  categoricalSummary: { column: string; unique: number; top: { value: string; count: number }[] }[];
}

// Résumé local borné (envoyé à l'IA à la place des lignes brutes).
export function summarizeTable(columns: string[], rows: Row[]): TableSummary {
  const numericSummary: TableSummary["numericSummary"] = [];
  const categoricalSummary: TableSummary["categoricalSummary"] = [];

  for (const col of columns) {
    const values = rows.map((r) => r[col] ?? null);
    const nums = values.map(toNumber).filter((n): n is number => n !== null);
    const nonEmpty = values.filter((v) => v !== null && v !== "").length;
    // numérique si au moins 70 % des valeurs non vides sont des nombres
    if (nonEmpty > 0 && nums.length >= nonEmpty * 0.7) {
      const sum = nums.reduce((a, b) => a + b, 0);
      numericSummary.push({
        column: col,
        count: nums.length,
        sum,
        mean: nums.length ? sum / nums.length : 0,
        min: nums.length ? Math.min(...nums) : 0,
        max: nums.length ? Math.max(...nums) : 0,
      });
    } else {
      const counts = new Map<string, number>();
      for (const v of values) {
        const s = String(v ?? "");
        if (s === "") continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, count]) => ({ value, count }));
      categoricalSummary.push({ column: col, unique: counts.size, top });
    }
  }

  return {
    columns,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 20).map((r) => {
      const o: Row = {};
      for (const c of columns) o[c] = r[c] ?? null;
      return o;
    }),
    numericSummary,
    categoricalSummary,
  };
}

export async function fetchSynthesisReport(
  title: string,
  columns: string[],
  rows: Row[],
  userContext = "",
): Promise<SynthesisReport> {
  const summary = summarizeTable(columns, rows);
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, userContext, ...summary }),
  });

  let data: ReportResponse;
  try {
    data = (await res.json()) as ReportResponse;
  } catch {
    data = {};
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur (${res.status}) lors de la génération du rapport.`);
  }
  return {
    title: typeof data.title === "string" ? data.title : title,
    overview: typeof data.overview === "string" ? data.overview : "",
    findings: Array.isArray(data.findings) ? data.findings.filter((x) => typeof x === "string") : [],
    recommendations: Array.isArray(data.recommendations)
      ? data.recommendations.filter((x) => typeof x === "string")
      : [],
  };
}

export function reportToMarkdown(r: SynthesisReport): string {
  const lines = [`# ${r.title}`, "", "## Synthèse", r.overview, ""];
  if (r.findings.length) {
    lines.push("## Constats");
    r.findings.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }
  if (r.recommendations.length) {
    lines.push("## Recommandations");
    r.recommendations.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }
  lines.push(`_Rapport généré par l'assistant IA de DataLab, le ${new Date().toLocaleDateString("fr-FR")}._`);
  return lines.join("\n");
}

export function downloadMarkdown(r: SynthesisReport): void {
  const blob = new Blob([reportToMarkdown(r)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${r.title.slice(0, 60) || "rapport"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export Word (.docx). Imports dynamiques pour alléger le bundle initial.
export async function downloadDocx(r: SynthesisReport): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const { saveAs } = await import("file-saver");

  const children = [
    new Paragraph({ text: r.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "Synthèse", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun(r.overview)] }),
  ];
  if (r.findings.length) {
    children.push(new Paragraph({ text: "Constats", heading: HeadingLevel.HEADING_1 }));
    r.findings.forEach((f) => children.push(new Paragraph({ text: f, bullet: { level: 0 } })));
  }
  if (r.recommendations.length) {
    children.push(new Paragraph({ text: "Recommandations", heading: HeadingLevel.HEADING_1 }));
    r.recommendations.forEach((f) => children.push(new Paragraph({ text: f, bullet: { level: 0 } })));
  }
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Rapport généré par l'assistant IA de DataLab, le ${new Date().toLocaleDateString("fr-FR")}.`,
          italics: true,
          size: 18,
        }),
      ],
    }),
  );

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${r.title.slice(0, 60) || "rapport"}.docx`);
}
