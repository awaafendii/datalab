import type { Analysis, Dataset } from "./types";
import { loadSaveAs } from "./save-file";

// Une feuille prête à l'export : données nettoyées + analyse correspondante.
export interface ExportSheet {
  name: string;
  dataset: Dataset;
  analysis: Analysis;
}

// Nettoie un nom pour respecter les contraintes Excel (31 caractères max,
// caractères [ ] : \ / ? * interdits) et évite les doublons entre onglets.
function safeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:\\/?*]/g, " ").trim();
  if (!name) name = "Feuille";
  if (name.length > 31) name = name.slice(0, 31);

  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// Construit le classeur XLSX et renvoie les octets (testable hors navigateur).
// `sheets` contient une entrée par feuille source déjà nettoyée ; s'il y en a
// plusieurs, le classeur ajoute un onglet Sommaire et regroupe profils /
// corrélations / observations avec une colonne "Feuille".
export async function buildXLSX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const multi = sheets.length > 1;

  if (multi) {
    const summaryRows = sheets.map((s) => ({
      Feuille: s.name,
      Lignes: s.analysis.profile.rowCount,
      Colonnes: s.analysis.profile.columnCount,
      "Doublons retirés": s.analysis.profile.duplicateRows,
      "Valeurs manquantes": s.analysis.profile.totalMissing,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summaryRows),
      safeSheetName("Sommaire", used),
    );
  }

  // Une feuille de données nettoyées par feuille source.
  for (const s of sheets) {
    const dataSheet = XLSX.utils.json_to_sheet(
      s.dataset.rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const c of s.dataset.columns) o[c] = r[c];
        return o;
      }),
      { header: s.dataset.columns },
    );
    XLSX.utils.book_append_sheet(
      wb,
      dataSheet,
      safeSheetName(multi ? s.name : "Données nettoyées", used),
    );
  }

  // Profil des colonnes (toutes feuilles regroupées si classeur multi-feuilles).
  const profileRows = sheets.flatMap((s) =>
    s.analysis.profile.columns.map((c) => ({
      ...(multi ? { Feuille: s.name } : {}),
      Colonne: c.name,
      Type: c.type,
      "Valeurs renseignées": c.count,
      Manquantes: c.missing,
      "% Manquantes": c.missingPct,
      "Valeurs uniques": c.unique,
      Moyenne: c.numeric?.mean ?? "",
      Médiane: c.numeric?.median ?? "",
      "Écart-type": c.numeric?.std ?? "",
      Min: c.numeric?.min ?? "",
      Max: c.numeric?.max ?? "",
      Q1: c.numeric?.q1 ?? "",
      Q3: c.numeric?.q3 ?? "",
      Outliers: c.outliers ?? "",
    })),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(profileRows),
    safeSheetName("Profil colonnes", used),
  );

  // Corrélations.
  const corrRows = sheets.flatMap((s) =>
    s.analysis.correlations.map((c) => ({
      ...(multi ? { Feuille: s.name } : {}),
      "Variable A": c.a,
      "Variable B": c.b,
      "Coefficient de Pearson (r)": c.r,
    })),
  );
  if (corrRows.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(corrRows),
      safeSheetName("Corrélations", used),
    );
  }

  // Observations, groupées par feuille si classeur multi-feuilles.
  const obsAoa: unknown[][] = [["Observations et appréciations"]];
  for (const s of sheets) {
    if (multi) obsAoa.push([`— ${s.name} —`]);
    for (const o of s.analysis.observations) obsAoa.push([o]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(obsAoa),
    safeSheetName("Observations", used),
  );

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

// Export XLSX : construit puis déclenche le téléchargement dans le navigateur.
export async function exportXLSX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<void> {
  const out = await buildXLSX(fileName, sheets);
  const saveAs = await loadSaveAs();
  saveAs(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    baseName(fileName) + "_analyse.xlsx",
  );
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
