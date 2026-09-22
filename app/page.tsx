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
  type Analysis,
  type CleaningOptions,
  type CleaningResult,
  type Dataset,
} from "@/lib/types";

type Stage = "upload" | "clean" | "results";

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [options, setOptions] = useState<CleaningOptions>(DEFAULT_CLEANING);
  const [result, setResult] = useState<CleaningResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [working, setWorking] = useState(false);

  const rawProfile = useMemo(
    () => (dataset ? profileDataset(dataset) : null),
    [dataset],
  );

  const onLoaded = (ds: Dataset) => {
    setDataset(ds);
    setResult(null);
    setAnalysis(null);
    setOptions(DEFAULT_CLEANING);
    setStage("clean");
  };

  const runPipeline = () => {
    if (!dataset) return;
    setWorking(true);
    // Laisse le spinner s'afficher avant le calcul synchrone.
    setTimeout(() => {
      const res = cleanDataset(dataset, options);
      const ana = analyzeDataset(res.dataset);
      setResult(res);
      setAnalysis(ana);
      setStage("results");
      setWorking(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  };

  const reset = () => {
    setDataset(null);
    setResult(null);
    setAnalysis(null);
    setStage("upload");
  };

  const steps: { key: Stage; label: string }[] = [
    { key: "upload", label: "Charger" },
    { key: "clean", label: "Nettoyer & apurer" },
    { key: "results", label: "Analyser & exporter" },
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

        {stage === "clean" && dataset && rawProfile && (
          <>
            <div className="card">
              <h2>
                <Eye size={20} /> Aperçu — {dataset.fileName}
              </h2>
              <p className="subtitle">
                Voici comment le fichier a été interprété. Vérifiez les types
                détectés avant de nettoyer.
              </p>
              <ProfileView profile={rawProfile} />
              <div className="section-title">Données brutes</div>
              <DataTable dataset={dataset} />
            </div>

            <div className="card">
              <h2>
                <Wand2 size={20} /> Options de nettoyage & apurement
              </h2>
              <p className="subtitle">
                Ces réglages par défaut conviennent à la plupart des fichiers.
                Ajustez-les si besoin.
              </p>
              <CleaningPanel options={options} onChange={setOptions} />
              <div className="btn-row">
                <button
                  className="btn primary"
                  onClick={runPipeline}
                  disabled={working}
                >
                  {working ? <span className="spinner" /> : <Sparkles size={18} />}
                  Nettoyer et analyser
                </button>
                <button className="btn" onClick={reset} disabled={working}>
                  Changer de fichier
                </button>
              </div>
            </div>
          </>
        )}

        {stage === "results" && result && analysis && (
          <>
            <div className="card">
              <h2>
                <CheckCircle2 size={20} color="var(--success)" /> Nettoyage
                effectué
              </h2>
              <p className="subtitle">
                {result.rowsBefore.toLocaleString("fr-FR")} →{" "}
                {result.rowsAfter.toLocaleString("fr-FR")} ligne(s) après
                traitement.
              </p>
              <ul className="steps-log">
                {result.steps.map((s, i) => (
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
                {analysis.observations.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h2>
                <Database size={20} /> Profil après nettoyage
              </h2>
              <ProfileView profile={analysis.profile} />
            </div>

            <div className="card">
              <h2>
                <BarChart3 size={20} /> Analyse visuelle
              </h2>
              <p className="subtitle">
                Distributions des variables numériques, fréquences des variables
                catégorielles et corrélations.
              </p>
              <Charts analysis={analysis} />
            </div>

            <div className="card">
              <h2>
                <Brain size={20} /> Machine learning — clustering & régression
              </h2>
              <p className="subtitle">
                Explorez des groupes homogènes (k-means) ou modélisez une
                variable numérique à partir des autres (régression linéaire).
                Tout est calculé dans votre navigateur, comme le reste de
                DataLab.
              </p>
              <MLPanel
                key={dataset?.fileName + ":" + result.rowsAfter}
                dataset={result.dataset}
                profile={analysis.profile}
              />
            </div>

            <div className="card">
              <h2>
                <Eye size={20} /> Données nettoyées
              </h2>
              <DataTable dataset={result.dataset} />
            </div>

            <div className="card">
              <h2>
                <Sparkles size={20} /> Exporter les résultats
              </h2>
              <ExportBar dataset={result.dataset} analysis={analysis} />
              <div className="btn-row">
                <button className="btn" onClick={() => setStage("clean")}>
                  Ajuster le nettoyage
                </button>
                <button className="btn" onClick={reset}>
                  Nouveau fichier
                </button>
              </div>
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
