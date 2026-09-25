import type { DocBlock, DocModel } from "./types";
import { upperRatio, wordCount } from "./text";

// Extraction d'un PDF « texte » avec pdf.js : reconstitution des lignes,
// des paragraphes, des listes et des titres (d'après la taille de police,
// les majuscules et les libellés terminés par « : »). Les tableaux d'un PDF
// n'ont pas de structure exploitable : ils sont lus comme du texte, et
// l'utilisateur en est averti. La bibliothèque est injectée pour pouvoir
// utiliser la même fonction dans le navigateur (worker) et dans les tests.

export interface PdfjsLike {
  getDocument(src: any): { promise: Promise<any> };
  OPS?: Record<string, number>;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  page: number;
  gaps: number; // grands espaces internes (indice de mise en page en colonnes)
}

const BULLET_RE = /^([-•●▪■◦*–➢➤►✓]|\d{1,2}[.)]|[a-z][.)])\s+/;

function linesOfPage(items: Item[], page: number): Line[] {
  const sorted = items
    .filter((i) => i.str.trim() !== "" || i.str === " ")
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, 0.4 * Math.max(r[0].size, it.size)));
    if (row) row.push(it);
    else rows.push([it]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -Infinity;
      let gaps = 0;
      const size = Math.max(...row.map((r) => r.size));
      for (const it of row) {
        const gap = it.x - end;
        if (text && gap > 0.25 * size && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
        if (text && gap > 2.5 * size) gaps++;
        text += it.str;
        end = it.x + it.w;
      }
      return { text: text.replace(/\s+/g, " ").trim(), x: row[0].x, y: row[0].y, size, page, gaps };
    })
    .filter((l) => l.text !== "")
    .sort((a, b) => b.y - a.y);
}

function isPageNumber(text: string): boolean {
  return /^(page\s*)?\d{1,3}(\s*(\/|sur)\s*\d{1,3})?$/i.test(text.trim());
}

