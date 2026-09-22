import type { Analysis, Dataset } from "./types";

// Construit le classeur XLSX et renvoie les octets (testable hors navigateur).
export async function buildXLSX(
  dataset: Dataset,
  analysis: Analysis,
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");

  const wb = XLSX.utils.book_new();

  // Feuille 1 : données nettoyées
  const dataSheet = XLSX.utils.json_to_sheet(
    dataset.rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of dataset.columns) o[c] = r[c];
      return o;
    }),
    { header: dataset.columns },
  );
  XLSX.utils.book_append_sheet(wb, dataSheet, "Données nettoyées");

  // Feuille 2 : profil des colonnes
  const profileRows = analysis.profile.columns.map((c) => ({
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
  }));
  const profileSheet = XLSX.utils.json_to_sheet(profileRows);
  XLSX.utils.book_append_sheet(wb, profileSheet, "Profil colonnes");

  // Feuille 3 : corrélations
  if (analysis.correlations.length > 0) {
    const corrSheet = XLSX.utils.json_to_sheet(
      analysis.correlations.map((c) => ({
        "Variable A": c.a,
        "Variable B": c.b,
        "Coefficient de Pearson (r)": c.r,
      })),
    );
    XLSX.utils.book_append_sheet(wb, corrSheet, "Corrélations");
  }

  // Feuille 4 : observations
  const obsSheet = XLSX.utils.aoa_to_sheet([
    ["Observations et appréciations"],
    ...analysis.observations.map((o) => [o]),
  ]);
  XLSX.utils.book_append_sheet(wb, obsSheet, "Observations");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

// Export XLSX : construit puis déclenche le téléchargement dans le navigateur.
export async function exportXLSX(
  dataset: Dataset,
  analysis: Analysis,
): Promise<void> {
  const out = await buildXLSX(dataset, analysis);
  const { saveAs } = await import("file-saver");
  saveAs(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    baseName(dataset.fileName) + "_analyse.xlsx",
  );
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
