"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Database, Download, Layers, ListChecks, ShieldCheck } from "lucide-react";
import AppNav from "@/components/AppNav";
import DocumentUpload, { type LoadedDoc } from "@/components/documents/DocumentUpload";
import DocumentOverview from "@/components/documents/DocumentOverview";
import AnomalyList from "@/components/documents/AnomalyList";
import StructurePanel, { IndicatorTable } from "@/components/documents/StructurePanel";
import DocExportBar from "@/components/documents/DocExportBar";
import { analyzeCorpus, analyzeDocument, type DocumentResult } from "@/lib/documents/analyze";
import { counts, type ReportInput } from "@/lib/documents/export";
import { profileOf } from "@/lib/documents/referentiel";
import { LF } from "@/lib/documents/lf";
import type { AnomalyStatus, DocKind, DocModel } from "@/lib/documents/types";

interface DocEntry {
  id: string;
  model: DocModel;
  result: DocumentResult;
  statuses: Record<string, AnomalyStatus>;
  kind?: DocKind; // type choisi manuellement
  section: string; // "" : rattachement automatique, "aucune", ou code de section choisi
}

const reanalyze = (e: DocEntry): DocEntry => ({ ...e, result: analyzeDocument(e.model, e.kind, e.section || undefined) });

const CORPUS = "__ensemble";

