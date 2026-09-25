import type { DepartmentMatch, DocKind, DocModel } from "./types";
import { DEPARTMENTS, KIND_PROFILES } from "./referentiel";
import { norm } from "./text";
import { blockText } from "./structure";

// Reconnaissance du type de document et des directions concernées, à partir
// du titre, du nom du fichier, des titres de sections et des tableaux.

export interface KindGuess {
  kind: DocKind;
  confidence: number;
  reasons: string[];
}

function titleZone(doc: DocModel): string {
  const parts: string[] = [];
  for (const b of doc.blocks.slice(0, 14)) {
    if (b.kind === "heading" || b.kind === "paragraph") parts.push(b.text);
    else if (b.kind === "table") parts.push(b.rows.slice(0, 2).flat().join(" "));
    if (parts.join(" ").length > 900) break;
  }
  return parts.join(" \n ");
}

// Une matrice d'indicateurs se reconnaît à ses colonnes, quel que soit le
// format (feuille Excel ou tableau Word).
function indicatorMatrixScore(doc: DocModel): number {
  let best = 0;
  for (const b of doc.blocks) {
    if (b.kind !== "table" || b.rows.length < 2) continue;
    const head = norm(b.rows.slice(0, 3).flat().join(" | "));
    let s = 0;
    if (/indicateur/.test(head)) s++;
    if (/cible/.test(head)) s++;
    if (/reference|situation de base|baseline/.test(head)) s++;
    if (/source de verification|moyens? de verification/.test(head)) s++;
    if (/realis|atteint/.test(head)) s++;
    if (/responsable/.test(head)) s++;
    if (/activites?/.test(head)) s++;
    best = Math.max(best, s);
  }
  return best;
}

export function classifyDocument(doc: DocModel): KindGuess {
  const title = norm(titleZone(doc) + " " + doc.fileName.replace(/[_.-]+/g, " "));
  const headings = norm(
    doc.blocks
      .filter((b) => b.kind === "heading")
      .map((b) => blockText(b))
      .join(" \n "),
  );
  const scores = new Map<DocKind, { score: number; reasons: string[] }>();
  for (const p of KIND_PROFILES) {
    let score = 0;
    const reasons: string[] = [];
    for (const re of p.title) {
      const m = title.match(re);
      if (m) {
        score += 3;
        reasons.push(`titre : « ${m[0]} »`);
      }
    }
    for (const re of p.body) {
      const m = headings.match(re);
      if (m) {
        score += 1;
        reasons.push(`section : « ${m[0]} »`);
      }
    }
    scores.set(p.kind, { score, reasons });
  }

  // Les signaux « tableaux » priment pour les matrices et les CDMT.
  const matrix = indicatorMatrixScore(doc);
  const textBlocks = doc.blocks.filter((b) => b.kind === "paragraph").length;
  const m = scores.get("matrice-indicateurs")!;
  if (matrix >= 3) {
    m.score += matrix >= 4 ? 6 : 3;
    m.reasons.push(`tableau à colonnes d'indicateurs (${matrix} colonnes reconnues)`);
    if (doc.format === "sheet" || textBlocks < 5) m.score += 4;
  }
  const yearHeaders = doc.blocks.some(
    (b) =>
      b.kind === "table" &&
      b.rows.slice(0, 3).some((r) => r.filter((c) => /^(?:\D{0,20})(?:19|20)\d{2}$|^n\s*\+\s*[12]$/i.test(c.trim())).length >= 3),
  );
  if (yearHeaders && /programme|nature economique|personnel|biens et services|dotation|credits/.test(norm(doc.blocks.map(blockText).join(" ")).slice(0, 200000))) {
    const c = scores.get("cdmt")!;
    c.score += 2;
    c.reasons.push("tableaux pluriannuels (plusieurs années en colonnes)");
  }

  // Un rapport d'activités qui évalue un projet reste un rapport d'activités :
  // en cas d'égalité, l'ordre du référentiel (du plus spécifique au plus
  // général) départage.
  const ranked = KIND_PROFILES.filter((p) => p.kind !== "autre")
    .map((p) => ({ kind: p.kind, ...scores.get(p.kind)! }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 2) {
    return { kind: "autre", confidence: 0.2, reasons: ["aucun indice suffisant : seuls les contrôles généraux s'appliquent"] };
  }
  const second = ranked[1]?.score ?? 0;
  const confidence = Math.max(0.35, Math.min(0.97, 0.5 + (best.score - second) / (best.score + 4)));
  return { kind: best.kind, confidence, reasons: best.reasons.slice(0, 4) };
}

// Directions / familles de services concernées : sigles de structures et
// vocabulaire métier (titre pondéré plus fortement que le corps).
export function detectDepartments(doc: DocModel): DepartmentMatch[] {
  const titleRaw = titleZone(doc) + " " + doc.fileName;
  const bodyRaw = doc.blocks.map(blockText).join("\n").slice(0, 400000);
  const title = norm(titleRaw);
  const body = norm(bodyRaw);
  const sheetNames = doc.blocks.filter((b) => b.kind === "table" && b.sheet).map((b) => (b as { sheet?: string }).sheet!);
  const out: DepartmentMatch[] = [];
  for (const d of DEPARTMENTS) {
    let score = 0;
    const evidence: string[] = [];
    for (const s of d.sigles) {
      const re = new RegExp(`(^|[^A-Za-z])${s.replace(/[-/]/g, "\\$&")}([^A-Za-z]|$)`);
      if (re.test(titleRaw)) {
        score += 5;
        evidence.push(s);
      } else if (sheetNames.some((n) => n.toUpperCase().includes(s))) {
        score += 5;
        evidence.push(`feuille ${s}`);
      } else {
        const count = (bodyRaw.match(new RegExp(`(^|[^A-Za-z])${s.replace(/[-/]/g, "\\$&")}(?=[^A-Za-z]|$)`, "g")) ?? []).length;
        if (count > 0) {
          score += Math.min(3, count * 0.5);
          if (count >= 2) evidence.push(`${s} ×${count}`);
        }
      }
    }
    for (const re of d.keywords) {
      const tm = title.match(re);
      if (tm) {
        score += 3;
        evidence.push(`« ${tm[0]} »`);
      }
      const g = new RegExp(re.source, "g");
      const n = (body.match(g) ?? []).length;
      if (n > 0) score += Math.min(4, Math.log2(1 + n));
    }
    if (score >= 3) out.push({ id: d.id, label: d.label, score: Math.round(score * 10) / 10, evidence: evidence.slice(0, 4) });
  }
  out.sort((a, b) => b.score - a.score);
  const top = out[0]?.score ?? 0;
  return out.filter((d) => d.score >= top * 0.5).slice(0, 3);
}
