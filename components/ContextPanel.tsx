"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { ContextResult, Dataset } from "@/lib/types";
import { fetchAiContext } from "@/lib/context-ai";

interface Props {
  dataset: Dataset;
  heuristic: ContextResult;
  aiResult: ContextResult | null;
  onAiResult: (result: ContextResult | null) => void;
}

// Affiche le contexte détecté (secteur d'activité, colonnes clés, en-têtes
// manquants) et propose de basculer vers une analyse IA optionnelle plus
// fine. Par défaut, tout se passe en local (dictionnaire de mots-clés) ;
// l'IA n'est appelée que si l'utilisateur clique explicitement dessus.
export default function ContextPanel({ dataset, heuristic, aiResult, onAiResult }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effective = aiResult ?? heuristic;

  const runAi = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAiContext(dataset);
      onAiResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue lors de l'analyse IA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>
        <Sparkles size={20} /> Contexte détecté
      </h2>
      <p className="subtitle">
        {effective.source === "ai"
          ? "Analyse IA (Claude) : un échantillon de vos données a été envoyé pour une compréhension plus fine."
          : "Analyse heuristique locale (dictionnaire de mots-clés) : aucune donnée n'a quitté votre navigateur."}
      </p>

      {dataset.headerInferred && (
        <div className="hint" style={{ marginBottom: 14 }}>
          Aucune ligne d&apos;en-têtes détectée dans ce fichier : des noms de
          colonnes ont été générés automatiquement d&apos;après le contenu (
          {dataset.columns.join(", ")}).
        </div>
      )}

      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="value" style={{ fontSize: 18 }}>
            {effective.sectorLabel}
          </div>
          <div className="label">Secteur détecté</div>
        </div>
        <div
          className={
            "tile" +
            (effective.confidence >= 0.6
              ? " good"
              : effective.confidence > 0
                ? " warn"
                : "")
          }
        >
          <div className="value">{Math.round(effective.confidence * 100)}%</div>
          <div className="label">Confiance</div>
        </div>
      </div>

      {effective.keyColumns.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            Colonnes clés suggérées
          </div>
          <div className="chip-picker" style={{ marginBottom: 6 }}>
            {effective.keyColumns.map((c) => (
              <span key={c} className="chip active" style={{ cursor: "default" }}>
                {c}
              </span>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>
            Pré-sélectionnées dans le clustering et la régression, plus bas.
          </p>
        </>
      )}

      {effective.rationale && (
        <p className="hint" style={{ marginBottom: 14 }}>
          {effective.rationale}
        </p>
      )}

      {effective.headerSuggestions.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            Suggestions de noms de colonnes (IA)
          </div>
          <ul className="obs">
            {effective.headerSuggestions.map((s, i) => (
              <li key={i}>
                « {s.column} » → « {s.suggestion} »
              </li>
            ))}
          </ul>
          <p className="hint">
            Suggestions informatives : les colonnes ne sont pas renommées
            automatiquement.
          </p>
        </>
      )}

      <div className="btn-row">
        <button className="btn" onClick={runAi} disabled={loading}>
          {loading ? <span className="spinner" /> : <Sparkles size={16} />}
          {aiResult
            ? "Relancer l'analyse IA"
            : "Activer l'analyse IA (envoie un échantillon à Claude)"}
        </button>
        {aiResult && (
          <button className="btn" onClick={() => onAiResult(null)} disabled={loading}>
            Revenir à l&apos;analyse locale
          </button>
        )}
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
