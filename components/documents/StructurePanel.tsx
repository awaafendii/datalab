"use client";

import { ListTree } from "lucide-react";
import type { DocAnalysis, IndicatorRecord } from "@/lib/documents/types";
import { billions } from "./DocumentOverview";

const TYPE_LABEL: Record<IndicatorRecord["type"], string> = {
  pourcentage: "Taux / %",
  nombre: "Nombre",
  montant: "Montant",
  delai: "Délai",
  jalon: "Jalon",
  ratio: "Ratio",
  "non-type": "À préciser",
};

// Tableau consolidé des indicateurs (d'un document ou de tous les documents
// chargés), quelle que soit la direction qui les a produits.
export function IndicatorTable({ rows, withDocument = false }: { rows: (IndicatorRecord & { document?: string })[]; withDocument?: boolean }) {
  return (
    <div className="table-wrap tall">
      <table className="data">
        <thead>
          <tr>
            {withDocument && <th>Document</th>}
            <th>Direction / structure</th>
            <th>Activité</th>
            <th>Indicateur</th>
            <th>Type</th>
            <th>Référence</th>
            <th>Cible</th>
            <th>Réalisé</th>
            <th>Taux</th>
            <th>Source de vérification</th>
            <th>Période</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {withDocument && <td>{r.document}</td>}
              <td>{r.department ?? "—"}</td>
              <td>{r.activity ?? "—"}</td>
              <td>{r.label}</td>
              <td>
                <span className={"pill" + (r.type === "non-type" ? " date" : " number")}>{TYPE_LABEL[r.type]}</span>
              </td>
              <td className="num">{r.reference ?? <span className="cell-empty">vide</span>}</td>
              <td className="num">{r.target ?? <span className="cell-empty">vide</span>}</td>
              <td className="num">{r.achieved ?? <span className="cell-empty">vide</span>}</td>
              <td className="num">{r.rate ?? "—"}</td>
              <td>{r.verification ?? "—"}</td>
              <td>{r.period ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Le document « structuré » : plan reconstitué, tableaux extraits et
// indicateurs, tels que DataLab les a compris.
// Rapprochement des montants du document avec la loi de finances en vigueur.
function LfComparison({ budget }: { budget: NonNullable<DocAnalysis["budget"]> }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Poste</th>
            <th>Colonne</th>
            <th>Document</th>
            <th>Loi de finances</th>
            <th>Écart</th>
          </tr>
        </thead>
        <tbody>
          {budget.comparison.map((r, i) => {
            const gap = r.document === null ? null : r.document - r.law;
            const off = gap !== null && Math.abs(gap) >= 1;
            return (
              <tr key={i} className={r.level === 0 ? "strong" : undefined}>
                <td style={{ paddingLeft: 10 + r.level * 18 }}>{r.scope}</td>
                <td>{r.column}</td>
                <td className="num">{r.document === null ? "—" : billions(r.document)}</td>
                <td className="num">{billions(r.law)}</td>
                <td className={"num" + (off ? " gap" : "")}>{gap === null ? "—" : off ? (gap > 0 ? "+" : "") + billions(gap) : "="}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StructurePanel({ analysis: a }: { analysis: DocAnalysis }) {
  const minLevel = Math.min(...a.outline.map((o) => o.level), 1);
  return (
    <div className="card">
      <h2>
        <ListTree size={20} /> Structure du document
      </h2>
      <p className="subtitle">
        Ce que DataLab a compris du document : son plan (titres stylés ou déduits de la mise en forme),
        ses tableaux et ses indicateurs. Tout est repris dans l&apos;export Excel.
      </p>

      {a.budget && a.budget.comparison.length > 0 && (
        <details className="panel" open>
          <summary>
            Rapprochement avec la LF {a.budget.annee} — section {a.budget.section.code}
          </summary>
          <p className="hint">
            Montants du document (colonnes {a.budget.annee} et LFR {a.budget.anneeLfr}) comparés aux crédits de la loi de
            finances ({a.budget.source}) : total de la section, programmes et titres (nature économique).
          </p>
          <LfComparison budget={a.budget} />
        </details>
      )}

      <details className="panel" open={a.outline.length > 0 && a.outline.length <= 60}>
        <summary>Plan du document ({a.outline.length} titres)</summary>
        {a.outline.length === 0 ? (
          <p className="hint">Aucun titre reconnu.</p>
        ) : (
          <ul className="outline">
            {a.outline.map((o) => (
              <li key={o.blockId} style={{ paddingLeft: Math.min(5, o.level - minLevel) * 16 }}>
                <span>
                  {o.text}
                  {o.inferred && <span className="inferred" title="Titre déduit de la mise en forme (pas de style Titre dans le fichier)"> · déduit</span>}
                </span>
                {o.anomalyCount > 0 && (
                  <span className="count pill" title="Anomalies dans cette section">
                    {o.anomalyCount}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="panel">
        <summary>Tableaux extraits ({a.tables.length})</summary>
        {a.tables.length === 0 ? (
          <p className="hint">Aucun tableau exploitable.</p>
        ) : (
          a.tables.slice(0, 150).map((t) => (
            <details key={t.blockId} className="sub-table">
              <summary>
                {t.title}{" "}
                <span className="meta">
                  · {t.rows} lignes × {t.cols} colonnes{t.section ? ` · ${t.section.split(" › ").pop()}` : ""}
                </span>
              </summary>
              <div className="table-wrap tall">
                <table className="data">
                  <thead>
                    <tr>
                      {t.header.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.body.slice(0, 40).map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => (
                          <td key={j}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))
        )}
        {a.tables.length > 150 && <p className="hint">… et {a.tables.length - 150} autres tableaux (tous présents dans l&apos;export Excel).</p>}
      </details>

      {a.indicators.length > 0 && (
        <details className="panel" open>
          <summary>Indicateurs structurés ({a.indicators.length})</summary>
          <IndicatorTable rows={a.indicators} />
        </details>
      )}
    </div>
  );
}
