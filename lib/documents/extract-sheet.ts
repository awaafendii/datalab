import type { DocBlock, DocModel } from "./types";

// Extraction d'un classeur (matrices de suivi des indicateurs, tableaux
// budgétaires, CDMT sous Excel…). Chaque feuille devient un titre + un
// tableau. Les en-têtes sur plusieurs lignes fusionnées (« Indicateurs >
// Valeurs > Cible ») sont recomposés en un seul libellé par colonne.

type XLSXModule = typeof import("xlsx");
type Range = { s: { r: number; c: number }; e: { r: number; c: number } };

function cellText(XLSX: XLSXModule, ws: import("xlsx").WorkSheet, r: number, c: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as import("xlsx").CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.v instanceof Date) {
    const d = cell.v;
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  const text = cell.w !== undefined ? cell.w : String(cell.v);
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export async function extractWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): Promise<DocModel> {
  const XLSX = await import("xlsx");
  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: true });
  } catch (e) {
    throw new Error(
      "Impossible de lire ce classeur : il est peut-être protégé par un mot de passe ou endommagé " +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
  }

  const blocks: DocBlock[] = [];
  const warnings: string[] = [];
  const nextId = () => "b" + blocks.length;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const merges: Range[] = (ws["!merges"] as Range[] | undefined) ?? [];
    const width = range.e.c - range.s.c + 1;

    const grid: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(cellText(XLSX, ws, r, c));
      grid.push(row);
    }
    const rel = (m: Range): Range => ({
      s: { r: m.s.r - range.s.r, c: m.s.c - range.s.c },
      e: { r: m.e.r - range.s.r, c: m.e.c - range.s.c },
    });
    const relMerges = merges.map(rel);
    const filled = (row: string[]) => row.filter((v) => v !== "").length;

    // Lignes de titre (une seule cellule remplie) au-dessus du tableau.
    let r0 = grid.findIndex((row) => filled(row) > 0);
    if (r0 < 0) continue;
    const titles: string[] = [];
    while (r0 < grid.length && filled(grid[r0]) === 1 && width > 2 && titles.length < 3) {
      titles.push(grid[r0].find((v) => v !== "")!);
      r0++;
      while (r0 < grid.length && filled(grid[r0]) === 0) r0++;
    }
    if (r0 >= grid.length) {
      blocks.push({ kind: "heading", id: nextId(), level: 1, text: name, inferred: false });
      for (const t of titles) blocks.push({ kind: "paragraph", id: nextId(), text: t, list: false });
      continue;
    }

    // Bloc d'en-têtes : s'étend tant que des fusions commencées dans le bloc
    // descendent plus bas.
    let hEnd = r0;
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of relMerges) {
        if (m.s.r >= r0 && m.s.r <= hEnd && m.e.r > hEnd && m.e.r - r0 < 6) {
          hEnd = m.e.r;
          changed = true;
        }
      }
    }
    const mergedValue = (r: number, c: number): string => {
      const m = relMerges.find((mm) => r >= mm.s.r && r <= mm.e.r && c >= mm.s.c && c <= mm.e.c);
      return m ? grid[m.s.r][m.s.c] : grid[r][c];
    };
    const header: string[] = [];
    for (let c = 0; c < width; c++) {
      const parts: string[] = [];
      for (let r = r0; r <= hEnd; r++) {
        const v = mergedValue(r, c).replace(/\s+/g, " ").trim();
        if (v && parts[parts.length - 1] !== v) parts.push(v);
      }
      header.push(parts.join(" > "));
    }
    const body = grid.slice(hEnd + 1).filter((row) => filled(row) > 0);

    // Colonnes entièrement vides (séparateurs de mise en page) écartées.
    const keep = header.map((h, c) => h !== "" || body.some((row) => row[c] !== ""));
    const pick = (row: string[]) => row.filter((_, c) => keep[c]);

    blocks.push({ kind: "heading", id: nextId(), level: 1, text: name, inferred: false });
    for (const t of titles) blocks.push({ kind: "paragraph", id: nextId(), text: t, list: false });
    blocks.push({
      kind: "table",
      id: nextId(),
      rows: [pick(header), ...body.map(pick)],
      headerRows: 1,
      caption: titles[0] ?? `Feuille « ${name} »`,
      sheet: name,
    });
  }

  if (!blocks.some((b) => b.kind === "table")) {
    warnings.push("Aucun tableau exploitable trouvé dans ce classeur.");
  }
  return { fileName, format: "sheet", blocks, warnings };
}
