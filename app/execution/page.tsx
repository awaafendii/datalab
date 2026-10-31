"use client";

import { useState } from "react";
import { CheckCircle2, Database, Wallet } from "lucide-react";
import AppNav from "@/components/AppNav";
import FileUpload from "@/components/FileUpload";
import ExecutionView from "@/components/execution/ExecutionView";
import type { WorkbookInput } from "@/lib/types";

// Module « Suivi d'exécution budgétaire » : on charge un tableau d'exécution
// (dotations / engagements / paiements) et DataLab calcule les taux, repère
// les dépassements et sous-consommations, et rapproche éventuellement le total
// des crédits votés de la loi de finances. 100 % navigateur, comme le reste.
export default function ExecutionPage() {
  const [workbook, setWorkbook] = useState<WorkbookInput | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const active = workbook?.sheets[activeIndex] ?? null;
  const stage = workbook ? 1 : 0;

  const reset = () => {
    setWorkbook(null);
    setActiveIndex(0);
  };

  return (
    <>
      <header className="app-header">
        <div className="inner">
          <div className="logo">
            <span className="badge">
              <Database size={20} />
            </span>
            DataLab
          </div>
          <AppNav />
          <span className="tag">Suivi d&apos;exécution budgétaire · 100% navigateur</span>
        </div>
      </header>

      <main className="container">
        <div className="stepper">
          {["Charger le tableau d'exécution", "Suivre & contrôler"].map((label, i) => (
            <div key={label} className={"step" + (i === stage ? " active" : "") + (i < stage ? " done" : "")}>
              <span className="num">{i < stage ? <CheckCircle2 size={14} /> : i + 1}</span>
              {label}
            </div>
          ))}
        </div>

        {!workbook ? (
          <>
            <FileUpload
              onLoaded={(wb) => {
                setWorkbook(wb);
                setActiveIndex(0);
              }}
            />
            <div className="card">
              <h2>
                <Wallet size={20} /> À quoi sert ce module
              </h2>
              <p className="subtitle">
                Chargez un état d&apos;exécution (CSV ou Excel) avec, par ligne (programme, action, titre
                ou imputation), au moins une colonne de <b>dotation</b> (crédits ouverts / votés) et une
                colonne d&apos;<b>engagements</b> ou de <b>paiements</b>. DataLab reconnaît automatiquement
                ces colonnes — vous pouvez les corriger — puis calcule :
              </p>
              <ul className="obs">
                <li>le <b>taux d&apos;engagement</b> et le <b>taux d&apos;exécution</b> (paiements / dotation), par ligne et au total ;</li>
                <li>le <b>disponible</b> restant (dotation − engagements) ;</li>
                <li>les <b>dépassements</b> de dotation (bloquant), les paiements supérieurs aux engagements, les crédits dotés mais <b>non exécutés</b> et les <b>sous-consommations</b> ;</li>
                <li>un <b>rapprochement facultatif</b> du total des dotations avec les crédits votés d&apos;une section de la loi de finances en vigueur.</li>
              </ul>
              <p className="hint">
                Vos données ne quittent pas votre navigateur. Astuce : excluez les lignes de total du
                fichier ou nommez-les « Total » — elles sont détectées et retirées des agrégats.
              </p>
            </div>
          </>
        ) : (
          <>
            {workbook.sheets.length > 1 && (
              <div className="sheet-tabs">
                {workbook.sheets.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    className={"sheet-tab" + (i === activeIndex ? " active" : "")}
                    onClick={() => setActiveIndex(i)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {workbook.skippedSheets.length > 0 && (
              <p className="hint" style={{ marginBottom: 16 }}>
                Feuille(s) ignorée(s) car vides ou sans tableau exploitable : {workbook.skippedSheets.join(", ")}.
              </p>
            )}

            {active && <ExecutionView key={active.name} dataset={active.dataset} />}

            <div className="card">
              <h2>Changer de fichier</h2>
              <div className="btn-row">
                <button className="btn" onClick={reset}>
                  Charger un autre tableau d&apos;exécution
                </button>
              </div>
            </div>
          </>
        )}

        <p className="foot">
          DataLab — suivi d&apos;exécution budgétaire 100 % local. Les taux et alertes sont des contrôles
          automatiques : ils doivent être validés au regard des pièces justificatives.
        </p>
      </main>
    </>
  );
}
