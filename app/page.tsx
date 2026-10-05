"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Brain,
  CheckCircle2,
  Database,
  Eye,
  Palette,
  Sparkles,
  Wand2,
} from "lucide-react";
import AppNav from "@/components/AppNav";
import FileUpload from "@/components/FileUpload";
import SheetTabs from "@/components/SheetTabs";
import ContextPanel from "@/components/ContextPanel";
import DataTable from "@/components/DataTable";
import ProfileView from "@/components/ProfileView";
import CleaningPanel from "@/components/CleaningPanel";
import Charts, { type ChartPreset } from "@/components/Charts";
import ChartBuilder from "@/components/charts/ChartBuilder";
import MLPanel from "@/components/MLPanel";
import ExportBar from "@/components/ExportBar";
import ReviewPanel from "@/components/ReviewPanel";
import SessionBar from "@/components/SessionBar";
import {
  clearSession,
  loadSession,
  saveState,
  saveWorkbook,
  sessionEnabled,
  sessionErrorMessage,
  setSessionEnabled,
} from "@/lib/session";
import { profileDataset } from "@/lib/profile";
import { cleanDataset } from "@/lib/clean";
import { analyzeDataset } from "@/lib/analyze";
import { detectContextHeuristic } from "@/lib/sectors";
import { createChart } from "@/lib/charts/catalog";
import { columnInfos } from "@/lib/charts/data";
import type { ChartConfig } from "@/lib/charts/types";
import {
  DEFAULT_CLEANING,
  EMPTY_REVIEW,
  type ManualReview,
  type CleaningOptions,
  type ContextResult,
  type SheetState,
  type WorkbookInput,
} from "@/lib/types";

type Stage = "upload" | "workspace";

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vide";
  return typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : String(v);
}

