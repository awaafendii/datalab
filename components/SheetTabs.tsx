"use client";

import { CheckCircle2, Circle } from "lucide-react";
import type { SheetState } from "@/lib/types";

interface Props {
  sheets: SheetState[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

// Sélecteur d'onglets pour naviguer entre les feuilles d'un classeur Excel.
// Chaque feuille est nettoyée et analysée indépendamment ; l'icône indique
// si la feuille active a déjà été traitée.
export default function SheetTabs({ sheets, activeIndex, onSelect }: Props) {
  const doneCount = sheets.filter((s) => s.result !== null).length;

  return (
    <div>
      <div className="sheet-tabs">
        {sheets.map((s, i) => {
          const done = s.result !== null;
          return (
            <button
              key={s.name + i}
              type="button"
              className={"sheet-tab" + (i === activeIndex ? " active" : "")}
              onClick={() => onSelect(i)}
              title={
                done
                  ? `${s.name} — nettoyée (${s.result!.rowsAfter.toLocaleString("fr-FR")} lignes)`
                  : `${s.name} — pas encore nettoyée`
              }
            >
              <span className={"status " + (done ? "done" : "pending")}>
                {done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              </span>
              {s.name}
              <span className="n">{s.dataset.rows.length.toLocaleString("fr-FR")} l.</span>
            </button>
          );
        })}
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
        {doneCount}/{sheets.length} feuille(s) nettoyée(s). Chaque feuille a
        ses propres réglages de nettoyage et sa propre analyse.
      </p>
    </div>
  );
}
