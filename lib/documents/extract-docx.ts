import JSZip from "jszip";
import type { DocBlock, DocModel, TableBlock } from "./types";
import { attr, child, children, isElement, parseXml, type XmlElement } from "./xml";

// Extraction d'un .docx : titres (d'après les styles du document), paragraphes,
// listes, tableaux (fusions de cellules comprises) et illustrations, dans
// l'ordre de lecture. Tout se fait localement.

interface StyleInfo {
  name: string;
  basedOn?: string;
  outlineLvl?: number;
}

function readStyles(xml: string | null): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  const root = parseXml(xml);
  const styles = child(root, "w:styles");
  if (!styles) return map;
  for (const st of children(styles, "w:style")) {
    const id = attr(st, "w:styleId");
    if (!id) continue;
    const outline = attr(child(child(st, "w:pPr"), "w:outlineLvl"), "w:val");
    map.set(id, {
      name: attr(child(st, "w:name"), "w:val") ?? id,
      basedOn: attr(child(st, "w:basedOn"), "w:val"),
      outlineLvl: outline !== undefined ? parseInt(outline, 10) : undefined,
    });
  }
  return map;
}

type ParaRole = { kind: "heading"; level: number } | { kind: "toc" } | { kind: "body" };

function paragraphRole(p: XmlElement, styles: Map<string, StyleInfo>): ParaRole {
  const pPr = child(p, "w:pPr");
  const direct = attr(child(pPr, "w:outlineLvl"), "w:val");
  let id = attr(child(pPr, "w:pStyle"), "w:val");
  if (direct !== undefined) {
    const lvl = parseInt(direct, 10);
    if (lvl >= 0 && lvl < 9) return { kind: "heading", level: lvl + 1 };
  }
  for (let guard = 0; id && guard < 12; guard++) {
    const st = styles.get(id);
    const name = (st?.name ?? id).toLowerCase().trim();
    if (/^(toc|tm)\s?\d$|table of figures|table des illustrations|^toc heading$/.test(name)) return { kind: "toc" };
    if (st?.outlineLvl !== undefined && st.outlineLvl < 9) return { kind: "heading", level: st.outlineLvl + 1 };
    const m = name.match(/^(?:heading|titre)\s*(\d)$/);
    if (m) return { kind: "heading", level: Math.max(1, parseInt(m[1], 10)) };
    if (name === "title" || name === "titre") return { kind: "heading", level: 1 };
    id = st?.basedOn;
  }
  return { kind: "body" };
}

interface TextAcc {
  text: string;
  image: boolean;
  pageBreaks: number;
}

// Parcourt un paragraphe : texte visible, tabulations, sauts de ligne,
// illustrations. Ignore le texte supprimé (révisions) et les doublons
// « mc:Fallback » des zones de texte.
function collectText(el: XmlElement, acc: TextAcc): void {
  for (const c of el.children) {
    if (!isElement(c)) continue;
    switch (c.name) {
      case "w:t":
        for (const t of c.children) if (typeof t === "string") acc.text += t;
        break;
      case "w:tab":
        acc.text += "\t";
        break;
      case "w:br":
        if (attr(c, "w:type") === "page") acc.pageBreaks++;
        else acc.text += "\n";
        break;
      case "w:cr":
        acc.text += "\n";
        break;
      case "w:noBreakHyphen":
        acc.text += "-";
        break;
      case "w:lastRenderedPageBreak":
        acc.pageBreaks++;
        break;
      case "w:drawing":
      case "w:pict":
      case "w:object":
        acc.image = true;
        collectText(c, acc); // zones de texte éventuelles
        break;
      case "mc:Fallback":
      case "w:del":
      case "w:instrText":
      case "w:delText":
        break;
      case "w:p":
        if (acc.text && !/\s$/.test(acc.text)) acc.text += " ";
        collectText(c, acc);
        break;
      default:
        collectText(c, acc);
    }
  }
}

function cellText(tc: XmlElement): { text: string; image: boolean } {
  const parts: string[] = [];
  let image = false;
  const visit = (el: XmlElement) => {
    for (const c of el.children) {
      if (!isElement(c)) continue;
      if (c.name === "w:p") {
        const acc: TextAcc = { text: "", image: false, pageBreaks: 0 };
        collectText(c, acc);
        image ||= acc.image;
        const t = acc.text.replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
      } else if (c.name !== "w:tcPr") {
        visit(c); // tableaux imbriqués, contrôles de contenu
      }
    }
  };
  visit(tc);
  return { text: parts.join(" "), image };
}