export default function Home() {
  const [workbook, setWorkbook] = useState<WorkbookInput | null>(null);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("upload");
  const [working, setWorking] = useState(false);
  // Graphique à ouvrir dans le créateur (après « Personnaliser »).
  const [chartFocus, setChartFocus] = useState<string | null>(null);
  // Session mémorisée dans le navigateur (lib/session.ts).
  const [persist, setPersist] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const savedWorkbook = useRef<WorkbookInput | null>(null);

  const active = sheets[activeIndex] ?? null;

  // Au chargement de la page : reprend la session mémorisée. Les résultats
  // de nettoyage et d'analyse sont recalculés à partir des réglages.
  useEffect(() => {
    const on = sessionEnabled();
    setPersist(on);
    if (!on) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    loadSession()
      .then((saved) => {
        if (cancelled || !saved) return;
        const { workbook: wb, state } = saved;
        const restored: SheetState[] = state.sheets.map((s, i) => {
          const dataset = wb.sheets[i].dataset;
          const review = s.review ?? EMPTY_REVIEW;
          const result = s.cleaned ? cleanDataset(dataset, s.options, review) : null;
          return {
            name: s.name,
            dataset,
            options: s.options,
            result,
            analysis: result ? analyzeDataset(result.dataset) : null,
            aiContext: s.aiContext,
            charts: s.charts ?? [],
            review,
          };
        });
        savedWorkbook.current = wb;
        setWorkbook(wb);
        setSheets(restored);
        setActiveIndex(Math.min(Math.max(state.activeIndex, 0), restored.length - 1));
        setStage("workspace");
        setRestoredAt(state.savedAt);
      })
      .catch(() => {
        // stockage indisponible : on démarre simplement sans session
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Enregistre la session à chaque modification (après une courte pause).
  // Le classeur, volumineux, n'est réécrit que si un autre fichier est chargé.
  useEffect(() => {
    if (restoring || !persist || !workbook) return;
    const timer = setTimeout(async () => {
      try {
        if (savedWorkbook.current !== workbook) {
          await saveWorkbook(workbook);
          savedWorkbook.current = workbook;
        }
        await saveState({
          version: 1,
          savedAt: new Date().toISOString(),
          fileName: workbook.fileName,
          activeIndex,
          sheets: sheets.map((s) => ({
            name: s.name,
            options: s.options,
            cleaned: s.result !== null,
            aiContext: s.aiContext,
            charts: s.charts,
            review: s.review,
          })),
        });
        setSessionError(null);
      } catch (e) {
        setSessionError(sessionErrorMessage(e));
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [workbook, sheets, activeIndex, persist, restoring]);

  const togglePersist = (on: boolean) => {
    setSessionEnabled(on);
    setPersist(on);
    setSessionError(null);
    if (!on) {
      savedWorkbook.current = null;
      setRestoredAt(null);
      clearSession();
    }
  };

  const rawProfile = useMemo(
    () => (active ? profileDataset(active.dataset) : null),
    [active],
  );

  const heuristicContext = useMemo(
    () => (active ? detectContextHeuristic(active.dataset.columns, active.name) : null),
    [active],
  );
  const effectiveContext = active?.aiContext ?? heuristicContext;

  const onLoaded = (wb: WorkbookInput) => {
    setWorkbook(wb);
    setSheets(
      wb.sheets.map((s) => ({
        name: s.name,
        dataset: s.dataset,
        options: DEFAULT_CLEANING,
        result: null,
        analysis: null,
        aiContext: null,
        charts: [],
        review: EMPTY_REVIEW,
      })),
    );
    setActiveIndex(0);
    setStage("workspace");
  };

  const setActiveAiContext = (ctx: ContextResult | null) => {
    setSheets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, aiContext: ctx } : s)),
    );
  };

  const setActiveCharts = (charts: ChartConfig[]) => {
    setSheets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, charts } : s)),
    );
  };

  // « Personnaliser » un graphique de l'analyse automatique : il est recopié
  // dans le créateur de graphiques, où tous ses réglages sont modifiables.
  const customizeChart = (preset: ChartPreset) => {
    if (!active?.analysis) return;
    const cfg = createChart(
      preset.type,
      columnInfos(active.analysis.profile),
      effectiveContext?.keyColumns ?? [],
      preset.roles,
      {},
      false,
    );
    setActiveCharts([...active.charts, cfg]);
    setChartFocus(cfg.id);
  };

  const setActiveReview = (review: ManualReview) => {
    setSheets((prev) =>
      prev.map((s, i) => (i === activeIndex ? { ...s, review } : s)),
    );
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
          const res = cleanDataset(s.dataset, s.options, s.review);
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
          const res = cleanDataset(s.dataset, opts, s.review);
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
    setRestoredAt(null);
    savedWorkbook.current = null;
    clearSession();
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
          <AppNav />
          <span className="tag">Analyse de données · 100% navigateur (sauf IA optionnelle)</span>
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

        {stage === "upload" &&
          (restoring ? (
            <div className="card">
              <p className="hint" style={{ margin: 0 }}>
                <span className="spinner dark" /> Recherche d&apos;une session mémorisée…
              </p>
            </div>
          ) : (
            <FileUpload onLoaded={onLoaded} />
          ))}

        {stage === "workspace" && workbook && active && rawProfile && (
          <>
            <SessionBar
              persist={persist}
              restoredAt={restoredAt}
              error={sessionError}
              onTogglePersist={togglePersist}
              onClear={reset}
            />

            {sheets.length > 1 && (
              <SheetTabs
                sheets={sheets}
                activeIndex={activeIndex}
                onSelect={setActiveIndex}
              />
            )}

            {workbook.skippedSheets.length > 0 && (
              <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                {workbook.skippedSheets.length > 1
                  ? "Feuilles ignorées car vides"
                  : "Feuille ignorée car vide"}{" "}
                ou sans tableau de données exploitable :{" "}
                {workbook.skippedSheets.join(", ")}.
              </p>
            )}

            {heuristicContext && (
              <ContextPanel
                dataset={active.dataset}
                heuristic={heuristicContext}
                aiResult={active.aiContext}
                onAiResult={setActiveAiContext}
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
                  <ReviewPanel
                    dataset={active.dataset}
                    options={active.options}
                    review={active.review}
                    onChange={setActiveReview}
                  />
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
                  {active.result.manualLog.length > 0 && (
                    <details className="panel" style={{ marginTop: 14 }}>
                      <summary>
                        Journal des décisions manuelles ({active.result.manualLog.length})
                      </summary>
                      <div className="table-wrap tall">
                        <table className="data">
                          <thead>
                            <tr>
                              <th>Ligne</th>
                              <th>Colonne</th>
                              <th>Avant</th>
                              <th>Après</th>
                              <th>Décision</th>
                              <th>Justification</th>
                            </tr>
                          </thead>
                          <tbody>
                            {active.result.manualLog.map((e, i) => (
                              <tr key={i}>
                                <td className="num">{e.row}</td>
                                <td>{e.column || "—"}</td>
                                <td>{e.issue === "row" ? "—" : formatCell(e.before)}</td>
                                <td>{e.issue === "row" ? "—" : formatCell(e.after)}</td>
                                <td>{e.decision}</td>
                                <td>{e.note || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
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
                  <Charts analysis={active.analysis} onCustomize={customizeChart} />
                </div>

                <div className="card">
                  <h2>
                    <Palette size={20} /> Créateur de graphiques
                  </h2>
                  <p className="subtitle">
                    35 types de graphiques — ceux de plotly, seaborn et
                    matplotlib en Python — entièrement paramétrables comme dans
                    Excel ou Power BI : colonnes, calculs, couleurs, titres,
                    axes, légende, étiquettes, format des nombres. Export PNG,
                    SVG ou JPEG.
                  </p>
                  <ChartBuilder
                    dataset={active.result.dataset}
                    profile={active.analysis.profile}
                    suggestedColumns={effectiveContext?.keyColumns}
                    charts={active.charts}
                    onChange={setActiveCharts}
                    focusId={chartFocus}
                    baseName={
                      workbook.fileName.replace(/\.[^.]+$/, "") +
                      (sheets.length > 1 ? `-${active.name}` : "")
                    }
                  />
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
                    suggestedColumns={effectiveContext?.keyColumns}
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
                    charts: s.charts,
                    manualLog: s.result!.manualLog,
                  }))}
                />
              )}
            </div>
          </>
        )}

        <p className="foot">
          DataLab — vos données ne quittent jamais votre navigateur, sauf si
          vous activez explicitement l&apos;analyse IA optionnelle. La session
          peut être mémorisée sur cet ordinateur (désactivable à tout moment).
          Nettoyage, apurement, analyse et export XLSX / PDF / Word.
        </p>
      </main>
    </>
  );
}
