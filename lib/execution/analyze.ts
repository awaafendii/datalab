import type { CellValue, Dataset } from "@/lib/types";
import { parseNumber } from "@/lib/documents/numbers";
import { norm } from "@/lib/documents/text";
import { sectionByCode } from "@/lib/documents/lf";
import {
  DEFAULT_EXEC_THRESHOLDS,
  EXEC_SEVERITY_ORDER,
  type ExecAlert,
  type ExecColumnMapping,
  type ExecLine,
  type ExecStatus,
  type ExecThresholds,
  type ExecTotals,
  type ExecutionReport,
  type LfReconciliation,
} from "./types";

// Lit une cellule comme un montant (nombre direct, ou chaîne « 1 200 000 »,
// « 25 000 GNF »…). Renvoie null si la cellule n'est pas un nombre.
function cellNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const p = parseNumber(v);
    return p ? p.value : null;
  }
  return null;
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Ligne de total / sous-total / ensemble : exclue des agrégats pour ne pas
// compter deux fois.
export function isTotalRow(label: string): boolean {
  const t = norm(label);
  return /\b(total|sous-?total|ensemble|cumul|toutes? natures?|total general)\b/.test(t);
}

function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null;
  return num / den;
}

// Statut et alertes d'une ligne, selon les montants et les seuils.
// `hasExecCols` : au moins une colonne d'engagement ou de paiement est mappée
// (sinon on ne peut pas juger de l'exécution et on ne signale pas de non-exécution).
function assess(
  line: ExecLine,
  thr: ExecThresholds,
  hasExecCols: boolean,
): { statut: ExecStatus; alerts: ExecAlert[] } {
  const alerts: ExecAlert[] = [];
  const { dotation, engagement, paiement, label, index } = line;
  const push = (severity: ExecAlert["severity"], rule: string, message: string) =>
    alerts.push({ severity, rule, message, line: index, label });

  // Montants négatifs : toujours anormaux.
  for (const [name, val] of [
    ["dotation", dotation],
    ["engagement", engagement],
    ["paiement", paiement],
  ] as const) {
    if (val !== null && val < 0) {
      push("majeure", "montant-negatif", `${name} négatif (${val}).`);
    }
  }

  if (dotation === null && engagement === null && paiement === null) {
    return { statut: "indetermine", alerts };
  }

  const tol = thr.depassementTolerance;

  // Dépassement de la dotation (bloquant).
  if (dotation !== null && dotation > 0) {
    if (engagement !== null && engagement > dotation * (1 + tol)) {
      push(
        "bloquante",
        "depassement-engagement",
        `Engagements (${engagement}) supérieurs à la dotation (${dotation}).`,
      );
    }
    if (paiement !== null && paiement > dotation * (1 + tol)) {
      push(
        "bloquante",
        "depassement-paiement",
        `Paiements (${paiement}) supérieurs à la dotation (${dotation}).`,
      );
    }
  }

  // Paiements au-delà des engagements (incohérence de chaîne de la dépense).
  if (engagement !== null && paiement !== null && paiement > engagement * (1 + tol)) {
    push(
      "majeure",
      "paiement-sup-engagement",
      `Paiements (${paiement}) supérieurs aux engagements (${engagement}).`,
    );
  }

  const tauxExec = ratio(paiement, dotation);
  const depassement = alerts.some((a) => a.rule.startsWith("depassement"));

  let statut: ExecStatus;
  if (depassement) {
    statut = "depassement";
  } else if (hasExecCols && dotation !== null && dotation > 0 && (engagement ?? 0) === 0 && (paiement ?? 0) === 0) {
    statut = "non-execute";
    push("majeure", "non-execute", "Crédits dotés mais aucun engagement ni paiement.");
  } else if (tauxExec !== null && tauxExec < thr.sousExecution) {
    statut = "sous-execution";
    push(
      "mineure",
      "sous-execution",
      `Taux d'exécution faible (${(tauxExec * 100).toFixed(1)} %).`,
    );
  } else {
    statut = "normal";
  }

  return { statut, alerts };
}

