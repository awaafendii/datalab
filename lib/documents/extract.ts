import type { DocModel } from "./types";
import type { PdfjsLike } from "./extract-pdf";

// Point d'entrée navigateur : choisit l'extracteur selon l'extension.
// Chaque bibliothèque n'est chargée qu'à la première utilisation.

const SHEET_EXTENSIONS = [".xlsx", ".xlsm", ".xls", ".ods"];
export const DOC_EXTENSIONS = [".docx", ".pdf", ...SHEET_EXTENSIONS];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

let pdfjsPromise: Promise<PdfjsLike> | null = null;

// Version « legacy » de pdf.js : compatible avec les navigateurs plus
// anciens. Le worker est servi par l'application elle-même depuis public/
// (copié par scripts/copy-pdf-worker.mjs), sans aucun CDN.
function loadPdfjs(): Promise<PdfjsLike> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs as unknown as PdfjsLike;
  });
  return pdfjsPromise;
}

export async function extractFile(file: File): Promise<DocModel> {
  const ext = extensionOf(file.name);
  if (ext === ".doc") {
    throw new Error("Ancien format Word (.doc) : ouvrez-le dans Word et enregistrez-le en .docx, puis réessayez.");
  }
  if (!DOC_EXTENSIONS.includes(ext)) {
    throw new Error(`Format non pris en charge${ext ? ` (${ext})` : ""}. Formats acceptés : ${DOC_EXTENSIONS.join(", ")}.`);
  }
  const data = await file.arrayBuffer();
  if (ext === ".docx") {
    const { extractDocx } = await import("./extract-docx");
    return extractDocx(data, file.name);
  }
  if (ext === ".pdf") {
    const [{ extractPdf }, pdfjs] = await Promise.all([import("./extract-pdf"), loadPdfjs()]);
    return extractPdf(data, file.name, pdfjs);
  }
  const { extractWorkbook } = await import("./extract-sheet");
  return extractWorkbook(data, file.name);
}
