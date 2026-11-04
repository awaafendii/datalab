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
const MAX_SAMPLE = 3;
const MAX_COLS_SUMMARY = 40; // borne le nombre de colonnes résumées par feuille
const MAX_TOP = 5; // top catégories par colonne catégorielle

const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

// Contexte COMPACT (pour rester sous la limite de tokens/minute du palier
// gratuit) : échantillon réduit, top catégories limité, nombres arrondis.
export function buildSheetsContext(workbook: WorkbookInput): SheetContext[] {
  return workbook.sheets.slice(0, MAX_SHEETS).map((s) => {
    const sum = summarizeTable(s.dataset.columns, s.dataset.rows);
    return {
      name: s.name,
      columns: sum.columns.slice(0, 60),
      rowCount: sum.rowCount,
      numericSummary: sum.numericSummary.slice(0, MAX_COLS_SUMMARY).map((x) => ({
        column: x.column,
        count: x.count,
        sum: round(x.sum),
        mean: round(x.mean),
        min: round(x.min),
        max: round(x.max),
      })),
      categoricalSummary: sum.categoricalSummary.slice(0, MAX_COLS_SUMMARY).map((c) => ({
        column: c.column,
        unique: c.unique,
        top: c.top.slice(0, MAX_TOP),
      })),
      sample: sum.sampleRows.slice(0, MAX_SAMPLE),
    };
  });
}

// Résultat EXACT d'un calcul demandé par l'IA (tool-use), renvoyé à l'IA au
// tour suivant pour qu'elle réponde avec les vrais chiffres.
export interface ToolResult {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

// Une étape de la boucle agentique : soit l'IA demande un calcul (compute),
// soit elle donne la réponse finale (answer).
export interface ChatStep {
  action: "compute" | "answer";
  answer?: string;
  plan?: TransformPlan | null; // présent si action === "compute"
  sheet?: string | null; // feuille sur laquelle exécuter le plan
}

export async function fetchChatStep(
  sheets: SheetContext[],
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  toolResults: ToolResult[] = [],
): Promise<ChatStep> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sheets, history, question, toolResults }),
  });

  let data: {
    action?: string;
    answer?: string;
    plan?: TransformPlan | null;
    sheet?: string | null;
    error?: string;
  };
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur (${res.status}) lors de l'appel à l'assistant.`);
  }

  const plan = data.plan && Array.isArray(data.plan.steps) ? data.plan : null;
  // "compute" seulement si un plan exploitable est fourni ; sinon on répond.
  if (data.action === "compute" && plan) {
    return { action: "compute", plan, sheet: typeof data.sheet === "string" ? data.sheet : null };
  }
  return {
    action: "answer",
    answer: typeof data.answer === "string" && data.answer.trim() ? data.answer : "(réponse vide)",
  };
}
