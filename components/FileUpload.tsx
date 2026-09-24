"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet } from "lucide-react";
import { ACCEPTED_EXTENSIONS, parseFile } from "@/lib/parse";
import type { WorkbookInput } from "@/lib/types";

interface Props {
  onLoaded: (workbook: WorkbookInput) => void;
}

export default function FileUpload({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        // parseFile lève une erreur explicite si le fichier n'a aucune donnée.
        onLoaded(await parseFile(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de lecture du fichier.");
      } finally {
        setLoading(false);
      }
    },
    [onLoaded],
  );

  return (
    <div className="card">
      <h2>
        <FileSpreadsheet size={20} /> Charger un fichier
      </h2>
      <p className="subtitle">
        Formats acceptés : CSV, TSV, TXT, Excel (XLSX, XLSM avec macros, XLS,
        XLSB, modèles XLTX/XLTM) et ODS. Les classeurs multi-feuilles sont pris
        en charge, chaque feuille est traitée séparément. Vos données restent
        dans votre navigateur — rien n&apos;est envoyé sur un serveur.
      </p>

      <div
        className={"dropzone" + (drag ? " drag" : "")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="icon">
          <UploadCloud size={40} />
        </div>
        <h3>{loading ? "Lecture en cours…" : "Glissez un fichier ici"}</h3>
        <p>ou cliquez pour parcourir vos fichiers</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
    </div>
  );
}
