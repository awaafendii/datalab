"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, EyeOff, RotateCcw, Wrench } from "lucide-react";
import type { Anomaly, AnomalyCategory, AnomalyStatus, Severity } from "@/lib/documents/types";
import { SEVERITY_ORDER } from "@/lib/documents/types";
import { CATEGORY_LABEL, SEVERITY_LABEL, STATUS_LABEL, locationText } from "@/lib/documents/export";

interface Props {
  anomalies: Anomaly[];
  statuses: Record<string, AnomalyStatus>;
  onStatus: (id: string, status: AnomalyStatus) => void;
  emptyText?: string;
}

type Show = "a-traiter" | "toutes" | "traitees";
const SEVERITIES = Object.keys(SEVERITY_ORDER) as Severity[];

// Liste des anomalies avec filtres (gravité, catégorie, statut) et suivi du
// traitement par le relecteur : rien n'est corrigé automatiquement, chaque
// proposition est validée ou écartée par un humain.
export default function AnomalyList({ anomalies, statuses, onStatus, emptyText }: Props) {
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [category, setCategory] = useState<AnomalyCategory | "all">("all");
  const [show, setShow] = useState<Show>("a-traiter");

  const statusOf = (a: Anomaly) => statuses[a.id] ?? "a-traiter";
  const bySeverity = useMemo(() => {
    const c: Record<Severity, number> = { bloquante: 0, majeure: 0, mineure: 0, info: 0 };
    for (const a of anomalies) if ((statuses[a.id] ?? "a-traiter") === "a-traiter") c[a.severity]++;
    return c;
  }, [anomalies, statuses]);
  const categories = useMemo(() => [...new Set(anomalies.map((a) => a.category))], [anomalies]);

  const visible = anomalies.filter((a) => {
    if (!severities.has(a.severity)) return false;
    if (category !== "all" && a.category !== category) return false;
    const s = statusOf(a);
    if (show === "a-traiter") return s === "a-traiter";
    if (show === "traitees") return s !== "a-traiter";
    return true;
  });
  const done = anomalies.filter((a) => statusOf(a) !== "a-traiter").length;

  if (!anomalies.length) {
    return <p className="hint">{emptyText ?? "Aucune anomalie détectée par les contrôles automatiques."}</p>;
  }

  const toggle = (s: Severity) => {
    const next = new Set(severities);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSeverities(next.size ? next : new Set(SEVERITIES));
  };

  return (
    <div>
      <div className="filters">
        <div className="group" role="group" aria-label="Gravité">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" className={"chip" + (severities.has(s) ? " active" : "")} onClick={() => toggle(s)} aria-pressed={severities.has(s)}>
              <span className={"sev-pill " + s}>{SEVERITY_LABEL[s]}</span>
              <span className="n">{bySeverity[s]}</span>
            </button>
          ))}
        </div>
        <div className="group">
          <select value={category} onChange={(e) => setCategory(e.target.value as AnomalyCategory | "all")} aria-label="Catégorie">
            <option value="all">Toutes les catégories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Statut">
            <option value="a-traiter">À traiter ({anomalies.length - done})</option>
            <option value="traitees">Traitées ({done})</option>
            <option value="toutes">Toutes ({anomalies.length})</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="hint">Aucune anomalie ne correspond à ces filtres.</p>
      ) : (
        <ul className="anomalies">
          {visible.map((a) => {
            const s = statusOf(a);
            const loc = locationText(a.location);
            return (
              <li key={a.id} className={`anomaly ${a.severity}${s !== "a-traiter" ? " done" : ""}`}>
                <div className="head">
                  <span className={"sev-pill " + a.severity}>{SEVERITY_LABEL[a.severity]}</span>
                  <span className="title">{a.title}</span>
                  <span className="cat">· {CATEGORY_LABEL[a.category]}</span>
                  {s !== "a-traiter" && <span className="status-tag">{STATUS_LABEL[s]}</span>}
                </div>
                {loc && <div className="loc">{loc}</div>}
                <p className="detail">{a.detail}</p>
                {a.excerpt && <blockquote className="excerpt">« {a.excerpt} »</blockquote>}
                <div className="fix">
                  <Wrench size={15} />
                  <span>
                    <b>Correction proposée :</b> {a.suggestion}
                  </span>
                </div>
                <div className="actions">
                  {s === "a-traiter" ? (
                    <>
                      <button type="button" className="btn small" onClick={() => onStatus(a.id, "corrigee")}>
                        <CheckCircle2 size={15} /> Marquer corrigée
                      </button>
                      <button type="button" className="btn small" onClick={() => onStatus(a.id, "ignoree")} title="Faux positif ou sans objet : ne sera pas repris dans le rapport">
                        <EyeOff size={15} /> Ignorer
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn small" onClick={() => onStatus(a.id, "a-traiter")}>
                      <RotateCcw size={15} /> Remettre à traiter
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
