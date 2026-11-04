"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Sparkles, Send, Download, FileSpreadsheet, Table2 } from "lucide-react";
import AppNav from "@/components/AppNav";
import FileUpload from "@/components/FileUpload";
import { fetchTransformPlan } from "@/lib/assistant/client";
import { executePlan } from "@/lib/assistant/execute";
import type { Dataset, WorkbookInput } from "@/lib/types";
import type { ExecResult, TransformPlan } from "@/lib/assistant/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_DISPLAY_ROWS = 500;

export default function AssistantPage() {
  const [workbook, setWorkbook] = useState<WorkbookInput | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TransformPlan | null>(null);
  const [result, setResult] = useState<ExecResult | null>(null);

  const dataset: Dataset | null = workbook?.sheets[sheetIdx]?.dataset ?? null;

  const examples = useMemo(
    () => [
      "Regroupe par la 1re colonne de texte et calcule la moyenne de la 1re colonne numérique.",
      "Garde seulement les colonnes clés et trie par la valeur la plus élevée.",
      "Ajoute une colonne « Taux » = réalisé / cible * 100 et classe du plus grand au plus petit.",
    ],
    [],
  );

  function onLoaded(wb: WorkbookInput) {
    setWorkbook(wb);
    setSheetIdx(0);
    setMessages([]);
    setPlan(null);
    setResult(null);
    setError(null);
  }

  async function run(request: string) {
    if (!dataset || !request.trim() || loading) return;
    setLoading(true);
    setError(null);
    const history = messages.slice(-6);
    setMessages((m) => [...m, { role: "user", content: request }]);
    setInput("");
    try {
      const p = await fetchTransformPlan(dataset, request, history);
      const r = executePlan(dataset, p);
      setPlan(p);
      setResult(r);
      const note = [
        p.title ? `**${p.title}**` : "",
        p.explanation,
        `${r.rows.length} ligne(s), ${r.columns.length} colonne(s).`,
        r.warnings.length ? `⚠️ ${r.warnings.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      setMessages((m) => [...m, { role: "assistant", content: note }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur lors de l'appel à l'assistant.";
      setError(msg);
      setMessages((m) => [...m, { role: "assistant", content: `❌ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  function exportXlsx() {
    if (!result) return;
    const ws = XLSX.utils.json_to_sheet(result.rows as Record<string, unknown>[], {
      header: result.columns,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Résultat");
    XLSX.writeFile(wb, `${(plan?.title || "document").slice(0, 60)}.xlsx`);
  }

  function exportCsv() {
    if (!result) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      result.columns.map(esc).join(";"),
      ...result.rows.map((r) => result.columns.map((c) => esc(r[c])).join(";")),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(plan?.title || "document").slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="container">
      <AppNav />

      <h1 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <Sparkles size={22} /> Assistant IA
      </h1>
      <p className="subtitle">
        Décrivez en langage naturel la transformation voulue. L’IA propose un plan, DataLab
        l’exécute <strong>localement</strong> (vos lignes ne sont jamais envoyées — seuls le schéma
        et un échantillon le sont) et produit un document final exportable.
      </p>

      {!workbook && (
        <div style={{ marginTop: 16 }}>
          <FileUpload onLoaded={onLoaded} />
        </div>
      )}

      {workbook && dataset && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <Table2 size={16} />
              <strong>{workbook.fileName}</strong>
              {workbook.sheets.length > 1 && (
                <select
                  value={sheetIdx}
                  onChange={(e) => {
                    setSheetIdx(Number(e.target.value));
                    setPlan(null);
                    setResult(null);
                  }}
                >
                  {workbook.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="hint">
                {dataset.rows.length} lignes · {dataset.columns.length} colonnes
              </span>
              <button
                className="btn"
                style={{ marginLeft: "auto" }}
                onClick={() => setWorkbook(null)}
              >
                Changer de fichier
              </button>
            </div>
          </div>

          {/* Conversation */}
          <div className="card" style={{ marginTop: 16 }}>
            {messages.length === 0 && (
              <div className="hint" style={{ marginBottom: 12 }}>
                Exemples de demandes :
                <ul style={{ margin: "8px 0 0 0" }}>
                  {examples.map((ex) => (
                    <li key={ex} style={{ marginBottom: 6 }}>
                      <button
                        className="btn"
                        style={{ textAlign: "left" }}
                        onClick={() => run(ex)}
                        disabled={loading}
                      >
                        {ex}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  margin: "8px 0",
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: m.role === "user" ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.12)",
                  whiteSpace: "pre-wrap",
                }}
              >
                <strong>{m.role === "user" ? "Vous" : "Assistant"}</strong>
                <div>{m.content}</div>
              </div>
            ))}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(input);
              }}
              style={{ display: "flex", gap: 8, marginTop: 12 }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ex. : regroupe par service et calcule le salaire moyen, trié décroissant"
                disabled={loading}
                style={{ flex: 1, padding: "10px 12px" }}
              />
              <button className="btn" type="submit" disabled={loading || !input.trim()}>
                {loading ? <span className="spinner" /> : <Send size={16} />} Envoyer
              </button>
            </form>
            {error && (
              <div className="error-box" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>

          {/* Résultat */}
          {result && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0 }}>{plan?.title || "Document produit"}</h2>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn" onClick={exportXlsx}>
                    <FileSpreadsheet size={16} /> Export Excel
                  </button>
                  <button className="btn" onClick={exportCsv}>
                    <Download size={16} /> Export CSV
                  </button>
                </div>
              </div>

              {plan?.explanation && <p className="subtitle">{plan.explanation}</p>}

              {result.stepNotes.length > 0 && (
                <details style={{ margin: "8px 0" }}>
                  <summary className="hint">Étapes appliquées ({result.stepNotes.length})</summary>
                  <ul>
                    {result.stepNotes.map((n, i) => (
                      <li key={i} className="hint">
                        {n}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {result.warnings.length > 0 && (
                <div className="hint" style={{ color: "#f59e0b" }}>
                  ⚠️ {result.warnings.join(" ")}
                </div>
              )}

              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th
                          key={c}
                          style={{
                            textAlign: "left",
                            borderBottom: "2px solid rgba(148,163,184,0.4)",
                            padding: "6px 10px",
                            position: "sticky",
                            top: 0,
                          }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, MAX_DISPLAY_ROWS).map((r, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td
                            key={c}
                            style={{
                              borderBottom: "1px solid rgba(148,163,184,0.2)",
                              padding: "5px 10px",
                            }}
                          >
                            {r[c] === null || r[c] === undefined
                              ? ""
                              : typeof r[c] === "number"
                                ? (r[c] as number).toLocaleString("fr-FR", { maximumFractionDigits: 4 })
                                : String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > MAX_DISPLAY_ROWS && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Aperçu des {MAX_DISPLAY_ROWS} premières lignes sur {result.rows.length}. L’export
                  contient tout.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
