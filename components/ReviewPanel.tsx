"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import type { CleaningOptions, Dataset, ManualReview } from "@/lib/types";
import {
  automaticOutcome,
  cellKey,
  formatValue,
  removeRow,
  restoreRow,
  scanForReview,
  setCellDecision,
  setNote,
  type ColumnSuggestions,
  type ReviewIssue,
} from "@/lib/review";
import { isEmpty, toNumber } from "@/lib/stats";

interface Props {
  dataset: Dataset;
  options: CleaningOptions;
  review: ManualReview;
  onChange: (review: ManualReview) => void;
}

type Filter = "all" | "missing" | "outlier" | "decided" | "pending";
type Choice = "auto" | "keep" | "custom" | "mean" | "median" | "mode" | "cap" | "clear" | "drop";

// Provenance d'une valeur choisie, reprise telle quelle dans le journal
// (« Remplacée par la médiane »).
const SOURCES = {
  mean: "la moyenne",
  median: "la médiane",
  mode: "la valeur la plus fréquente",
  high: "la borne haute",
  low: "la borne basse",
};

const PAGE = 20;

export default function ReviewPanel({ dataset, options, review, onChange }: Props) {
  const scan = useMemo(
    () => scanForReview(dataset, options),
    // Seuls les réglages qui changent la détection relancent l'analyse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, options.trimStrings, options.standardizeEmpty, options.coerceNumbers, options.removeDuplicates, options.outlierThreshold],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [column, setColumn] = useState("");
  const [page, setPage] = useState(0);

  const cellMap = useMemo(() => new Map(review.cells.map((c) => [cellKey(c.row, c.column), c])), [review.cells]);
  const removed = useMemo(() => new Map(review.removedRows.map((r) => [r.row, r])), [review.removedRows]);
  const isDecided = (i: ReviewIssue) => cellMap.has(i.key) || removed.has(i.row);

  const counts = useMemo(() => {
    let missing = 0;
    let outlier = 0;
    let decided = 0;
    for (const i of scan.issues) {
      if (i.kind === "missing") missing++;
      else outlier++;
      if (cellMap.has(i.key) || removed.has(i.row)) decided++;
    }
    return { missing, outlier, decided, pending: scan.issues.length - decided };
  }, [scan.issues, cellMap, removed]);

  const byColumn = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of scan.issues) m.set(i.column, (m.get(i.column) ?? 0) + 1);
    return m;
  }, [scan.issues]);

  const filtered = useMemo(
    () =>
      scan.issues.filter((i) => {
        if (column && i.column !== column) return false;
        if (filter === "missing") return i.kind === "missing";
        if (filter === "outlier") return i.kind === "outlier";
        if (filter === "decided") return cellMap.has(i.key) || removed.has(i.row);
        if (filter === "pending") return !cellMap.has(i.key) && !removed.has(i.row);
        return true;
      }),
    [scan.issues, column, filter, cellMap, removed],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE, current * PAGE + PAGE);

  // Colonnes de contexte : les 3 premières colonnes de la feuille, hors
  // colonne examinée (souvent identifiant, nom, localité…).
  const context = (i: ReviewIssue) =>
    dataset.columns
      .filter((c) => c !== i.column)
      .slice(0, 3)
      .map((c) => `${c} : ${formatValue(scan.rows[i.row]?.[c])}`)
      .join(" · ");

  const choiceOf = (i: ReviewIssue): Choice => {
    if (removed.has(i.row)) return "drop";
    const d = cellMap.get(i.key);
    if (!d) return "auto";
    if (d.decision.action === "keep") return "keep";
    const src = d.decision.source;
    if (src === SOURCES.mean) return "mean";
    if (src === SOURCES.median) return "median";
    if (src === SOURCES.mode) return "mode";
    if (src === SOURCES.high || src === SOURCES.low) return "cap";
    if (isEmpty(d.decision.value) && i.kind === "outlier") return "clear";
    return "custom";
  };

  const capOf = (i: ReviewIssue, s: ColumnSuggestions) => {
    const n = toNumber(i.value);
    return n !== null && s.high !== undefined && n > s.high ? { value: s.high, source: SOURCES.high } : { value: s.low ?? null, source: SOURCES.low };
  };

  // Nouvelle décision pour une cellule (sans toucher aux autres).
  const decide = (r: ManualReview, i: ReviewIssue, choice: Choice): ManualReview => {
    const s = scan.columns[i.column] ?? { numeric: false };
    const base = removed.has(i.row) ? restoreRow(r, i.row) : r;
    switch (choice) {
      case "auto":
        return setCellDecision(base, i, null);
      case "keep":
        return setCellDecision(base, i, { action: "keep" });
      case "mean":
        return setCellDecision(base, i, { action: "set", value: s.mean ?? null, source: SOURCES.mean });
      case "median":
        return setCellDecision(base, i, { action: "set", value: s.median ?? null, source: SOURCES.median });
      case "mode":
        return setCellDecision(base, i, { action: "set", value: s.mode ?? null, source: SOURCES.mode });
      case "cap": {
        const cap = capOf(i, s);
        return setCellDecision(base, i, { action: "set", value: cap.value, source: cap.source });
      }
      case "clear":
        return setCellDecision(base, i, { action: "set", value: null });
      case "custom":
        return setCellDecision(base, i, { action: "set", value: i.kind === "outlier" ? i.value : "" });
      case "drop":
        return removeRow(setCellDecision(base, i, null), i.row);
    }
  };

  const bulk = (choice: Choice, onlyPending: boolean) => {
    let r = review;
    for (const i of filtered) {
      if (onlyPending && (cellMap.has(i.key) || removed.has(i.row))) continue;
      r = decide(r, i, choice);
    }
    onChange(r);
  };

  if (scan.issues.length === 0) {
    return (
      <div className="review">
        <div className="section-title">
          <ClipboardCheck size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Examen manuel des cellules vides et des valeurs atypiques
        </div>
        <p className="hint">Aucune cellule vide ni valeur atypique détectée (seuil IQR × {options.outlierThreshold || 1.5}).</p>
      </div>
    );
  }

  const colStats = column ? scan.columns[column] : undefined;
  const pendingInView = filtered.filter((i) => !isDecided(i)).length;
  const decidedInView = filtered.length - pendingInView;
  const viewKinds = new Set(filtered.map((i) => i.kind));

  return (
    <div className="review">
      <div className="section-title">
        <ClipboardCheck size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
        Examen manuel des cellules vides et des valeurs atypiques
      </div>
      <p className="hint review-intro">
        Décidez cellule par cellule de ce qui doit être fait, après examen. Une décision
        prévaut toujours sur les réglages automatiques ci-dessus ; sans décision, la cellule
        suit le réglage automatique (colonne « Sans décision »). Les décisions sont propres à
        cette feuille, conservées si vous ajustez le nettoyage, et reprises avec leur
        justification dans le journal et les exports.
      </p>

      <div className="review-filters">
        <div className="chip-picker" role="group" aria-label="Filtrer">
          {(
            [
              ["all", `Tout (${scan.issues.length})`],
              ["missing", `Cellules vides (${counts.missing})`],
              ["outlier", `Valeurs atypiques (${counts.outlier})`],
              ["pending", `À décider (${counts.pending})`],
              ["decided", `Décidées (${counts.decided})`],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={"chip" + (filter === id ? " active" : "")}
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={column}
          aria-label="Colonne"
          onChange={(e) => {
            setColumn(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Toutes les colonnes</option>
          {dataset.columns
            .filter((c) => byColumn.has(c))
            .map((c) => (
              <option key={c} value={c}>
                {c} ({byColumn.get(c)})
              </option>
            ))}
        </select>
      </div>

      {column && colStats && filtered.length > 0 && (
        <div className="review-bulk">
          <span>
            <strong>{column}</strong>
            {colStats.numeric &&
              ` — moyenne ${formatValue(colStats.mean)}, médiane ${formatValue(colStats.median)}` +
                (colStats.low !== undefined ? `, bornes ${formatValue(colStats.low)} à ${formatValue(colStats.high)}` : "")}
            {!colStats.numeric && colStats.mode !== undefined && ` — valeur la plus fréquente : ${formatValue(colStats.mode)}`}
          </span>
          {pendingInView > 0 && (
            <span className="review-bulk-actions">
              Pour les {pendingInView} cellule(s) sans décision affichées :
              <button type="button" className="btn small" onClick={() => bulk("keep", true)}>
                Laisser telles quelles
              </button>
              {viewKinds.has("missing") && !viewKinds.has("outlier") && colStats.numeric && colStats.median !== undefined && (
                <>
                  <button type="button" className="btn small" onClick={() => bulk("median", true)}>
                    Médiane
                  </button>
                  <button type="button" className="btn small" onClick={() => bulk("mean", true)}>
                    Moyenne
                  </button>
                </>
              )}
              {viewKinds.has("missing") && !viewKinds.has("outlier") && colStats.mode !== undefined && (
                <button type="button" className="btn small" onClick={() => bulk("mode", true)}>
                  Valeur la plus fréquente
                </button>
              )}
              {viewKinds.has("outlier") && !viewKinds.has("missing") && (
                <button type="button" className="btn small" onClick={() => bulk("cap", true)}>
                  Plafonner aux bornes
                </button>
              )}
            </span>
          )}
          {decidedInView > 0 && (
            <button type="button" className="link-btn" onClick={() => bulk("auto", false)}>
              Annuler les {decidedInView} décision(s) affichées
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="hint">Aucune cellule pour ce filtre.</p>
      ) : (
        <div className="table-wrap">
          <table className="data review-table">
            <thead>
              <tr>
                <th>Ligne</th>
                <th>Colonne</th>
                <th>Valeur</th>
                <th>Contexte de la ligne</th>
                <th>Sans décision</th>
                <th>Décision</th>
                <th>Justification</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <IssueRow
                  key={i.key}
                  issue={i}
                  stats={scan.columns[i.column] ?? { numeric: false }}
                  context={context(i)}
                  auto={automaticOutcome(i, scan.columns[i.column], options)}
                  choice={choiceOf(i)}
                  customValue={(() => {
                    const d = cellMap.get(i.key);
                    return d?.decision.action === "set" ? formatInput(d.decision.value) : "";
                  })()}
                  note={removed.get(i.row)?.note ?? cellMap.get(i.key)?.note ?? ""}
                  onChoice={(c) => onChange(decide(review, i, c))}
                  onCustom={(v) => onChange(setCellDecision(review, i, { action: "set", value: v }))}
                  onNote={(n) => onChange(setNote(review, i, n))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="review-pager">
          <button type="button" className="btn small" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Précédent
          </button>
          <span className="hint">
            {current * PAGE + 1}–{Math.min(filtered.length, (current + 1) * PAGE)} sur {filtered.length}
          </span>
          <button type="button" className="btn small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Suivant
          </button>
        </div>
      )}
      <p className="hint" style={{ marginTop: 6 }}>
        Numéros de ligne : lignes de données de la feuille d&apos;origine (en-tête exclu), comme
        dans l&apos;aperçu des données brutes.
      </p>
    </div>
  );
}

function formatInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function IssueRow({
  issue,
  stats,
  context,
  auto,
  choice,
  customValue,
  note,
  onChoice,
  onCustom,
  onNote,
}: {
  issue: ReviewIssue;
  stats: ColumnSuggestions;
  context: string;
  auto: string;
  choice: Choice;
  customValue: string;
  note: string;
  onChoice: (c: Choice) => void;
  onCustom: (v: string) => void;
  onNote: (n: string) => void;
}) {
  const missing = issue.kind === "missing";
  const capTarget =
    !missing && stats.high !== undefined && (toNumber(issue.value) ?? 0) > stats.high ? stats.high : stats.low;
  const invalid = choice === "custom" && stats.numeric && customValue.trim() !== "" && toNumber(customValue) === null;
  return (
    <tr className={"review-row" + (choice === "auto" ? "" : " decided") + (choice === "drop" ? " dropped" : "")}>
      <td className="num">{issue.row + 1}</td>
      <td>{issue.column}</td>
      <td className={missing ? "" : "num"}>
        {missing ? (
          <span className="cell-empty">vide</span>
        ) : (
          <span className="review-outlier" title={`Hors bornes : ${formatValue(stats.low)} à ${formatValue(stats.high)}`}>
            {formatValue(issue.value)}
          </span>
        )}
      </td>
      <td className="review-context" title={context}>
        {context}
        {issue.duplicate && <span className="pill review-dup">doublon</span>}
      </td>
      <td className="review-auto">{auto}</td>
      <td className="review-decision">
        <select value={choice} onChange={(e) => onChoice(e.target.value as Choice)} aria-label={`Décision ligne ${issue.row + 1}, ${issue.column}`}>
          <option value="auto">Automatique</option>
          {missing ? (
            <>
              <option value="keep">Laisser vide</option>
              <option value="custom">Saisir une valeur…</option>
              {stats.numeric && stats.mean !== undefined && <option value="mean">Moyenne : {formatValue(stats.mean)}</option>}
              {stats.numeric && stats.median !== undefined && <option value="median">Médiane : {formatValue(stats.median)}</option>}
              {stats.mode !== undefined && <option value="mode">Plus fréquente : {formatValue(stats.mode)}</option>}
            </>
          ) : (
            <>
              <option value="keep">Conserver la valeur</option>
              <option value="custom">Corriger la valeur…</option>
              {capTarget !== undefined && <option value="cap">Plafonner : {formatValue(capTarget)}</option>}
              <option value="clear">Vider la cellule</option>
            </>
          )}
          <option value="drop">Supprimer la ligne</option>
        </select>
        {choice === "custom" && (
          <input
            type="text"
            className={invalid ? "invalid" : undefined}
            value={customValue}
            placeholder={stats.numeric ? "Nombre" : "Valeur"}
            aria-label="Nouvelle valeur"
            autoFocus
            onChange={(e) => onCustom(e.target.value)}
          />
        )}
        {invalid && <span className="review-error">Nombre attendu</span>}
      </td>
      <td>
        <input
          type="text"
          className="review-note"
          value={note}
          disabled={choice === "auto"}
          placeholder={choice === "auto" ? "—" : "Motif, source…"}
          aria-label="Justification"
          onChange={(e) => onNote(e.target.value)}
        />
      </td>
    </tr>
  );
}
