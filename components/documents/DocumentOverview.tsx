"use client";

import { AlertTriangle, CheckCircle2, FileText, XCircle } from "lucide-react";
import type { AnomalyStatus, DocAnalysis, DocKind } from "@/lib/documents/types";
import { KIND_PROFILES, profileOf } from "@/lib/documents/referentiel";
import { counts, verdictOf } from "@/lib/documents/export";
import { LF } from "@/lib/documents/lf";

interface Props {
  analysis: DocAnalysis;
  statuses: Record<string, AnomalyStatus>;
  onKind: (kind: DocKind) => void;
  sectionMode: string; // "" : rattachement automatique, "aucune" : sans section, sinon code choisi
  onSection: (code: string) => void;
}

export const billions = (v: number) => `${(v / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Md GNF`;

const FORMAT_LABEL = { docx: "Word", pdf: "PDF", sheet: "Classeur" } as const;

// Carte d'identité du document : type reconnu (modifiable), directions
// concernées, volume, et décompte des anomalies restant à traiter.
export default function DocumentOverview({ analysis: a, statuses, onKind, sectionMode, onSection }: Props) {
  const c = counts(a.anomalies, statuses);
  const profile = profileOf(a.kind);
  return (
    <div className="card">
      <h2>
        <FileText size={20} /> {a.fileName}
      </h2>
      <p className="subtitle">
        {FORMAT_LABEL[a.format]}
        {a.stats.pages ? ` · ${a.stats.pages} pages` : ""} · {a.stats.words.toLocaleString("fr-FR")} mots ·{" "}
        {a.stats.headings} titres · {a.stats.tables} tableaux
        {a.stats.figures ? ` · ${a.stats.figures} illustrations` : ""}
      </p>

      {(() => {
        const v = verdictOf(a.anomalies, statuses, a.kind);
        const Icon = v.level === "conforme" ? CheckCircle2 : v.level === "reserves" ? AlertTriangle : XCircle;
        return (
          <div className={"verdict " + v.level} role="status">
            <Icon size={20} />
            <div>
              <div className="v-label">Avis : {v.label}</div>
              <div className="v-summary">{v.summary}</div>
            </div>
          </div>
        );
      })()}

      {a.warnings.map((w, i) => (
        <div className="notice warn" key={i}>
          <AlertTriangle size={16} />
          <span>{w}</span>
        </div>
      ))}

      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile wide">
          <div className="label">Type de document</div>
          <div className="field">
            <select value={a.kind} onChange={(e) => onKind(e.target.value as DocKind)} aria-label="Type de document">
              {KIND_PROFILES.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.label}
                  {p.kind === a.kindDetected ? " (détecté)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="sub">
            {a.kind === a.kindDetected
              ? `Reconnu d'après ${a.kindReasons.join(", ") || "le contenu"}.`
              : "Type choisi manuellement : les sections attendues et les contrôles s'adaptent."}{" "}
            {profile.description}
          </div>
        </div>
        <div className="tile wide">
          <div className="label">Direction(s) / structure(s) concernée(s)</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>
            {a.departments.length ? a.departments.map((d) => d.label).join(" · ") : "Non déterminée"}
          </div>
          {a.departments[0]?.evidence.length ? (
            <div className="sub">Indices : {a.departments.flatMap((d) => d.evidence).slice(0, 6).join(", ")}</div>
          ) : null}
        </div>
        {a.kind !== "loi-finances" && (
          <div className="tile wide">
            <div className="label">Section budgétaire (LF {LF.annee})</div>
            <div className="field">
              <select
                value={a.budget ? a.budget.section.code : sectionMode === "aucune" ? "aucune" : ""}
                onChange={(e) => onSection(e.target.value)}
                aria-label="Section budgétaire de la loi de finances"
              >
                <option value="">Rattachement automatique</option>
                <option value="aucune">Aucune section</option>
                {LF.sections.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="sub">
              {a.budget ? (
                <>
                  {a.budget.manual ? "Section choisie manuellement." : `Reconnue d'après « ${a.budget.evidence} ».`} LF {a.budget.annee} :{" "}
                  {billions(a.budget.section.lf)} · LFR {a.budget.anneeLfr} : {billions(a.budget.section.lfr)} ·{" "}
                  {a.budget.section.programmes.length
                    ? `programmes ${a.budget.section.programmes.map((p) => p.code).join(", ")}`
                    : "pas de budget-programme dans la LF"}
                  .
                </>
              ) : (
                "Aucun ministère reconnu : choisissez la section pour comparer les montants, programmes et imputations à la loi de finances."
              )}
            </div>
          </div>
        )}
      </div>

      <div className="tiles">
        <div className="tile sev bloquante">
          <div className="value">{c.bloquante}</div>
          <div className="label">Bloquantes</div>
        </div>
        <div className="tile sev majeure">
          <div className="value">{c.majeure}</div>
          <div className="label">Majeures</div>
        </div>
        <div className="tile sev mineure">
          <div className="value">{c.mineure}</div>
          <div className="label">Mineures</div>
        </div>
        <div className="tile sev info">
          <div className="value">{c.info}</div>
          <div className="label">Informations</div>
        </div>
        <div className="tile good">
          <div className="value">{c.traitees}</div>
          <div className="label">Traitées</div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Bloquante : le document ne peut pas être diffusé en l&apos;état · Majeure : erreur de fond ou
        incohérence à corriger · Mineure : forme, clarté · Info : point d&apos;attention.
      </p>
    </div>
  );
}