function buildLine(
  dataset: Dataset,
  rowIndex: number,
  mapping: ExecColumnMapping,
  thr: ExecThresholds,
): ExecLine {
  const row = dataset.rows[rowIndex];
  const label = mapping.label ? cellText(row[mapping.label]) : "";
  const code = mapping.code ? cellText(row[mapping.code]) || null : null;
  const dotation = mapping.dotation ? cellNumber(row[mapping.dotation]) : null;
  const engagement = mapping.engagement ? cellNumber(row[mapping.engagement]) : null;
  const paiement = mapping.paiement ? cellNumber(row[mapping.paiement]) : null;

  const line: ExecLine = {
    index: rowIndex,
    label: label || `ligne ${rowIndex + 1}`,
    code,
    isTotalRow: isTotalRow(label),
    dotation,
    engagement,
    paiement,
    tauxEngagement: ratio(engagement, dotation),
    tauxExecution: ratio(paiement, dotation),
    tauxDecaissement: ratio(paiement, engagement),
    disponible: dotation !== null && engagement !== null ? dotation - engagement : null,
    statut: "indetermine",
    alerts: [],
  };

  // Les lignes de total ne sont pas évaluées (pas de statut d'exécution).
  if (!line.isTotalRow) {
    const hasExecCols = !!(mapping.engagement || mapping.paiement);
    const { statut, alerts } = assess(line, thr, hasExecCols);
    line.statut = statut;
    line.alerts = alerts;
  }
  return line;
}

function sumTotals(lines: ExecLine[]): ExecTotals {
  let dotation = 0;
  let engagement = 0;
  let paiement = 0;
  let lignes = 0;
  for (const l of lines) {
    if (l.isTotalRow || l.statut === "indetermine") continue;
    lignes++;
    dotation += l.dotation ?? 0;
    engagement += l.engagement ?? 0;
    paiement += l.paiement ?? 0;
  }
  return {
    dotation,
    engagement,
    paiement,
    disponible: dotation - engagement,
    tauxEngagement: dotation > 0 ? engagement / dotation : null,
    tauxExecution: dotation > 0 ? paiement / dotation : null,
    lignes,
  };
}

// Rapproche un total de dotations des crédits votés d'une section de la loi
// de finances. Renvoie null si la section est inconnue.
export function reconcileWithLf(
  dotationDocument: number,
  sectionCode: string,
  tolerance = DEFAULT_EXEC_THRESHOLDS.lfTolerance,
): LfReconciliation | null {
  const section = sectionByCode(sectionCode);
  if (!section) return null;
  const creditsVotes = section.total.lf;
  const ecart = dotationDocument - creditsVotes;
  const ecartPct = creditsVotes !== 0 ? ecart / creditsVotes : dotationDocument === 0 ? 0 : 1;
  return {
    sectionCode: section.code,
    sectionNom: section.nom,
    dotationDocument,
    creditsVotes,
    ecart,
    ecartPct,
    conforme: Math.abs(ecartPct) <= tolerance,
  };
}

export interface AnalyzeOptions {
  thresholds?: Partial<ExecThresholds>;
  lfSectionCode?: string | null; // rapprochement avec la loi de finances
}

export function analyzeExecution(
  dataset: Dataset,
  mapping: ExecColumnMapping,
  options: AnalyzeOptions = {},
): ExecutionReport {
  const thr = { ...DEFAULT_EXEC_THRESHOLDS, ...(options.thresholds ?? {}) };
  const warnings: string[] = [];

  if (!mapping.dotation) warnings.push("Colonne « dotation / crédits ouverts » non identifiée.");
  if (!mapping.engagement && !mapping.paiement) {
    warnings.push("Aucune colonne d'engagement ni de paiement identifiée.");
  }
  if (!mapping.label) warnings.push("Colonne « libellé » non identifiée : les lignes sont numérotées.");

  const lines = dataset.rows.map((_, i) => buildLine(dataset, i, mapping, thr));

  const indetermineCount = lines.filter((l) => l.statut === "indetermine" && !l.isTotalRow).length;
  if (indetermineCount > 0) {
    warnings.push(`${indetermineCount} ligne(s) sans montant exploitable, ignorée(s) dans les totaux.`);
  }

  const totals = sumTotals(lines);

  // Alertes de lignes + rapprochement, triées par gravité puis par ordre
  // d'apparition.
  const alerts: ExecAlert[] = lines.flatMap((l) => l.alerts);

  let reconciliation: LfReconciliation | null = null;
  if (options.lfSectionCode) {
    reconciliation = reconcileWithLf(totals.dotation, options.lfSectionCode, thr.lfTolerance);
    if (reconciliation && !reconciliation.conforme) {
      alerts.push({
        severity: "bloquante",
        rule: "lf-ecart",
        message: `Total des dotations (${reconciliation.dotationDocument}) différent des crédits votés de la section ${reconciliation.sectionCode} (${reconciliation.creditsVotes}) : écart ${(reconciliation.ecartPct * 100).toFixed(2)} %.`,
      });
    }
  }

  alerts.sort((a, b) => {
    const s = EXEC_SEVERITY_ORDER[a.severity] - EXEC_SEVERITY_ORDER[b.severity];
    return s !== 0 ? s : (a.line ?? -1) - (b.line ?? -1);
  });

  return { mapping, lines, totals, alerts, reconciliation, warnings };
}
