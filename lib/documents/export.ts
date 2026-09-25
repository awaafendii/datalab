import type { Anomaly, AnomalyLocation, AnomalyStatus, DocAnalysis, DocKind, Severity } from "./types";
import { profileOf } from "./referentiel";
import { SEVERITY_ORDER } from "./types";
import { loadSaveAs } from "../save-file";

// Exports du contrôle documentaire : rapport d'audit (Word, PDF) et classeur
// Excel structuré (anomalies, plan, tableaux extraits, indicateurs de
// toutes les directions). Les anomalies ignorées par le relecteur ne sont
// pas reprises dans les rapports ; elles restent dans l'Excel avec leur statut.

export interface ReportDoc {
  analysis: DocAnalysis;
  statuses: Record<string, AnomalyStatus>;
}

export interface ReportInput {
  docs: ReportDoc[];
  corpus: Anomaly[];
  corpusStatuses: Record<string, AnomalyStatus>;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  bloquante: "Bloquante",
  majeure: "Majeure",
  mineure: "Mineure",
  info: "Info",
};

export const CATEGORY_LABEL: Record<Anomaly["category"], string> = {
  calcul: "Calculs",
  coherence: "Cohérence",
  completude: "Complétude",
  structure: "Structure",
  redaction: "Rédaction",
  indicateurs: "Indicateurs & résultats",
  sigles: "Sigles",
  budget: "Budget & montants",
};

export const STATUS_LABEL: Record<AnomalyStatus, string> = {
  "a-traiter": "À traiter",
  corrigee: "Corrigée",
  ignoree: "Ignorée",
};

export function locationText(l: AnomalyLocation): string {
  return [
    l.sheet ? `Feuille « ${l.sheet} »` : null,
    l.section || null,
    l.table || null,
    l.row ? `ligne « ${l.row} »` : null,
    l.column ? `colonne « ${l.column} »` : null,
    l.page ? `p. ${l.page}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function counts(anomalies: Anomaly[], statuses: Record<string, AnomalyStatus>) {
  const c = { bloquante: 0, majeure: 0, mineure: 0, info: 0, traitees: 0 };
  for (const a of anomalies) {
    const s = statuses[a.id] ?? "a-traiter";
    if (s !== "a-traiter") c.traitees++;
    if (s === "ignoree") continue;
    c[a.severity]++;
  }
  return c;
}

const kept = (list: Anomaly[], statuses: Record<string, AnomalyStatus>) => list.filter((a) => (statuses[a.id] ?? "a-traiter") !== "ignoree");

// Avis sur le document : il tient compte des décisions du relecteur (les
// anomalies ignorées ne comptent pas, les corrigées non plus).
export type VerdictLevel = "non-conforme" | "reserves" | "conforme";

export interface Verdict {
  level: VerdictLevel;
  label: string;
  summary: string;
}

export function verdictOf(anomalies: Anomaly[], statuses: Record<string, AnomalyStatus>, kind?: DocKind): Verdict {
  if (kind === "loi-finances")
    return {
      level: "conforme",
      label: "Texte de référence",
      summary: "Loi de finances : elle sert de référentiel aux contrôles et n'est pas contrôlée elle-même.",
    };
  const open = anomalies.filter((a) => (statuses[a.id] ?? "a-traiter") === "a-traiter");
  const n = (s: Severity) => open.filter((a) => a.severity === s).length;
  const missingSections = open.filter((a) => a.rule === "section-absente" || a.rule === "cdmt-rubriques-programme").length;
  const structure = missingSections ? ` ${missingSections} écart(s) au canevas attendu.` : "";
  if (n("bloquante"))
    return {
      level: "non-conforme",
      label: "Non validable en l'état",
      summary: `${n("bloquante")} anomalie(s) bloquante(s) et ${n("majeure")} majeure(s) à corriger avant validation.${structure}`,
    };
  if (n("majeure"))
    return {
      level: "reserves",
      label: "Validable sous réserve",
      summary: `Aucune anomalie bloquante ; ${n("majeure")} anomalie(s) majeure(s) à corriger ou à justifier.${structure}`,
    };
  return {
    level: "conforme",
    label: "Conforme aux contrôles automatiques",
    summary: `Aucune anomalie bloquante ni majeure restante${n("mineure") ? ` ; ${n("mineure")} point(s) de forme à revoir` : ""}. L'avis final reste celui du relecteur.`,
  };
}

