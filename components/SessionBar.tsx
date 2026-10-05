"use client";

import { HardDrive, RotateCcw } from "lucide-react";

interface Props {
  persist: boolean;
  restoredAt: string | null;
  error: string | null;
  onTogglePersist: (on: boolean) => void;
  onClear: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// Bandeau de la session mémorisée dans le navigateur : état, préférence et
// effacement (utile sur un ordinateur partagé).
export default function SessionBar({ persist, restoredAt, error, onTogglePersist, onClear }: Props) {
  return (
    <div className={"session-bar" + (error ? " warn" : "")}>
      <HardDrive size={16} aria-hidden />
      <span className="msg">
        {restoredAt && persist
          ? `Session du ${formatDate(restoredAt)} restaurée : fichier, réglages, décisions et graphiques.`
          : persist
            ? "Fichier, réglages, décisions de nettoyage et graphiques sont mémorisés dans ce navigateur et retrouvés après actualisation."
            : "Session non mémorisée : tout sera perdu à l'actualisation de la page."}
        {error && <> {error}</>}
      </span>
      <label className="cb-toggle">
        <input type="checkbox" checked={persist} onChange={(e) => onTogglePersist(e.target.checked)} />
        Mémoriser sur cet ordinateur
      </label>
      <button type="button" className="link-btn" onClick={onClear} title="Efface la session mémorisée et revient au chargement d'un fichier">
        <RotateCcw size={13} /> Effacer et recommencer
      </button>
    </div>
  );
}
