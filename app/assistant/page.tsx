"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as XLSX from "xlsx";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  FileSpreadsheet,
  Download,
  FileText,
  Table2,
} from "lucide-react";
import AppNav from "@/components/AppNav";
import FileUpload from "@/components/FileUpload";
import { buildSheetsContext, fetchChatStep } from "@/lib/assistant/chat";
import type { ToolResult } from "@/lib/assistant/chat";
import { executePlan } from "@/lib/assistant/execute";
import {
  fetchSynthesisReport,
  reportToMarkdown,
  downloadMarkdown,
  downloadDocx,
} from "@/lib/assistant/report";
import type { SynthesisReport } from "@/lib/assistant/report";
import type { Row, WorkbookInput } from "@/lib/types";

interface AttachedTable {
  title: string;
  columns: string[];
  rows: Row[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  table?: AttachedTable;
  report?: SynthesisReport;
}

const MAX_DISPLAY_ROWS = 300;

// Rendu markdown avec effet de frappe (streaming) pour les messages de l'IA.
function AssistantContent({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(2, Math.ceil(text.length / 90));
    const id = setInterval(() => {
      setShown((s) => {
        const n = s + step;
        if (n >= text.length) {
          clearInterval(id);
          return text.length;
        }
        return n;
      });
    }, 16);
    return () => clearInterval(id);
  }, [text, animate]);
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text.slice(0, shown)}</ReactMarkdown>
    </div>
  );
}

