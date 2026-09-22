"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Brain,
  CheckCircle2,
  Database,
  Eye,
  Sparkles,
  Wand2,
} from "lucide-react";
import FileUpload from "@/components/FileUpload";
import SheetTabs from "@/components/SheetTabs";
import DataTable from "@/components/DataTable";
import ProfileView from "@/components/ProfileView";
import CleaningPanel from "@/components/CleaningPanel";
import Charts from "@/components/Charts";
import MLPanel from "@/components/MLPanel";
import ExportBar from "@/components/ExportBar";
import { profileDataset } from "@/lib/profile";
import { cleanDataset } from "@/lib/clean";
import { analyzeDataset } from "@/lib/analyze";
import {
  DEFAULT_CLEANING,
  type CleaningOptions,
  type SheetState,
  type WorkbookInput,
} from "@/lib/types";

type Stage = "upload" | "workspace";

export default function Home() {
  const [workbook, setWorkbook] = useState<WorkbookInput | null>(null);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("upload");
  const [working, setWorking] = useState(false);

  const active = sheets[activeIndex] ?? null;

  const rawProfile = useMemo(
    () => (active ? profileDataset(active.dataset) : null),
    [active],
  );

  const onLoaded = (wb: WorkbookInput) => {
    setWorkbook(wb);
    setSheets(
      wb.sheets.map((s) => ({
        name: s.name,
        dataset: s.dataset,
        options: DEFAULT_CLEANING,
        result: null,
        analysis: null,
      })),
    );
    setActiveIndex(0);
    setStage("workspace");
  };

  const setActiveOptions = (opts: CleaningOptions) => {
    setSheets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, options: opts } : s)),
    );
  };

  // Nettoie uniquement la feuille active, avec ses propres réglages.
  const runActive = () => {
    setWorking(true);
    setTimeout(() => {
      setSheets((prev) =>
        prev.map((s, i) => {
          if (i !== activeIndex) return s;
          const res = cleanDataset(s.dataset, s.options);
          const ana = analyzeDataset(res.dataset);
          return { ...s, result: res, analysis: ana };
        }),
      );
      setWorking(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  };

  // Applique les réglages de la feuille active à toutes les feuilles pas
  // encore nettoyées et les nettoie en une fois. Chaque feuille garde un
  // résultat et une analyse indépendants ; c'est une commodité de saisie,
  // pas une fusion des données.
  const runAllPendingWithActiveOptions = () => {
    if (!active) return;
    const opts = active.options;
    setWorking(true);
    setTimeout(() => {
      setSheets((prev) =>
        prev.map((s) => {
          if (s.result !== null) return s;
          const res = cleanDataset(s.dataset, opts);
          const ana = analyzeDataset(res.dataset);
          return { ...s, options: opts, result: res, analysis: ana };
        }),
      );
      setWorking(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  };

  // Revient au panneau de nettoyage pour la feuille active (garde ses réglages).
  const adjustActive = () => {
    setSheets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, result: null, analysis: null } : s)),
    );
  };

  const reset = () => {
    setWorkbook(null);
    setSheets([]);
    setActiveIndex(0);
    setStage("upload");
  };

  const cleanedSheets = sheets.filter((s) => s.result !== null && s.analysis !== null);
  const otherPendingCount = sheets.filter(
    (s, i) => i !== activeIndex && s.result === null,
  ).length;

  const steps: { key: Stage; label: string }[] = [
    { key: "upload", label: "Charger" },
    { key: "workspace", label: "Nettoyer, analyser & exporter" },
  ];
  const stageIndex = steps.findIndex((s) => s.key === stage);

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
          <span className="tag">Analyse de données · 100% navigateur</span>
        </div>
      </header>

      <main className="container">
        <div className="stepper">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={
                "step" +
                (i === stageIndex ? " active" : "") +
                (i < stageIndex ? " done" : "")
              }
            >
              <span className="num">
                {i < stageIndex ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              {s.label}
            </div>
          ))}
        </div>

        {stage === "upload" && <FileUpload onLoaded={onLoaded} />}

        {stage === "workspace" && workbook && active && rawProfile && (
          <>
            {sheets.length > 1 && (
              <SheetTabs
                sheets={sheets}
                activeIndex={activeIndex}
                onSelect={setActiveIndex}
              />
            )}

            {active.result === null || active.analysis === null ? (
              <>
                <div className="card">
                  <h2>
                    <Eye size={20} /> Aperçu — {workbook.fileName}
                    {sheets.length > 1 ? ` · ${active.name}` : ""}
                  </h2>
                  <p className="subtitle">
                    Voici comment le fichier a été interprété. Vérifiez les
                    types détectés avant de nettoyer.
                  </p>
                  <ProfileView profile={rawProfile} />
                  <div className="section-title">Données brutes</div>
                  <DataTable dataset={active.dataset} />
                </div>

                <div className="card">
                  <h2>
                    <Wand2 size={20} /> Options de nettoyage & apurement
                    {sheets.length > 1 ? ` — ${active.name}` : ""}
                  </h2>
                  <p className="subtitle">
                    Ces réglages par défaut conviennent à la plupart des
                    fichiers. Ajustez-les si besoin. Chaque feuille a ses
                    propres réglages et son propre résultat.
                  </p>
                  <CleaningPanel options={active.options} onChange={setActiveOptions} />
                  <div className="btn-row">
                    <button
                      className="btn primary"
                      onClick={runActive}
                      disabled={working}
                    >
                      {working ? <span className="spinner" /> : <Sparkles size={18} />}
                      Nettoyer et analyser cette feuille
                    </button>
                    {otherPendingCount > 0 && (
                      <button
                        className="btn"
                        onClick={runAllPendingWithActiveOptions}
                        disabled={working}
                      >
                        Appliquer ces réglages aux {otherPendingCount} autre(s)
                        feuille(s) non nettoyée(s)
                      </button>
                    )}
                    <button className="btn" onClick={reset} disabled={working}>
                      Changer de fichier
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="card">
                  <h2>
                    <CheckCircle2 size={20} color="var(--success)" /> Nettoyage
                    effectué{sheets.length > 1 ? ` — ${active.name}` : ""}
                  </h2>
                  <p className="subtitle">
                    {active.result.rowsBefore.toLocaleString("fr-FR")} →{" "}
                    {active.result.rowsAfter.toLocaleString("fr-FR")} ligne(s)
                    après traitement.
                  </p>
                  <ul className="steps-log">
                    {active.result.steps.map((s, i) => (
                      <li key={i}>
                        <span className="ico">
                          <CheckCircle2 size={16} />
                        </span>
                        <span>
                          <span className="t">{s.label}</span>
                          <br />
                          <span className="d">{s.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="card">
                  <h2>
                    <Sparkles size={20} /> Observations & appréciations
                  </h2>
                  <ul className="obs">
                    {active.analysis.observations.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>

                <div className="card">
                  <h2>
                    <Database size={20} /> Profil après nettoyage
                  </h2>
                  <ProfileView profile={active.analysis.profile} />
                </div>

                <div className="card">
                  <h2>
                    <BarChart3 size={20} /> Analyse visuelle
                  </h2>
                  <p className="subtitle">
                    Distributions des variables numériques, fréquences des
                    variables catégorielles et corrélations.
                  </p>
                  <Charts analysis={active.analysis} />
                </div>

                <div className="card">
                  <h2>
                    <Brain size={20} /> Machine learning — clustering & régression
                  </h2>
                  <p className="subtitle">
                    Explorez des groupes homogènes (k-means) ou modélisez une
                    variable numérique à partir des autres (régression
                    linéaire). Tout est calculé dans votre navigateur, comme
                    le reste de DataLab.
                  </p>
                  <MLPanel
                    key={workbook.fileName + ":" + active.name + ":" + active.result.rowsAfter}
                    dataset={active.result.dataset}
                    profile={active.analysis.profile}
                  />
                </div>

                <div className="card">
                  <h2>
                    <Eye size={20} /> Données nettoyées
                  </h2>
                  <DataTable dataset={active.result.dataset} />
                  <div className="btn-row">
                    <button className="btn" onClick={adjustActive}>
                      Ajuster le nettoyage de cette feuille
                    </button>
                    <button className="btn" onClick={reset}>
                      Nouveau fichier
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="card">
              <h2>
                <Sparkles size={20} /> Exporter les résultats
                {sheets.length > 1 ? " — toutes feuilles" : ""}
              </h2>
              {sheets.length > 1 && (
                <p className="subtitle">
                  {cleanedSheets.length}/{sheets.length} feuille(s) nettoyée(s).
                  L&apos;export regroupe toutes les feuilles déjà nettoyées en
                  un seul fichier.
                </p>
              )}
              {cleanedSheets.length === 0 ? (
                <p className="hint">
                  Nettoyez au moins une feuille pour activer l&apos;export.
                </p>
              ) : (
                <ExportBar
                  fileName={workbook.fileName}
                  sheets={cleanedSheets.map((s) => ({
                    name: s.name,
                    dataset: s.result!.dataset,
                    analysis: s.analysis!,
                  }))}
                />
              )}
            </div>
          </>
        )}

        <p className="foot">
          DataLab — vos données ne quittent jamais votre navigateur. Nettoyage,
          apurement, analyse et export XLSX / PDF / Word.
        </p>
      </main>
    </>
  );
}