function baseName(input: ReportInput): string {
  if (input.docs.length === 1) return input.docs[0].analysis.fileName.replace(/\.[^.]+$/, "") + "_controle";
  const d = new Date();
  return `controle_documents_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function generatedLine(input: ReportInput): string {
  return `Généré le ${new Date().toLocaleString("fr-FR")} · ${input.docs.length} document(s) · contrôle automatique local (DataLab), à valider par un relecteur`;
}

// --- Word ---

async function buildDocx(input: ReportInput) {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType, PageBreak } = await import("docx");
  const BLUE = "2563EB";
  const SEV_COLOR: Record<Severity, string> = { bloquante: "B91C1C", majeure: "C2410C", mineure: "1D4ED8", info: "4B5563" };
  const VERDICT_COLOR: Record<VerdictLevel, string> = { "non-conforme": "B91C1C", reserves: "C2410C", conforme: "047857" };
  const cell = (text: string, opts?: { bold?: boolean; fill?: string }) =>
    new TableCell({
      shading: opts?.fill ? { fill: opts.fill, type: "clear", color: "auto" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, color: opts?.fill ? "FFFFFF" : undefined, size: 18 })] })],
    });
  const row = (values: string[], header = false) =>
    new TableRow({ tableHeader: header, children: values.map((v) => cell(v, header ? { bold: true, fill: BLUE } : undefined)) });
  const full = { size: 100, type: WidthType.PERCENTAGE };

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ text: "Rapport de contrôle documentaire", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: generatedLine(input), italics: true, color: "666666", size: 18 })] }),
    new Paragraph({ text: "Synthèse", heading: HeadingLevel.HEADING_1 }),
    new Table({
      width: full,
      rows: [
        row(["Document", "Type", "Avis", "Bloquantes", "Majeures", "Mineures", "Infos", "Traitées"], true),
        ...input.docs.map((d) => {
          const c = counts(d.analysis.anomalies, d.statuses);
          return row([
            d.analysis.fileName,
            profileOf(d.analysis.kind).label,
            verdictOf(d.analysis.anomalies, d.statuses, d.analysis.kind).label,
            String(c.bloquante),
            String(c.majeure),
            String(c.mineure),
            String(c.info),
            String(c.traitees),
          ]);
        }),
      ],
    }),
  ];

  const anomalyBlock = (a: Anomaly, n: number, status: AnomalyStatus) => [
    new Paragraph({
      spacing: { before: 160 },
      children: [
        new TextRun({ text: `${n}. `, bold: true }),
        new TextRun({ text: `[${SEVERITY_LABEL[a.severity]}] `, bold: true, color: SEV_COLOR[a.severity] }),
        new TextRun({ text: a.title, bold: true }),
        new TextRun({ text: `  —  ${CATEGORY_LABEL[a.category]} · ${STATUS_LABEL[status]}`, color: "666666", size: 18 }),
      ],
    }),
    ...(locationText(a.location)
      ? [new Paragraph({ children: [new TextRun({ text: "Localisation : ", bold: true, size: 20 }), new TextRun({ text: locationText(a.location), size: 20 })] })]
      : []),
    new Paragraph({ children: [new TextRun({ text: "Constat : ", bold: true, size: 20 }), new TextRun({ text: a.detail, size: 20 })] }),
    ...(a.excerpt ? [new Paragraph({ children: [new TextRun({ text: `Extrait : « ${a.excerpt} »`, italics: true, color: "555555", size: 18 })] })] : []),
    new Paragraph({ children: [new TextRun({ text: "Correction proposée : ", bold: true, size: 20, color: "047857" }), new TextRun({ text: a.suggestion, size: 20 })] }),
  ];

  const section = (title: string, list: Anomaly[], statuses: Record<string, AnomalyStatus>) => {
    const shown = kept(list, statuses);
    const ignored = list.length - shown.length;
    const out: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
    let n = 0;
    for (const sev of Object.keys(SEVERITY_ORDER) as Severity[]) {
      const group = shown.filter((a) => a.severity === sev);
      if (!group.length) continue;
      out.push(new Paragraph({ text: `${title} — ${SEVERITY_LABEL[sev].toLowerCase()}s (${group.length})`, heading: HeadingLevel.HEADING_2 }));
      for (const a of group) out.push(...anomalyBlock(a, ++n, statuses[a.id] ?? "a-traiter"));
    }
    if (!shown.length) out.push(new Paragraph({ text: "Aucune anomalie détectée par les contrôles automatiques." }));
    if (ignored) out.push(new Paragraph({ children: [new TextRun({ text: `${ignored} anomalie(s) écartée(s) par le relecteur ne sont pas reprises.`, italics: true, color: "666666", size: 18 })] }));
    return out;
  };

  for (const d of input.docs) {
    const a = d.analysis;
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ text: a.fileName, heading: HeadingLevel.HEADING_1 }),
      (() => {
        const v = verdictOf(a.anomalies, d.statuses, a.kind);
        return new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: `Avis : ${v.label}. `, bold: true, color: VERDICT_COLOR[v.level] }),
            new TextRun({ text: v.summary, size: 20 }),
          ],
        });
      })(),
      new Paragraph({
        children: [
          new TextRun({
            text:
              `Type : ${profileOf(a.kind).label}` +
              (a.departments.length ? ` · Structure(s) : ${a.departments.map((x) => x.label).join(", ")}` : "") +
              (a.budget ? ` · Section budgétaire ${a.budget.section.code} (LF ${a.budget.annee})` : "") +
              ` · ${a.stats.pages ? `${a.stats.pages} pages · ` : ""}${a.stats.words.toLocaleString("fr-FR")} mots · ${a.stats.tables} tableaux`,
            color: "444444",
            size: 20,
          }),
        ],
      }),
      ...a.warnings.map((w) => new Paragraph({ children: [new TextRun({ text: `⚠ ${w}`, color: "B45309", size: 20 })] })),
      ...section("Anomalies", a.anomalies, d.statuses),
    );
  }
  if (input.corpus.length) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ text: "Contrôles entre documents", heading: HeadingLevel.HEADING_1 }),
      ...section("Entre documents", input.corpus, input.corpusStatuses),
    );
  }
  return { doc: new Document({ sections: [{ properties: {}, children }] }), Packer };
}

export async function buildAuditDOCX(input: ReportInput): Promise<Buffer> {
  const { doc, Packer } = await buildDocx(input);
  return Packer.toBuffer(doc);
}

export async function exportAuditDOCX(input: ReportInput): Promise<void> {
  const { doc, Packer } = await buildDocx(input);
  const saveAs = await loadSaveAs();
  saveAs(await Packer.toBlob(doc), baseName(input) + ".docx");
}

// --- PDF ---

// Les polices standard de jsPDF ne couvrent pas certains caractères
// (espaces fines, flèches, ≤…) : on les remplace par des équivalents.
function pdfSafe(s: string): string {
  return s
    .replace(/[   ]/g, " ")
    .replace(/→/g, "->")
    .replace(/↔/g, "<->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[≈~]/g, "~")
    .replace(/⚠/g, "!")
    .replace(/[^\x20-\x7e -ÿŒœ–—‘’“”…€•«»›\n]/g, "");
}

async function buildPdf(input: ReportInput) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const mx = 12;
  doc.setFontSize(17);
  doc.text("Rapport de contrôle documentaire", mx, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(pdfSafe(generatedLine(input)), mx, 22);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 27,
    head: [["Document", "Type", "Avis", "Bloq.", "Maj.", "Min.", "Infos", "Traitées"]],
    body: input.docs.map((d) => {
      const c = counts(d.analysis.anomalies, d.statuses);
      return [d.analysis.fileName, profileOf(d.analysis.kind).label, verdictOf(d.analysis.anomalies, d.statuses, d.analysis.kind).label, c.bloquante, c.majeure, c.mineure, c.info, c.traitees].map((v) =>
        pdfSafe(String(v)),
      );
    }),
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8.5 },
    margin: { left: mx, right: mx },
  });
  const SEV_RGB: Record<Severity, [number, number, number]> = { bloquante: [185, 28, 28], majeure: [194, 65, 12], mineure: [29, 78, 216], info: [75, 85, 99] };
  const table = (title: string, list: Anomaly[], statuses: Record<string, AnomalyStatus>, subtitle?: string) => {
    doc.addPage();
    doc.setFontSize(14);
    doc.setTextColor(37, 99, 235);
    doc.text(pdfSafe(title), mx, 16);
    doc.setTextColor(90);
    doc.setFontSize(9);
    if (subtitle) doc.text(pdfSafe(subtitle), mx, 22);
    doc.setTextColor(0);
    const shown = kept(list, statuses);
    autoTable(doc, {
      startY: subtitle ? 26 : 21,
      head: [["#", "Gravité", "Anomalie", "Localisation", "Correction proposée", "Statut"]],
      body: shown.length
        ? shown.map((a, k) => [
            String(k + 1),
            SEVERITY_LABEL[a.severity],
            pdfSafe(`${a.title}\n${a.detail}${a.excerpt ? `\n« ${a.excerpt} »` : ""}`),
            pdfSafe(locationText(a.location) || "Document entier"),
            pdfSafe(a.suggestion),
            STATUS_LABEL[statuses[a.id] ?? "a-traiter"],
          ])
        : [["", "", "Aucune anomalie détectée par les contrôles automatiques.", "", "", ""]],
      theme: "grid",
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 7.5, cellPadding: 1.6, valign: "top" },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 18 }, 2: { cellWidth: 98 }, 3: { cellWidth: 54 }, 4: { cellWidth: 72 }, 5: { cellWidth: 18 } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1 && shown[data.row.index]) {
          data.cell.styles.textColor = SEV_RGB[shown[data.row.index].severity];
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: mx, right: mx },
    });
  };
  for (const d of input.docs) {
    const a = d.analysis;
    table(
      a.fileName,
      a.anomalies,
      d.statuses,
      `Avis : ${verdictOf(a.anomalies, d.statuses, a.kind).label} · ${profileOf(a.kind).label}${a.departments.length ? ` · ${a.departments.map((x) => x.label).join(", ")}` : ""}${a.budget ? ` · Section ${a.budget.section.code} (LF ${a.budget.annee})` : ""}${a.warnings.length ? ` · ${a.warnings.length} avertissement(s) d'extraction` : ""}`,
    );
  }
  if (input.corpus.length) table("Contrôles entre documents", input.corpus, input.corpusStatuses);
  return doc;
}

// Renvoie les octets du PDF (tests / usage programmatique).
export async function buildAuditPDF(input: ReportInput): Promise<ArrayBuffer> {
  const doc = await buildPdf(input);
  return doc.output("arraybuffer");
}

export async function exportAuditPDF(input: ReportInput): Promise<void> {
  const doc = await buildPdf(input);
  const saveAs = await loadSaveAs();
  saveAs(doc.output("blob"), baseName(input) + ".pdf");
}

// --- Excel structuré ---

function safeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:\\/?*]/g, " ").trim().slice(0, 31) || "Feuille";
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function buildStructuredXLSX(input: ReportInput): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const add = (name: string, rows: (string | number)[][], widths?: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name, used));
  };

  add(
    "Synthèse",
    [
      ["Document", "Avis", "Motif de l'avis", "Type", "Type détecté", "Confiance", "Structure(s)", "Section budgétaire (LF)", "Pages", "Mots", "Tableaux", "Bloquantes", "Majeures", "Mineures", "Infos", "Traitées"],
      ...input.docs.map((d) => {
        const a = d.analysis;
        const c = counts(a.anomalies, d.statuses);
        const v = verdictOf(a.anomalies, d.statuses, a.kind);
        return [
          a.fileName,
          v.label,
          v.summary,
          profileOf(a.kind).label,
          profileOf(a.kindDetected).label,
          Math.round(a.kindConfidence * 100) / 100,
          a.departments.map((x) => x.label).join(", "),
          a.budget ? `${a.budget.section.code} — ${a.budget.section.nom}` : "",
          a.stats.pages ?? "",
          a.stats.words,
          a.stats.tables,
          c.bloquante,
          c.majeure,
          c.mineure,
          c.info,
          c.traitees,
        ];
      }),
    ],
    [40, 26, 60, 30, 30, 10, 40, 40, 8, 8, 9, 11, 10, 10, 8, 9],
  );

  const anomalyRow = (doc: string, a: Anomaly, s: AnomalyStatus) => [
    doc,
    SEVERITY_LABEL[a.severity],
    CATEGORY_LABEL[a.category],
    a.title,
    a.detail,
    a.suggestion,
    a.excerpt ?? "",
    a.location.sheet ?? "",
    a.location.section ?? "",
    a.location.table ?? "",
    a.location.row ?? "",
    a.location.column ?? "",
    a.location.page ?? "",
    STATUS_LABEL[s],
    a.rule,
  ];
  add(
    "Anomalies",
    [
      ["Document", "Gravité", "Catégorie", "Anomalie", "Constat", "Correction proposée", "Extrait", "Feuille", "Section", "Tableau", "Ligne", "Colonne", "Page", "Statut", "Règle"],
      ...input.docs.flatMap((d) => d.analysis.anomalies.map((a) => anomalyRow(d.analysis.fileName, a, d.statuses[a.id] ?? "a-traiter"))),
      ...input.corpus.map((a) => anomalyRow("(entre documents)", a, input.corpusStatuses[a.id] ?? "a-traiter")),
    ],
    [30, 10, 18, 40, 70, 70, 50, 12, 40, 40, 20, 20, 6, 10, 22],
  );

  // Rapprochement avec la loi de finances (montants en GNF).
  if (input.docs.some((d) => d.analysis.budget?.comparison.length)) {
    add(
      "Loi de finances",
      [
        ["Document", "Section", "Poste", "Colonne", "Document (GNF)", "Loi de finances (GNF)", "Écart (GNF)"],
        ...input.docs.flatMap((d) => {
          const b = d.analysis.budget;
          if (!b) return [];
          return b.comparison.map((r) => [
            d.analysis.fileName,
            `${b.section.code} — ${b.section.nom}`,
            "  ".repeat(r.level) + r.scope,
            r.column,
            r.document ?? "",
            r.law,
            r.document === null ? "" : r.document - r.law,
          ]);
        }),
      ],
      [30, 40, 50, 12, 20, 20, 20],
    );
  }

  add(
    "Plan",
    [
      ["Document", "Niveau", "Numéro", "Titre", "Titre déduit", "Anomalies"],
      ...input.docs.flatMap((d) =>
        d.analysis.outline.map((o) => [d.analysis.fileName, o.level, o.numbering ?? "", o.text, o.inferred ? "oui" : "non", o.anomalyCount]),
      ),
    ],
    [30, 7, 10, 70, 11, 10],
  );

  add(
    "Indicateurs",
    [
      ["Document", "Source", "Direction / structure", "Activité", "Indicateur", "Type", "Référence", "Cible", "Réalisé", "Taux de réalisation", "Financement", "Responsable", "Source de vérification", "Période"],
      ...input.docs.flatMap((d) =>
        d.analysis.indicators.map((i) => [
          d.analysis.fileName,
          i.source,
          i.department ?? "",
          i.activity ?? "",
          i.label,
          i.type,
          i.reference ?? "",
          i.target ?? "",
          i.achieved ?? "",
          i.rate ?? "",
          i.funding ?? "",
          i.owner ?? "",
          i.verification ?? "",
          i.period ?? "",
        ]),
      ),
    ],
    [30, 30, 30, 40, 45, 12, 12, 12, 12, 12, 16, 16, 25, 14],
  );

  // Tableaux extraits, les uns sous les autres, prêts à être retravaillés
  // (ou analysés dans l'onglet « Données » de DataLab).
  const tableRows: (string | number)[][] = [];
  for (const d of input.docs) {
    for (const t of d.analysis.tables) {
      tableRows.push([`${d.analysis.fileName} — ${t.title}`]);
      if (t.section) tableRows.push([`Section : ${t.section}`]);
      tableRows.push(t.header);
      for (const r of t.body) tableRows.push(r);
      tableRows.push([]);
    }
  }
  add("Tableaux extraits", tableRows.length ? tableRows : [["Aucun tableau"]]);

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

export async function exportStructuredXLSX(input: ReportInput): Promise<void> {
  const bytes = await buildStructuredXLSX(input);
  const saveAs = await loadSaveAs();
  saveAs(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), baseName(input) + ".xlsx");
}
