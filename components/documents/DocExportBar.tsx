"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import type { ReportInput } from "@/lib/documents/export";

type Kind = "docx" | "pdf" | "xlsx";

// Exports : rapport d'audit (Word, PDF) et classeur structuré (Excel).
export default function DocExportBar({ input }: { input: ReportInput }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: Kind) => {
    setError(null);
    setBusy(kind);
    try {
      const mod = await import("@/lib/documents/export");
      if (kind === "docx") await mod.exportAuditDOCX(input);
      else if (kind === "pdf") await mod.exportAuditPDF(input);
      else await mod.exportStructuredXLSX(input);
    } catch (e) {
      setError((e instanceof Error ? e.message : "Erreur") + " — l'export a échoué, réessayez.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button className="btn primary" onClick={() => run("docx")} disabled={busy !== null}>
          {busy === "docx" ? <span className="spinner" /> : <FileType2 size={18} />}
          Rapport d&apos;audit (Word)
        </button>
        <button className="btn" onClick={() => run("pdf")} disabled={busy !== null}>
          {busy === "pdf" ? <span className="spinner" /> : <FileText size={18} />}
          Rapport d&apos;audit (PDF)
        </button>
        <button className="btn" onClick={() => run("xlsx")} disabled={busy !== null}>
          {busy === "xlsx" ? <span className="spinner" /> : <FileSpreadsheet size={18} />}
          Données structurées (Excel)
        </button>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Le rapport d&apos;audit liste les anomalies à traiter et corrigées, avec leur localisation et la
        correction proposée (les anomalies ignorées n&apos;y figurent pas). L&apos;Excel regroupe les
        anomalies avec leur statut, le plan, les tableaux extraits et les indicateurs de toutes les
        directions.
      </p>
      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