export async function extractPdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  pdfjs: PdfjsLike,
): Promise<DocModel> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let pdf: any;
  try {
    // isEvalSupported: false — jamais d'évaluation de code issu du PDF.
    pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
      .promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new Error("Ce PDF est protégé par un mot de passe : impossible de le lire.");
    throw new Error(`Impossible de lire ce PDF (${msg}).`);
  }

  const lines: Line[] = [];
  const emptyPages: number[] = [];
  const pagesWithImages: number[] = [];
  const imageOps = pdfjs.OPS
    ? new Set(
        ["paintImageXObject", "paintInlineImageXObject", "paintImageMaskXObject", "paintJpegXObject"]
          .map((k) => pdfjs.OPS![k])
          .filter((v) => v !== undefined),
      )
    : null;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== "string") continue;
      const t = it.transform as number[];
      items.push({
        str: it.str,
        x: t[4],
        y: t[5],
        w: it.width ?? 0,
        size: Math.hypot(t[2], t[3]) || it.height || 10,
      });
    }
    const pageLines = linesOfPage(items, p).filter((l) => !isPageNumber(l.text));
    if (pageLines.reduce((n, l) => n + l.text.length, 0) < 20) emptyPages.push(p);
    lines.push(...pageLines);
    if (imageOps) {
      try {
        const ops = await page.getOperatorList();
        if ((ops.fnArray as number[]).some((f) => imageOps.has(f))) pagesWithImages.push(p);
      } catch {
        // la détection d'images est un bonus : on continue sans
      }
    }
    page.cleanup?.();
  }

  // Taille du corps de texte = taille la plus fréquente (pondérée par les caractères).
  const bySize = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    bySize.set(k, (bySize.get(k) ?? 0) + l.text.length);
  }
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const headingSizes = [...bySize.keys()].filter((s) => s >= body * 1.15).sort((a, b) => b - a);

  const headingLevel = (l: Line): number | null => {
    const text = l.text;
    // Intertitre en capitales précédé d'une puce décorative (« ➢ CONCLUSION : »).
    const bulleted = text.match(/^[➢➤►•●▪■◦*–-]\s+(.+)$/u);
    if (bulleted) {
      const rest = bulleted[1];
      const letters = (rest.match(/\p{L}/gu) ?? []).length;
      const isTitle = letters >= 4 && upperRatio(rest) >= 0.8 && wordCount(rest) <= 8 && !/:\s*\S/.test(rest);
      return isTitle ? Math.min(4, headingSizes.length + 1) : null;
    }
    if (BULLET_RE.test(text) && !/^\d{1,2}[.)]\s+\p{Lu}/u.test(text)) return null;
    if (wordCount(text) > 14 || text.length > 120) return null;
    if (/[.;,]$/.test(text)) return null;
    // « SITE : MINISTERE… » est un champ (libellé : valeur), pas un titre.
    const colon = text.indexOf(":");
    if (colon > 0 && colon < text.length - 1 && text.slice(colon + 1).trim().length > 2) return null;
    const k = Math.round(l.size * 2) / 2;
    if (k >= body * 1.15) return Math.min(3, headingSizes.indexOf(k) + 1 || 1);
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters >= 4 && upperRatio(text) >= 0.8) return Math.min(4, headingSizes.length + 1);
    if (/:$/.test(text) && wordCount(text) <= 6 && /^\p{Lu}/u.test(text)) return Math.min(4, headingSizes.length + 2);
    return null;
  };

  const blocks: DocBlock[] = [];
  const nextId = () => "b" + blocks.length;
  let current: { text: string; list: boolean; page: number; x: number; size: number; y: number } | null = null;
  const flush = () => {
    if (current && current.text.trim()) {
      blocks.push({ kind: "paragraph", id: nextId(), text: current.text.trim(), list: current.list, page: current.page });
    }
    current = null;
  };
  let prev: Line | null = null;
  for (const l of lines) {
    const level = headingLevel(l);
    if (level !== null) {
      flush();
      blocks.push({
        kind: "heading",
        id: nextId(),
        level,
        text: l.text.replace(/^[➢➤►•●▪■◦*–-]\s+/u, "").replace(/\s*:$/, ""),
        inferred: true,
        page: l.page,
      });
      prev = l;
      continue;
    }
    const bullet = BULLET_RE.test(l.text);
    const samePage = prev !== null && prev.page === l.page;
    const gap = samePage && prev ? prev.y - l.y : Infinity;
    const cur = current as { text: string; list: boolean; page: number; x: number; size: number; y: number } | null;
    const continues =
      cur !== null &&
      !bullet &&
      ((samePage && gap <= 1.9 * Math.max(cur.size, l.size)) || (!samePage && /^\p{Ll}/u.test(l.text))) &&
      Math.abs(cur.size - l.size) <= 0.15 * cur.size &&
      !/:$/.test(cur.text);
    if (continues && cur) {
      cur.text = /-$/.test(cur.text) && /^\p{Ll}/u.test(l.text) ? cur.text.slice(0, -1) + l.text : cur.text + " " + l.text;
      cur.y = l.y;
    } else {
      flush();
      current = { text: l.text, list: bullet, page: l.page, x: l.x, size: l.size, y: l.y };
    }
    prev = l;
  }
  flush();
  for (const p of pagesWithImages) {
    const idx = blocks.findIndex((b) => (b.page ?? 0) > p);
    const fig: DocBlock = { kind: "figure", id: "fig" + p, page: p };
    if (idx < 0) blocks.push(fig);
    else blocks.splice(idx, 0, fig);
  }
  blocks.forEach((b, i) => (b.id = "b" + i));

  const warnings: string[] = [];
  if (emptyPages.length === pdf.numPages) {
    warnings.push(
      "PDF scanné (images de pages) : aucun texte exploitable. Utilisez la version Word ou un PDF « texte » ; la reconnaissance de caractères (OCR) n'est pas encore disponible.",
    );
  } else if (emptyPages.length > 0) {
    warnings.push(`Page(s) sans texte lisible (probablement scannée(s)) : ${emptyPages.join(", ")}. Leur contenu n'est pas contrôlé.`);
  }
  const tabular = lines.filter((l) => l.gaps >= 2).length;
  if (tabular >= 5 && tabular / Math.max(1, lines.length) > 0.08) {
    warnings.push(
      "Ce PDF semble contenir des tableaux : ils sont lus comme du texte, donc les totaux et pourcentages ne peuvent pas être recalculés. Chargez la version Word ou Excel pour un contrôle complet des chiffres.",
    );
  }
  return { fileName, format: "pdf", blocks, pageCount: pdf.numPages, pagesWithImages, warnings };
}
