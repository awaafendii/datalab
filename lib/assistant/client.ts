// Assistant IA — appel côté client de /api/assistant.
//
// Construit le schéma (colonnes + types devinés) et un petit échantillon, puis
// demande un plan de transformation. Seuls schéma + échantillon quittent le
// navigateur ; les lignes brutes complètes restent locales.

import type { CellValue, Dataset } from "../types";
import type { TransformPlan } from "./types";

const SAMPLE_ROWS = 10;

interface PlanResponse extends Partial<TransformPlan> {
  error?: string;
}

function guessType(values: CellValue[]): string {
  const nonNull = values.filter((v) => v !== null && v !== "");
  if (nonNull.length === 0) return "vide";
  const nums = nonNull.filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/\s| /g, "").replace(",", ".")))));
  if (nums.length >= nonNull.length * 0.8) return "nombre";
  const bools = nonNull.filter((v) => typeof v === "boolean");
  if (bools.length === nonNull.length) return "booléen";
  return "texte";
}

export async function fetchTransformPlan(
  dataset: Dataset,
  userRequest: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<TransformPlan> {
  const sampleRows = dataset.rows.slice(0, SAMPLE_ROWS).map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of dataset.columns) o[c] = r[c];
    return o;
  });

  const columnTypes: Record<string, string> = {};
  for (const c of dataset.columns) {
    columnTypes[c] = guessType(dataset.rows.slice(0, 50).map((r) => r[c] ?? null));
  }

  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      columns: dataset.columns,
      columnTypes,
      sampleRows,
      userRequest,
      history,
    }),
  });

  let data: PlanResponse;
  try {
    data = (await res.json()) as PlanResponse;
  } catch {
    data = {};
  }

  if (!res.ok || data.error || !Array.isArray(data.steps)) {
    throw new Error(data.error || `Erreur (${res.status}) lors de l'appel à l'assistant IA.`);
  }

  return {
    title: typeof data.title === "string" ? data.title : "Document produit",
    steps: data.steps,
    explanation: typeof data.explanation === "string" ? data.explanation : "",
  };
}
