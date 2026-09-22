// file-saver n'exporte qu'une fonction (CommonJS, pas de named export réel :
// `module.exports = saveAs` avec `saveAs.saveAs = saveAs`). Selon l'outil de
// build, `import("file-saver")` expose cette fonction soit via `.default`,
// soit via `.saveAs` — jamais garanti des deux côtés. On essaie les deux
// pour rester robuste plutôt que de dépendre d'un seul mécanisme d'interop.
export async function loadSaveAs(): Promise<
  (data: Blob, filename?: string) => void
> {
  const mod = (await import("file-saver")) as unknown as {
    default?: (data: Blob, filename?: string) => void;
    saveAs?: (data: Blob, filename?: string) => void;
  };
  const fn = mod.default ?? mod.saveAs;
  if (typeof fn !== "function") {
    throw new Error("Impossible de charger le module de téléchargement (file-saver).");
  }
  return fn;
}