function exportTableXlsx(t: AttachedTable) {
  const ws = XLSX.utils.json_to_sheet(t.rows as Record<string, unknown>[], { header: t.columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Résultat");
  XLSX.writeFile(wb, `${t.title.slice(0, 60) || "tableau"}.xlsx`);
}

function exportTableCsv(t: AttachedTable) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    t.columns.map(esc).join(";"),
    ...t.rows.map((r) => t.columns.map((c) => esc(r[c])).join(";")),
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.title.slice(0, 60) || "tableau"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AssistantPage() {
  const [workbook, setWorkbook] = useState<WorkbookInput | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const examples = useMemo(
    () => [
      "Résume ces données et les grandes tendances.",
      "Quelle catégorie a la valeur moyenne la plus élevée ?",
      "Y a-t-il des anomalies ou valeurs extrêmes ?",
      "Fais-moi un tableau récapitulatif par catégorie.",
    ],
    [],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function onLoaded(wb: WorkbookInput) {
    setWorkbook(wb);
    setSheetIdx(0);
    setMessages([]);
    setError(null);
  }

  async function run(request: string) {
    if (!workbook || !request.trim() || loading) return;
    setLoading(true);
    setError(null);
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: request }]);
    setInput("");
    try {
      const sheets = buildSheetsContext(workbook);
      const toolResults: ToolResult[] = [];
      let table: AttachedTable | undefined;
      let answerText = "";
      let answered = false;
      for (let iter = 0; iter < 3 && !answered; iter++) {
        const step = await fetchChatStep(sheets, history, request, toolResults);
        if (step.action === "answer" || !step.plan) {
          answerText = step.answer || "(réponse vide)";
          answered = true;
          break;
        }
        const ds =
          (step.sheet && workbook.sheets.find((s) => s.name === step.sheet)?.dataset) ||
          workbook.sheets[sheetIdx]?.dataset ||
          workbook.sheets[0]?.dataset;
        if (!ds) {
          answerText = "Données introuvables pour le calcul.";
          answered = true;
          break;
        }
        const r = executePlan(ds, step.plan);
        table = { title: step.plan.title || "Résultat", columns: r.columns, rows: r.rows };
        const extrait = r.rows.slice(0, 20).map((row) => {
          const o: Record<string, unknown> = {};
          for (const c of r.columns) {
            const v = row[c];
            o[c] = typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v;
          }
          return o;
        });
        toolResults.push({ title: table.title, columns: r.columns, rows: extrait, totalRows: r.rows.length });
      }
      if (!answered) answerText = "Je n'ai pas pu finaliser le calcul. Reformulez la question.";
      setMessages((m) => [...m, { role: "assistant", content: answerText, table }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur lors de l'appel à l'assistant.";
      setError(msg);
      setMessages((m) => [...m, { role: "assistant", content: "❌ " + msg }]);
    } finally {
      setLoading(false);
    }
  }

  async function makeReport(t: AttachedTable) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const rep = await fetchSynthesisReport(t.title, t.columns, t.rows);
      setMessages((m) => [...m, { role: "assistant", content: reportToMarkdown(rep), report: rep }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur lors de la génération du rapport.";
      setError(msg);
      setMessages((m) => [...m, { role: "assistant", content: "❌ " + msg }]);
    } finally {
      setLoading(false);
    }
  }

  function copyMessage(i: number, content: string) {
    navigator.clipboard?.writeText(content).then(
      () => {
        setCopied(i);
        setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
      },
      () => {},
    );
  }

  const dataset = workbook?.sheets[sheetIdx]?.dataset ?? null;

  return (
    <main className="container">
      <style>{CHAT_CSS}</style>
      <AppNav />

      <div className="asst-head">
        <h1 style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
          <Sparkles size={20} /> Assistant IA
        </h1>
        {workbook && dataset && (
          <div className="asst-fileinfo">
            <Table2 size={15} />
            <span>{workbook.fileName}</span>
            {workbook.sheets.length > 1 && (
              <select
                value={sheetIdx}
                onChange={(e) => setSheetIdx(Number(e.target.value))}
                aria-label="Feuille par défaut"
              >
                {workbook.sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <span className="hint">{dataset.rows.length} lignes</span>
            <button className="btn btn-sm" onClick={() => setWorkbook(null)}>
              Changer
            </button>
          </div>
        )}
      </div>

      {!workbook && (
        <div style={{ marginTop: 12 }}>
          <p className="subtitle">
            Chargez un fichier (Excel multi-feuilles, CSV) puis discutez avec l’assistant comme avec
            un chatbot spécialisé en data : posez n’importe quelle question, il répond, calcule les
            chiffres exacts et peut produire des tableaux exportables.
          </p>
          <FileUpload onLoaded={onLoaded} />
        </div>
      )}

      {workbook && (
        <div className="chat">
          <div className="chat-scroll">
            {messages.length === 0 && (
              <div className="chat-empty">
                <Sparkles size={28} />
                <p>Posez votre première question sur « {workbook.fileName} »</p>
                <div className="chip-row">
                  {examples.map((ex) => (
                    <button key={ex} className="chip" onClick={() => run(ex)} disabled={loading}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="avatar">{m.role === "user" ? "Vous" : <Sparkles size={15} />}</div>
                <div className="bubble">
                  {m.role === "assistant" ? (
                    <AssistantContent text={m.content} animate={i === messages.length - 1} />
                  ) : (
                    <div className="user-text">{m.content}</div>
                  )}

                  {m.table && (
                    <div className="result">
                      <div className="result-head">
                        <strong>{m.table.title}</strong>
                        <span className="hint">
                          {m.table.rows.length} ligne(s) · {m.table.columns.length} col.
                        </span>
                        <div className="result-actions">
                          <button className="btn btn-sm" onClick={() => exportTableXlsx(m.table!)}>
                            <FileSpreadsheet size={14} /> Excel
                          </button>
                          <button className="btn btn-sm" onClick={() => exportTableCsv(m.table!)}>
                            <Download size={14} /> CSV
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => makeReport(m.table!)}
                            disabled={loading}
                          >
                            <FileText size={14} /> Rapport
                          </button>
                        </div>
                      </div>
                      <div className="result-table">
                        <table>
                          <thead>
                            <tr>
                              {m.table.columns.map((c) => (
                                <th key={c}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {m.table.rows.slice(0, MAX_DISPLAY_ROWS).map((r, ri) => (
                              <tr key={ri}>
                                {m.table!.columns.map((c) => (
                                  <td key={c}>
                                    {r[c] === null || r[c] === undefined
                                      ? ""
                                      : typeof r[c] === "number"
                                        ? (r[c] as number).toLocaleString("fr-FR", {
                                            maximumFractionDigits: 4,
                                          })
                                        : String(r[c])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {m.table.rows.length > MAX_DISPLAY_ROWS && (
                        <div className="hint">
                          Aperçu de {MAX_DISPLAY_ROWS} lignes sur {m.table.rows.length}. L’export
                          contient tout.
                        </div>
                      )}
                    </div>
                  )}

                  {m.report && (
                    <div className="result-actions" style={{ marginTop: 8 }}>
                      <button className="btn btn-sm" onClick={() => downloadDocx(m.report!)}>
                        <Download size={14} /> Word
                      </button>
                      <button className="btn btn-sm" onClick={() => downloadMarkdown(m.report!)}>
                        <Download size={14} /> Markdown
                      </button>
                    </div>
                  )}

                  {m.role === "assistant" && (
                    <button
                      className="copy-btn"
                      onClick={() => copyMessage(i, m.content)}
                      title="Copier"
                    >
                      {copied === i ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="msg assistant">
                <div className="avatar">
                  <Sparkles size={15} />
                </div>
                <div className="bubble">
                  <div className="typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && <div className="error-box" style={{ margin: "0 0 8px" }}>{error}</div>}

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              run(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez une question sur vos données…"
              disabled={loading}
            />
            <button className="btn send" type="submit" disabled={loading || !input.trim()}>
              {loading ? <span className="spinner" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

const CHAT_CSS = `
.asst-head { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
.asst-fileinfo { display:flex; align-items:center; gap:8px; margin-left:auto; font-size:13px; opacity:.9; flex-wrap:wrap; }
.btn-sm { padding:4px 8px; font-size:12px; }
.chat { display:flex; flex-direction:column; height: calc(100vh - 180px); min-height: 420px; }
.chat-scroll { flex:1; overflow-y:auto; padding:8px 2px 16px; }
.chat-empty { text-align:center; opacity:.8; margin-top:48px; display:flex; flex-direction:column; align-items:center; gap:10px; }
.chip-row { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; max-width:640px; }
.chip { background:rgba(148,163,184,.12); border:1px solid rgba(148,163,184,.3); color:inherit; border-radius:999px; padding:8px 14px; font-size:13px; cursor:pointer; }
.chip:hover { background:rgba(148,163,184,.22); }
.msg { display:flex; gap:10px; margin:14px 0; align-items:flex-start; }
.msg .avatar { flex:0 0 auto; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; background:rgba(148,163,184,.18); }
.msg.assistant .avatar { background:linear-gradient(135deg,#3b82f6,#8b5cf6); color:#fff; }
.msg .bubble { position:relative; border-radius:12px; padding:10px 14px; max-width:860px; }
.msg.user .bubble { background:rgba(59,130,246,.14); }
.msg.assistant .bubble { background:rgba(148,163,184,.10); }
.user-text { white-space:pre-wrap; }
.copy-btn { position:absolute; top:6px; right:6px; background:transparent; border:none; color:inherit; opacity:.45; cursor:pointer; padding:2px; }
.copy-btn:hover { opacity:.9; }
.typing { display:flex; gap:5px; padding:4px 2px; }
.typing span { width:7px; height:7px; border-radius:50%; background:currentColor; opacity:.5; animation:typing 1s infinite; }
.typing span:nth-child(2){ animation-delay:.15s; } .typing span:nth-child(3){ animation-delay:.3s; }
@keyframes typing { 0%,60%,100%{ transform:translateY(0); opacity:.35 } 30%{ transform:translateY(-4px); opacity:.9 } }
.chat-input { display:flex; gap:8px; padding-top:8px; border-top:1px solid rgba(148,163,184,.2); }
.chat-input input { flex:1; padding:12px 14px; border-radius:10px; }
.chat-input .send { padding:0 16px; }
.result { margin-top:10px; border:1px solid rgba(148,163,184,.25); border-radius:10px; padding:8px; }
.result-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:6px; }
.result-actions { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; }
.result-table { overflow-x:auto; max-height:360px; overflow-y:auto; }
.result-table table { border-collapse:collapse; width:100%; font-size:12.5px; }
.result-table th { position:sticky; top:0; background:#1e293b; text-align:left; padding:6px 10px; border-bottom:2px solid rgba(148,163,184,.4); }
.result-table td { padding:5px 10px; border-bottom:1px solid rgba(148,163,184,.18); white-space:nowrap; }
.md :first-child { margin-top:0; } .md :last-child { margin-bottom:0; }
.md p { margin:.5em 0; line-height:1.55; }
.md ul, .md ol { margin:.5em 0; padding-left:1.4em; } .md li { margin:.2em 0; }
.md h1,.md h2,.md h3 { margin:.6em 0 .3em; line-height:1.3; }
.md h1{ font-size:1.3em } .md h2{ font-size:1.15em } .md h3{ font-size:1.05em }
.md code { background:rgba(148,163,184,.2); padding:1px 5px; border-radius:4px; font-size:.9em; }
.md pre { background:rgba(15,23,42,.6); padding:10px 12px; border-radius:8px; overflow-x:auto; }
.md pre code { background:transparent; padding:0; }
.md blockquote { border-left:3px solid rgba(148,163,184,.5); margin:.5em 0; padding:.2em 0 .2em 12px; opacity:.9; }
.md table { border-collapse:collapse; margin:.6em 0; width:100%; font-size:13px; display:block; overflow-x:auto; }
.md th { background:#1e293b; text-align:left; padding:6px 10px; border:1px solid rgba(148,163,184,.35); }
.md td { padding:6px 10px; border:1px solid rgba(148,163,184,.25); }
.md a { color:#60a5fa; }
`;
