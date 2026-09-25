"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSearch, UploadCloud } from "lucide-react";
import { DOC_EXTENSIONS, extractFile } from "@/lib/documents/extract";
import { analyzeDocument, type DocumentResult } from "@/lib/documents/analyze";
import type { DocModel } from "@/lib/documents/types";

export interface LoadedDoc {
  model: DocModel;
  result: DocumentResult;
}

interface Props {
  onLoaded: (docs: LoadedDoc[]) => void;
  compact?: boolean; // version « ajouter des documents » dans l'espace de travail
}

// Laisse le navigateur afficher la progression entre deux traitements lourds.
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 20));

export default function DocumentUpload({ onLoaded, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<{ name: string; ok: boolean; message: string }[]>([]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const loaded: LoadedDoc[] = [];
      const lines: { name: string; ok: boolean; message: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          setProgress(`Lecture de « ${f.name} » (${i + 1}/${files.length})…`);
          await yieldToBrowser();
          const model = await extractFile(f);
          setProgress(`Analyse de « ${f.name} » (${i + 1}/${files.length})…`);
          await yieldToBrowser();
          const result = analyzeDocument(model);
          loaded.push({ model, result });
          lines.push({ name: f.name, ok: true, message: `${result.analysis.anomalies.length} anomalie(s) détectée(s)` });
        } catch (e) {
          lines.push({ name: f.name, ok: false, message: e instanceof Error ? e.message : "Lecture impossible." });
        }
      }
      setProgress(null);
      setReport(lines);
      if (loaded.length) onLoaded(loaded);
    },
    [onLoaded],
  );

  const busy = progress !== null;
  const zone = (
    <div
      className={"dropzone" + (drag ? " drag" : "")}
      style={compact ? { padding: "22px 16px" } : undefined}
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!busy) handleFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <div className="icon">{busy ? <span className="spinner" style={{ borderColor: "var(--border)", borderTopColor: "var(--primary)", width: 34, height: 34 }} /> : <UploadCloud size={compact ? 28 : 40} />}</div>
      <h3>{busy ? progress : compact ? "Ajouter des documents" : "Glissez un ou plusieurs documents ici"}</h3>
      <p>ou cliquez pour parcourir vos fichiers · {DOC_EXTENSIONS.join(", ")}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_EXTENSIONS.join(",")}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          handleFiles(files);
        }}
      />
    </div>
  );

  const list = report.length > 0 && (
    <ul className="file-list">
      {report.map((r, i) => (
        <li key={r.name + i}>
          {r.ok ? <CheckCircle2 size={16} className="ok" /> : <AlertCircle size={16} className="ko" />}
          <span>
            <b>{r.name}</b> — {r.message}
          </span>
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <div>
        {zone}
        {list}
      </div>
    );
  }
  return (
    <div className="card">
      <h2>
        <FileSearch size={20} /> Contrôler des documents
      </h2>
      <p className="subtitle">
        Rapports d&apos;activités, rapports d&apos;étude ou d&apos;inspection, stratégies, CDMT,
        cahiers des charges, termes de référence, matrices d&apos;indicateurs (CAP, PTA) de toutes
        les directions. Formats : Word (.docx), PDF texte, Excel (.xlsx, .xls, .ods). Chargez
        plusieurs fichiers pour comparer aussi les documents entre eux. Tout est analysé dans votre
        navigateur : rien n&apos;est envoyé sur un serveur.
      </p>
      {zone}
      {list}
    </div>
  );
}
