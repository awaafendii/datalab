import type { Anomaly, DocAnalysis, DocKind, DocModel, OutlineItem, TableSummary } from "./types";
import { SEVERITY_ORDER } from "./types";
import { buildContext } from "./structure";
import { classifyDocument, detectDepartments } from "./classify";
import { tableRules } from "./rules/tables";
import { consistencyRules } from "./rules/consistency";
import { writingRules } from "./rules/writing";
import { structureRules } from "./rules/structure";
import { indicatorRules } from "./rules/indicators";
import { budgetRules } from "./rules/budget";
import { sigleRules } from "./rules/sigles";
import { requirementRules } from "./rules/requirements";
import { cdmtRules } from "./rules/cdmt";
import { lfDocumentNotice, lfRules } from "./rules/loi-finances";
import { corpusRules, type CorpusInput } from "./rules/corpus";
import { wordCount } from "./text";

// Point d'entrée de l'analyse : structuration puis contrôles. 100 % local,
// déterministe (le même document donne toujours les mêmes anomalies).

export interface DocumentResult {
  analysis: DocAnalysis;
  corpus: CorpusInput;
}

// `sectionOverride` : code de section budgétaire choisi par l'utilisateur
// quand le rattachement automatique à un ministère est absent ou erroné.
export function analyzeDocument(doc: DocModel, kindOverride?: DocKind, sectionOverride?: string): DocumentResult {
  const guess = classifyDocument(doc);
  const kind = kindOverride ?? guess.kind;
  const ctx = buildContext(doc, kind);
  const departments = detectDepartments(doc);

  // La loi de finances est le référentiel des contrôles : elle n'est pas
  // contrôlée comme un rapport, on indique seulement si elle correspond au
  // référentiel intégré.
  const reference = kind === "loi-finances";
  const indicators = reference ? { anomalies: [], indicators: [] } : indicatorRules(ctx, departments);
  const sigles = sigleRules(ctx);
  const lf = reference ? { link: null, anomalies: lfDocumentNotice(ctx) } : lfRules(ctx, sectionOverride);
  const all: Anomaly[] = reference
    ? lf.anomalies
    : [
        ...tableRules(ctx),
        ...consistencyRules(ctx),
        ...budgetRules(ctx),
        ...indicators.anomalies,
        ...structureRules(ctx),
        ...requirementRules(ctx),
        ...cdmtRules(ctx),
        ...lf.anomalies,
        ...sigles.anomalies,
        ...writingRules(ctx),
      ];

  // Une même anomalie ne doit apparaître qu'une fois.
  const byId = new Map<string, Anomaly>();
  for (const a of all) if (!byId.has(a.id)) byId.set(a.id, a);
  const position = new Map(ctx.blocks.map((b, i) => [b.id, i]));
  const anomalies = [...byId.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (position.get(a.location.blockId ?? "") ?? -1) - (position.get(b.location.blockId ?? "") ?? -1),
  );

  // Nombre d'anomalies rattachées à chaque section du plan.
  const perHeading = new Map<number, number>();
  for (const a of anomalies) {
    const i = position.get(a.location.blockId ?? "");
    if (i === undefined) continue;
    const h = ctx.headingOf[i];
    if (h >= 0) perHeading.set(h, (perHeading.get(h) ?? 0) + 1);
  }
  const outline: OutlineItem[] = ctx.headings.map((h, k) => ({
    level: h.block.level,
    text: h.block.text,
    numbering: h.numbering?.raw ?? null,
    blockId: h.block.id,
    inferred: h.block.inferred,
    anomalyCount: perHeading.get(k) ?? 0,
  }));

  const tables: TableSummary[] = ctx.tables
    .filter((t) => !t.empty)
    .map((t) => ({
      blockId: t.block.id,
      title: t.title,
      section: t.section,
      rows: t.body.length,
      cols: t.header.length,
      header: t.header,
      body: t.body,
    }));

  const paragraphs = ctx.blocks.filter((b) => b.kind === "paragraph");
  const words = ctx.blocks.reduce(
    (n, b) =>
      n +
      (b.kind === "paragraph" || b.kind === "heading"
        ? wordCount(b.text)
        : b.kind === "table"
          ? wordCount(b.rows.flat().join(" "))
          : 0),
    0,
  );

  const analysis: DocAnalysis = {
    fileName: doc.fileName,
    format: doc.format,
    kind,
    kindDetected: guess.kind,
    kindConfidence: guess.confidence,
    kindReasons: guess.reasons,
    departments,
    outline,
    tables,
    indicators: indicators.indicators,
    stats: {
      words,
      paragraphs: paragraphs.length,
      headings: ctx.headings.length,
      tables: ctx.tables.length,
      figures: ctx.blocks.filter((b) => b.kind === "figure").length,
      pages: doc.pageCount,
    },
    anomalies,
    warnings: doc.warnings,
    budget: lf.link,
  };

  // Le texte de la loi n'entre pas dans les contrôles entre documents.
  const corpus: CorpusInput = {
    name: doc.fileName,
    paragraphs: (reference ? [] : ctx.blocks)
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.kind === "paragraph")
      .map(({ b, i }) => ({ text: (b as { text: string }).text, section: ctx.pathOf[i].join(" › ") })),
    sigles: reference ? [] : sigles.definitions.map((d) => ({ sigle: d.sigle, expansion: d.expansion })),
  };
  return { analysis, corpus };
}

export function analyzeCorpus(inputs: CorpusInput[]): Anomaly[] {
  return corpusRules(inputs).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