function readTable(tbl: XmlElement, id: string): TableBlock {
  const rows: string[][] = [];
  const spans: number[][] = [];
  let headerRows = 0;
  let headerRun = true;
  for (const tr of children(tbl, "w:tr")) {
    const trPr = child(tr, "w:trPr");
    const isHeader = !!child(trPr, "w:tblHeader") && attr(child(trPr, "w:tblHeader"), "w:val") !== "0";
    if (headerRun && isHeader) headerRows++;
    else headerRun = false;
    const row: string[] = [];
    const rowSpans: number[] = [];
    const before = parseInt(attr(child(trPr, "w:gridBefore"), "w:val") ?? "0", 10) || 0;
    for (let i = 0; i < before; i++) {
      row.push("");
      rowSpans.push(1);
    }
    // Les cellules peuvent être enveloppées dans des contrôles de contenu.
    const cells: XmlElement[] = [];
    const gather = (el: XmlElement) => {
      for (const c of children(el)) {
        if (c.name === "w:tc") cells.push(c);
        else if (c.name === "w:sdt" || c.name === "w:sdtContent" || c.name === "w:customXml") gather(c);
      }
    };
    gather(tr);
    for (const tc of cells) {
      const span = Math.max(1, parseInt(attr(child(child(tc, "w:tcPr"), "w:gridSpan"), "w:val") ?? "1", 10) || 1);
      row.push(cellText(tc).text);
      rowSpans.push(span);
      for (let i = 1; i < span; i++) {
        row.push("");
        rowSpans.push(0);
      }
    }
    rows.push(row);
    spans.push(rowSpans);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  rows.forEach((r, i) => {
    while (r.length < width) {
      r.push("");
      spans[i].push(1);
    }
  });
  return { kind: "table", id, rows, spans, headerRows: headerRows || undefined };
}

export async function extractDocx(data: ArrayBuffer | Uint8Array, fileName: string): Promise<DocModel> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error(
      "Impossible d'ouvrir ce fichier Word. S'il s'agit d'un ancien format .doc, enregistrez-le en .docx depuis Word puis réessayez.",
    );
  }
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("Ce fichier .docx ne contient pas de document Word lisible.");
  const styles = readStyles((await zip.file("word/styles.xml")?.async("string")) ?? null);
  const root = parseXml(docXml);
  const body = child(child(root, "w:document"), "w:body");
  if (!body) throw new Error("Document Word vide ou illisible.");

  const blocks: DocBlock[] = [];
  let page = 1;
  let sawPageMarkers = false;
  const nextId = () => "b" + blocks.length;

  const visit = (el: XmlElement) => {
    for (const c of children(el)) {
      if (c.name === "w:p") {
        const acc: TextAcc = { text: "", image: false, pageBreaks: 0 };
        collectText(c, acc);
        const startPage = page;
        if (acc.pageBreaks > 0) {
          sawPageMarkers = true;
          page += acc.pageBreaks;
        }
        const role = paragraphRole(c, styles);
        if (role.kind === "toc") continue;
        // Les tabulations sont conservées : elles servent à reconnaître les
        // « tableaux » saisis au clavier (voir tabbedTables).
        const text = acc.text.replace(/ +/g, " ").replace(/ *\t */g, "\t").replace(/\s*\n\s*/g, "\n").trim();
        if (text) {
          if (role.kind === "heading") {
            blocks.push({ kind: "heading", id: nextId(), level: role.level, text: text.replace(/\n/g, " "), inferred: false, page: startPage });
          } else {
            const list = !!child(child(c, "w:pPr"), "w:numPr");
            blocks.push({ kind: "paragraph", id: nextId(), text, list, page: startPage });
          }
        }
        if (acc.image) blocks.push({ kind: "figure", id: nextId(), page: startPage });
      } else if (c.name === "w:tbl") {
        const t = readTable(c, nextId());
        t.page = page;
        blocks.push(t);
      } else if (c.name === "w:sdt" || c.name === "w:sdtContent" || c.name === "w:customXml") {
        visit(c);
      }
    }
  };
  visit(body);
  const merged = tabbedTables(blocks);

  // Sans marqueurs de page enregistrés par Word (ou avec trop peu de
  // marqueurs pour le volume de texte), les numéros de page seraient faux.
  const words = merged.reduce((n, b) => n + (b.kind === "paragraph" || b.kind === "heading" ? b.text.split(/\s+/).length : 0), 0);
  if (sawPageMarkers && words / page > 1200) sawPageMarkers = false;
  if (!sawPageMarkers) for (const b of merged) delete b.page;

  const warnings: string[] = [];
  if (!merged.some((b) => b.kind !== "figure")) {
    warnings.push("Aucun texte trouvé dans ce document Word (il ne contient peut-être que des images).");
  }
  return { fileName, format: "docx", blocks: merged, pageCount: sawPageMarkers ? page : undefined, warnings };
}

// Plusieurs paragraphes consécutifs alignés par tabulations (« Étape ⇥
// Activité ⇥ Responsable ⇥ Échéance ») forment un tableau saisi au clavier :
// on le reconstruit pour pouvoir le contrôler comme un vrai tableau.
function tabbedTables(blocks: DocBlock[]): DocBlock[] {
  const out: DocBlock[] = [];
  const cells = (b: DocBlock) =>
    b.kind === "paragraph" && !b.list && (b.text.match(/\t/g) ?? []).length >= 2 ? b.text.split(/\t+/).map((c) => c.trim()) : null;
  for (let i = 0; i < blocks.length; i++) {
    const first = cells(blocks[i]);
    if (!first) {
      out.push(blocks[i]);
      continue;
    }
    const rows: string[][] = [first];
    let j = i + 1;
    for (; j < blocks.length; j++) {
      const row = cells(blocks[j]);
      if (!row || Math.abs(row.length - first.length) > 1) break;
      rows.push(row);
    }
    if (rows.length < 2) {
      out.push(blocks[i]);
      continue;
    }
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((r) => {
      while (r.length < width) r.push("");
    });
    out.push({ kind: "table", id: blocks[i].id, rows, page: blocks[i].page });
    i = j - 1;
  }
  out.forEach((b, k) => (b.id = "b" + k));
  return out;
}
