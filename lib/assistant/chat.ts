// Assistant IA — chat conversationnel spécialisé data.
//
// À chaque question, on envoie à l'IA le contexte de TOUTES les feuilles
// (schéma + statistiques agrégées + petit échantillon) + l'historique de la
// conversation. L'IA répond librement à toute question d'analyse de données,
// et peut éventuellement proposer un tableau (plan de transformation exécuté
// localement). Les lignes brutes complètes ne quittent jamais le navigateur.

import type { WorkbookInput } from "../types";
import type { TransformPlan } from "./types";
import { summarizeTable } from "./report";

export interface SheetContext {
  name: string;
  columns: string[];
  rowCount: number;
  numericSummary: { column: string; count: number; sum: number; mean: number; min: number; max: number }[];
  categoricalSummary: { column: string; unique: number; top: { value: string; count: number }[] }[];
  sample: Record<string, unknown>[];
}

const MAX_SHEETS = 10;
const MAX_SAMPLE = 6;

export function buildSheetsContext(workbook: WorkbookInput): SheetContext[] {
  return workbook.sheets.slice(0, MAX_SHEETS).map((s) => {
    const sum = summarizeTable(s.dataset.columns, s.dataset.rows);
    return {
      name: s.name,
      columns: sum.columns,
      rowCount: sum.rowCount,
      numericSummary: sum.numericSummary,
      categoricalSummary: sum.categoricalSummary,
      sample: sum.sampleRows.slice(0, MAX_SAMPLE),
    };
  });
}

export interface ChatReply {
  answer: string;
  plan?: TransformPlan | null; // tableau optionnel à exécuter localement
  sheet?: string | null; // feuille sur laquelle exécuter le plan
}

export async function fetchChatReply(
  sheets: SheetContext[],
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
): Promise<ChatReply> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sheets, history, question }),
  });

  let data: { answer?: string; plan?: TransformPlan | null; sheet?: string | null; error?: string };
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur (${res.status}) lors de l'appel à l'assistant.`);
  }
  return {
    answer: typeof data.answer === "string" && data.answer.trim() ? data.answer : "(réponse vide)",
    plan: data.plan && Array.isArray(data.plan.steps) ? data.plan : null,
    sheet: typeof data.sheet === "string" ? data.sheet : null,
  };
}
