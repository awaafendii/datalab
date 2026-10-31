"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Scale, Wallet } from "lucide-react";
import type { Dataset } from "@/lib/types";
import { fmt } from "@/lib/documents/text";
import { LF } from "@/lib/documents/lf";
import { detectColumns } from "@/lib/execution/columns";
import { analyzeExecution } from "@/lib/execution/analyze";
import type { ExecColumnMapping, ExecStatus, ExecSeverity } from "@/lib/execution/types";

const STATUS_COLOR: Record<ExecStatus, string> = {
  depassement: "var(--danger)",
  "non-execute": "var(--warning)",
  "sous-execution": "var(--warning)",
  normal: "var(--success)",
  indetermine: "var(--muted)",
};

const STATUS_LABEL: Record<ExecStatus, string> = {
  depassement: "Dépassement",
  "non-execute": "Non exécuté",
  "sous-execution": "Sous-exécution",
  normal: "Normal",
  indetermine: "—",
};

const SEVERITY_LABEL: Record<ExecSeverity, string> = {
  bloquante: "Bloquante",
  majeure: "Majeure",
  mineure: "Mineure",
  info: "Info",
};

function pct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)} %`;
}
function money(x: number | null): string {
  return x === null ? "—" : fmt(x, 0);
}

type Role = keyof ExecColumnMapping;
const ROLE_LABEL: Record<Role, string> = {
  label: "Libellé",
  code: "Code / imputation",
  dotation: "Dotation (crédits ouverts)",
  engagement: "Engagements",
  paiement: "Paiements",
};

export default function ExecutionView({ dataset }: { dataset: Dataset }) {
  const [mapping, setMapping] = useState<ExecColumnMapping>(() => detectColumns(dataset));
  const [lfSection, setLfSection] = useState<string>("");

  // Re-détecte le mappage quand on change de feuille / fichier.
  useEffect(() => {
    setMapping(detectColumns(dataset));
    setLfSection("");
  }, [dataset]);

  const report = useMemo(
    () => analyzeExecution(dataset, mapping, { lfSectionCode: lfSection || null }),
    [dataset, mapping, lfSection],
  );

  const sections = useMemo(
    () => [...LF.sections].sort((a, b) => a.code.localeCompare(b.code)),
    [],
  );

  const setRole = (role: Role, value: string) =>
    setMapping((m) => ({ ...m, [role]: value || null }));

  const sevCount = (sev: ExecSeverity) => report.alerts.filter((a) => a.severity === sev).length;

  return (
    <>
      <div className="card">
        <h2>
          <Scale size={20} /> Colonnes du fichier
        </h2>
        <p className="subtitle">
          DataLab a deviné le rôle de chaque colonne. Corrigez si nécessaire —
          le suivi se recalcule aussitôt.
        </p>
        <div className="form-grid">
          {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
            <div key={role} className="field">
              <label>{ROLE_LABEL[role]}</label>
              <select value={mapping[role] ?? ""} onChange={(e) => setRole(role, e.target.value)}>
                <option value="">(aucune)</option>
                {dataset.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="field">
            <label>Rapprocher avec la loi de finances (facultatif)</label>
            <select value={lfSection} onChange={(e) => setLfSection(e.target.value)}>
              <option value="">(aucun rapprochement)</option>
              {sections.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.nom}
                </option>
              ))}
            </select>
          </div>
        </div>

        {report.warnings.length > 0 && (
          <ul className="hint" style={{ marginTop: 12 }}>
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>
          <Wallet size={20} /> Synthèse de l&apos;exécution
        </h2>
        <div className="kpi-row">
          <div className="kpi">
            <span className="k-label">Dotation totale</span>
            <span className="k-value">{money(report.totals.dotation)}</span>
          </div>
          <div className="kpi">
            <span className="k-label">Engagements</span>
            <span className="k-value">{money(report.totals.engagement)}</span>
            <span className="k-sub">taux {pct(report.totals.tauxEngagement)}</span>
          </div>
          <div className="kpi">
            <span className="k-label">Paiements</span>
            <span className="k-value">{money(report.totals.paiement)}</span>
            <span className="k-sub">taux d&apos;exécution {pct(report.totals.tauxExecution)}</span>
          </div>
          <div className="kpi">
            <span className="k-label">Disponible</span>
            <span
              className="k-value"
              style={{ color: report.totals.disponible < 0 ? "var(--danger)" : undefined }}
            >
              {money(report.totals.disponible)}
            </span>
          </div>
          <div className="kpi">
            <span className="k-label">Lignes suivies</span>
            <span className="k-value">{report.totals.lignes}</span>
          </div>
        </div>

        {report.reconciliation && (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${report.reconciliation.conforme ? "var(--success)" : "var(--danger)"}`,
              background: "var(--primary-soft)",
            }}
          >
            <b>Rapprochement loi de finances — section {report.reconciliation.sectionCode}</b>
            <div style={{ marginTop: 6 }}>
              Crédits votés : {money(report.reconciliation.creditsVotes)} · Dotations du
              fichier : {money(report.reconciliation.dotationDocument)} · Écart :{" "}
              <b style={{ color: report.reconciliation.conforme ? "var(--success)" : "var(--danger)" }}>
                {money(report.reconciliation.ecart)} ({(report.reconciliation.ecartPct * 100).toFixed(2)} %)
              </b>{" "}
              — {report.reconciliation.conforme ? "conforme" : "écart au-delà de la tolérance"}.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>
          <AlertTriangle size={20} /> Alertes
          {report.alerts.length > 0 && (
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 14 }}>
              {" "}
              · {sevCount("bloquante")} bloquante(s), {sevCount("majeure")} majeure(s),{" "}
              {sevCount("mineure")} mineure(s)
            </span>
          )}
        </h2>
        {report.alerts.length === 0 ? (
          <p className="hint">Aucune alerte : exécution cohérente au regard des contrôles automatiques.</p>
        ) : (
          <div className="table-wrap tall">
            <table className="data">
              <thead>
                <tr>
                  <th>Gravité</th>
                  <th>Ligne</th>
                  <th>Constat</th>
                </tr>
              </thead>
              <tbody>
                {report.alerts.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <span className={"sev-pill " + a.severity}>{SEVERITY_LABEL[a.severity]}</span>
                    </td>
                    <td>{a.label ?? (a.line !== undefined ? `ligne ${a.line + 1}` : "— global")}</td>
                    <td>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Détail par ligne</h2>
        <div className="table-wrap tall">
          <table className="data">
            <thead>
              <tr>
                <th>Statut</th>
                <th>Libellé</th>
                <th className="num">Dotation</th>
                <th className="num">Engagé</th>
                <th className="num">Payé</th>
                <th className="num">Taux exéc.</th>
                <th className="num">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.index} style={l.isTotalRow ? { fontWeight: 600, background: "var(--primary-soft)" } : undefined}>
                  <td>
                    {l.isTotalRow ? (
                      "Total"
                    ) : (
                      <span style={{ color: STATUS_COLOR[l.statut], fontWeight: 500 }}>
                        ● {STATUS_LABEL[l.statut]}
                      </span>
                    )}
                  </td>
                  <td>{l.label}</td>
                  <td className="num">{money(l.dotation)}</td>
                  <td className="num">{money(l.engagement)}</td>
                  <td className="num">{money(l.paiement)}</td>
                  <td className="num" style={{ color: l.isTotalRow ? undefined : STATUS_COLOR[l.statut] }}>
                    {pct(l.tauxExecution)}
                  </td>
                  <td className="num" style={{ color: l.disponible !== null && l.disponible < 0 ? "var(--danger)" : undefined }}>
                    {money(l.disponible)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
