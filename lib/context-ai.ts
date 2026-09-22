// Appelle la route serveur optionnelle /api/context pour une analyse IA du
// contexte (secteur, colonnes clés, suggestions d'en-têtes). C'est le seul
// endroit de l'application qui envoie des données hors du navigateur, et
// uniquement à l'initiative explicite de l'utilisateur (bouton "Activer
// l'analyse IA").

import type { ContextResult, Dataset, HeaderSuggestion } from "./types";

interface AiResponseBody {
  sector_label?: string;
  confidence?: number;
  key_columns?: string[];
  header_suggestions?: { column?: string; suggestion?: string }[];
  rationale?: string;
  error?: string;
}

const MAX_SAMPLE_ROWS = 8;

export async function fetchAiContext(dataset: Dataset): Promise<ContextResult> {
  const sampleRows = dataset.rows.slice(0, MAX_SAMPLE_ROWS).map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of dataset.columns) o[c] = r[c];
    return o;
  });

  const res = await fetch("/api/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: dataset.fileName,
      columns: dataset.columns,
      headerInferred: !!dataset.headerInferred,
      sampleRows,
    }),
  });

  let data: AiResponseBody;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur (${res.status}) lors de l'appel à l'IA.`);
  }

  const keyColumns = Array.isArray(data.key_columns)
    ? data.key_columns.filter((c): c is string => dataset.columns.includes(c))
    : [];

  const headerSuggestions: HeaderSuggestion[] = Array.isArray(data.header_suggestions)
    ? data.header_suggestions
        .filter((s) => s && typeof s.column === "string" && typeof s.suggestion === "string")
        .map((s) => ({ column: s.column as string, suggestion: s.suggestion as string }))
    : [];

  return {
    source: "ai",
    sector: "inconnu", // le libellé IA est libre ; voir sectorLabel pour l'affichage
    sectorLabel: data.sector_label || "Non déterminé",
    confidence:
      typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : 0,
    matchedKeywords: [],
    keyColumns,
    rationale: data.rationale || "",
    headerSuggestions,
  };
}