export default function DocumentsPage() {
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [corpusStatuses, setCorpusStatuses] = useState<Record<string, AnomalyStatus>>({});

  const onLoaded = useCallback((docs: LoadedDoc[]) => {
    const stamp = Date.now();
    const added: DocEntry[] = docs.map((d, i) => ({ id: `${stamp}-${i}`, model: d.model, result: d.result, statuses: {}, section: "" }));
    setEntries((prev) => [...prev, ...added]);
    // Premier chargement de plusieurs fichiers : vue d'ensemble ; ajout
    // ultérieur : on montre le premier document ajouté.
    setActiveId((current) => (current === "" && added.length > 1 ? CORPUS : added[0].id));
  }, []);

  const corpus = useMemo(
    () => (entries.length > 1 ? analyzeCorpus(entries.map((e) => e.result.corpus)) : []),
    [entries],
  );

  const setStatus = (entryId: string, anomalyId: string, status: AnomalyStatus) => {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, statuses: { ...e.statuses, [anomalyId]: status } } : e)));
  };

  // Changer le type ou la section budgétaire relance l'analyse (sections
  // attendues, loi de finances de référence) ; les statuts déjà posés sont
  // conservés car les identifiants sont stables.
  const setKind = (entryId: string, kind: DocKind) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? reanalyze({ ...e, kind: kind === e.result.analysis.kindDetected ? undefined : kind }) : e)),
    );
  };
  const setSection = (entryId: string, section: string) => {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? reanalyze({ ...e, section }) : e)));
  };

  const remove = (entryId: string) => {
    const next = entries.filter((e) => e.id !== entryId);
    setEntries(next);
    setActiveId(next.length > 1 ? CORPUS : next[0]?.id ?? "");
  };

  const reset = () => {
    setEntries([]);
    setCorpusStatuses({});
    setActiveId("");
  };

  const reportInput: ReportInput = {
    docs: entries.map((e) => ({ analysis: e.result.analysis, statuses: e.statuses })),
    corpus,
    corpusStatuses,
  };
  const active = entries.find((e) => e.id === activeId) ?? null;
  const showCorpus = activeId === CORPUS && entries.length > 1;
  const stage = entries.length ? 1 : 0;

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
          <span className="tag">Contrôle de documents · 100% navigateur</span>
        </div>
      </header>

      <main className="container">
        <div className="stepper">
          {["Charger les documents", "Contrôler, corriger & exporter"].map((label, i) => (
            <div key={label} className={"step" + (i === stage ? " active" : "") + (i < stage ? " done" : "")}>
              <span className="num">{i < stage ? <CheckCircle2 size={14} /> : i + 1}</span>
              {label}
            </div>
          ))}
        </div>

        {entries.length === 0 ? (
          <>
            <DocumentUpload onLoaded={onLoaded} />
            <div className="card">
              <h2>
                <ShieldCheck size={20} /> Ce que vérifie DataLab
              </h2>
              <ul className="obs">
                <li>
                  <b>Calculs</b> : totaux de lignes et de colonnes, pourcentages recalculés à partir des effectifs,
                  quantité × prix unitaire, tableaux décalés, vides ou répétés.
                </li>
                <li>
                  <b>Cohérence</b> : chiffres du texte comparés aux tableaux, effectifs qui changent d&apos;une page
                  à l&apos;autre, chiffre du titre introuvable, devises et unités mélangées, sigles définis de
                  plusieurs façons, texte recopié d&apos;un rapport à l&apos;autre.
                </li>
                <li>
                  <b>Complétude</b> : sections attendues selon le type (rapport d&apos;activités, stratégie, CDMT,
                  cahier des charges, TdR, inspection…), textes à compléter (« [dates] », « … »), sections vides
                  ou à l&apos;état de notes, annexes annoncées mais absentes, document non daté.
                </li>
                <li>
                  <b>Indicateurs</b> (toutes directions) : référence, cible, réalisé, taux de réalisation,
                  trimestres, sources de vérification, résultats non chiffrés, recommandations sans responsable
                  ni échéance.
                </li>
                <li>
                  <b>CDMT</b> (canevas du Ministère du Budget, tous ministères) : rubriques du canevas et de
                  chaque programme, sous-totaux programme / nature / action, montants des programmes
                  identiques dans tous les tableaux, enveloppe globale citée dans le texte, cadre de
                  performance (référence N-1, cibles N à N+2), responsables des actions, unités et période.
                </li>
                <li>
                  <b>Loi de finances en vigueur</b> (LF {LF.annee}, {LF.sections.length} sections) : rattachement du
                  document à la section de son ministère (code), montants {LF.annee} par programme et par titre
                  comparés aux crédits votés, colonne LFR {LF.anneeLfr}, programmes et intitulés officiels
                  (21001, 22001…), libellés des titres et des imputations (ex. 3-3-6-10-00), sources de
                  financement et BAS.
                </li>
                <li>
                  <b>Budget</b> : dépassement de plafond, dotations nulles ou négatives, variations
                  annuelles anormales, totaux annuels divergents entre tableaux.
                </li>
                <li>
                  <b>Rédaction</b> : coquilles, mots répétés, phrases inachevées, % oubliés, renvois cassés,
                  exigences vagues d&apos;un cahier des charges.
                </li>
              </ul>
              <p className="hint" style={{ marginTop: 12 }}>
                Chaque anomalie est localisée et accompagnée d&apos;une correction proposée, et chaque document
                reçoit un avis (non validable en l&apos;état, validable sous réserve, conforme). Rien n&apos;est
                modifié automatiquement : vous validez ou écartez chaque proposition.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="sheet-tabs">
              {entries.length > 1 && (
                <button type="button" className={"sheet-tab" + (showCorpus ? " active" : "")} onClick={() => setActiveId(CORPUS)}>
                  <Layers size={14} /> Vue d&apos;ensemble
                  <span className="n">{entries.length} doc.</span>
                </button>
              )}
              {entries.map((e) => {
                const c = counts(e.result.analysis.anomalies, e.statuses);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={"sheet-tab" + (e.id === activeId ? " active" : "")}
                    onClick={() => setActiveId(e.id)}
                    title={profileOf(e.result.analysis.kind).label}
                  >
                    {e.result.analysis.fileName.length > 38 ? e.result.analysis.fileName.slice(0, 36) + "…" : e.result.analysis.fileName}
                    {c.bloquante > 0 && <span className="sev-pill bloquante">{c.bloquante}</span>}
                    {c.majeure > 0 && <span className="sev-pill majeure">{c.majeure}</span>}
                  </button>
                );
              })}
            </div>

            {showCorpus && (
              <>
                <div className="card">
                  <h2>
                    <Layers size={20} /> Vue d&apos;ensemble — {entries.length} documents
                  </h2>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Type</th>
                          <th>Direction(s)</th>
                          <th>Bloquantes</th>
                          <th>Majeures</th>
                          <th>Mineures</th>
                          <th>Traitées</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e) => {
                          const a = e.result.analysis;
                          const c = counts(a.anomalies, e.statuses);
                          return (
                            <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => setActiveId(e.id)}>
                              <td>{a.fileName}</td>
                              <td>{profileOf(a.kind).label}</td>
                              <td>{a.departments.map((d) => d.label).join(", ") || "—"}</td>
                              <td className="num">{c.bloquante}</td>
                              <td className="num">{c.majeure}</td>
                              <td className="num">{c.mineure}</td>
                              <td className="num">{c.traitees}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card">
                  <h2>
                    <ListChecks size={20} /> Anomalies entre documents
                  </h2>
                  <p className="subtitle">
                    Sigles définis différemment d&apos;un document à l&apos;autre, phrases recopiées entre rapports
                    (difficultés, recommandations non actualisées…).
                  </p>
                  <AnomalyList
                    anomalies={corpus}
                    statuses={corpusStatuses}
                    onStatus={(id, s) => setCorpusStatuses((prev) => ({ ...prev, [id]: s }))}
                    emptyText="Aucune incohérence entre les documents chargés."
                  />
                </div>
                {entries.some((e) => e.result.analysis.indicators.length) && (
                  <div className="card">
                    <h2>
                      <ListChecks size={20} /> Indicateurs consolidés (toutes directions)
                    </h2>
                    <IndicatorTable
                      withDocument
                      rows={entries.flatMap((e) => e.result.analysis.indicators.map((i) => ({ ...i, document: e.result.analysis.fileName })))}
                    />
                  </div>
                )}
              </>
            )}

            {!showCorpus && active && (
              <>
                <DocumentOverview
                  analysis={active.result.analysis}
                  statuses={active.statuses}
                  onKind={(k) => setKind(active.id, k)}
                  sectionMode={active.section}
                  onSection={(code) => setSection(active.id, code)}
                />
                <div className="card">
                  <h2>
                    <ListChecks size={20} /> Anomalies et corrections proposées
                  </h2>
                  <p className="subtitle">
                    Triées par gravité puis dans l&apos;ordre du document. Marquez chaque point comme corrigé, ou
                    ignorez-le s&apos;il s&apos;agit d&apos;un faux positif : il ne figurera pas dans le rapport.
                  </p>
                  <AnomalyList
                    key={active.id}
                    anomalies={active.result.analysis.anomalies}
                    statuses={active.statuses}
                    onStatus={(id, s) => setStatus(active.id, id, s)}
                  />
                </div>
                <StructurePanel analysis={active.result.analysis} />
              </>
            )}

            <div className="card">
              <h2>
                <Download size={20} /> Exporter {entries.length > 1 ? "— tous les documents" : ""}
              </h2>
              <DocExportBar input={reportInput} />
            </div>

            <div className="card">
              <h2>Ajouter ou retirer des documents</h2>
              <p className="subtitle">
                Ajoutez par exemple le rapport de l&apos;année précédente ou la matrice d&apos;une autre direction :
                les contrôles entre documents s&apos;activent dès deux fichiers.
              </p>
              <DocumentUpload onLoaded={onLoaded} compact />
              <div className="btn-row">
                {active && !showCorpus && (
                  <button className="btn" onClick={() => remove(active.id)}>
                    Retirer « {active.result.analysis.fileName} »
                  </button>
                )}
                <button className="btn" onClick={reset}>
                  Tout recommencer
                </button>
              </div>
            </div>
          </>
        )}

        <p className="foot">
          DataLab — contrôle documentaire 100 % local : vos documents ne quittent jamais votre navigateur.
          Les contrôles sont automatiques et doivent être validés par un relecteur.
        </p>
      </main>
    </>
  );
}
