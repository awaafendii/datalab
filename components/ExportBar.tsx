"use client";

import { useState } from "react";
import { FileText, FileSpreadsheet, FileType2 } from "lucide-react";
import type { Analysis, Dataset } from "@/lib/types";

interface Props {
  dataset: Dataset;
  analysis: Analysis;
}

type Kind = "xlsx" | "pdf" | "docx";

export default function ExportBar({ dataset, analysis }: Props) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: Kind) => {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "xlsx") {
        const { exportXLSX } = await import("@/lib/export-xlsx");
        await exportXLSX(dataset, analysis);
      } else if (kind === "pdf") {
        const { exportPDF } = await import("@/lib/export-pdf");
        await exportPDF(dataset, analysis);
      } else {
        const { exportDOCX } = await import("@/lib/export-docx");
        await exportDOCX(dataset, analysis);
      }
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Erreur") +
          " — l'export a échoué, réessayez.",
      );
    } finally {
      setBusy(null);
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
          {busy === "pdf" ? <span className="spinner" /> : <FileText size={18} />}
          Exporter en PDF
        </button>
        <button className="btn" onClick={() => run("docx")} disabled={busy !== null}>
          {busy === "docx" ? <span className="spinner" /> : <FileType2 size={18} />}
          Exporter en Word
        </button>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        L&apos;Excel contient les données nettoyées + le profil + les corrélations +
        les observations. Le PDF et le Word produisent un rapport complet.
      </p>
      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
