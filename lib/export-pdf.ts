import type { Analysis, Dataset } from "./types";

// Construit le rapport PDF et renvoie l'objet jsPDF (testable hors navigateur).
async function buildPDFDoc(dataset: Dataset, analysis: Analysis) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 18;

  doc.setFontSize(18);
  doc.text("Rapport d'analyse de données", marginX, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    `Fichier : ${dataset.fileName}  •  Généré le ${new Date().toLocaleString("fr-FR")}`,
    marginX,
    y,
  );
  doc.setTextColor(0);
  y += 8;

  // Synthèse
  doc.setFontSize(13);
  doc.text("Synthèse", marginX, y);
  y += 2;
  autoTable(doc, {
    startY: y + 2,
    head: [["Indicateur", "Valeur"]],
    body: [
      ["Lignes", String(analysis.profile.rowCount)],
      ["Colonnes", String(analysis.profile.columnCount)],
      ["Lignes en double", String(analysis.profile.duplicateRows)],
      ["Valeurs manquantes", String(analysis.profile.totalMissing)],
    ],
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9 },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Observations
  doc.setFontSize(13);
  doc.text("Observations et appréciations", marginX, y);
  y += 6;
  doc.setFontSize(9);
  for (const o of analysis.observations) {
    const lines = doc.splitTextToSize("• " + o, 180);
    if (y > 275) {
      doc.addPage();
      y = 18;
    }
    doc.text(lines, marginX, y);
    y += lines.length * 4.5 + 1;
  }
  y += 4;

  // Profil des colonnes
  if (y > 240) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(13);
  doc.text("Profil des colonnes", marginX, y);
  autoTable(doc, {
    startY: y + 2,
    head: [["Colonne", "Type", "Rempli", "Manq.", "% Manq.", "Uniques", "Moy.", "Méd.", "Outliers"]],
    body: analysis.profile.columns.map((c) => [
      c.name,
      c.type,
      String(c.count),
      String(c.missing),
      String(c.missingPct),
      String(c.unique),
      c.numeric ? String(c.numeric.mean) : "-",
      c.numeric ? String(c.numeric.median) : "-",
      c.outliers != null ? String(c.outliers) : "-",
    ]),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Corrélations
  if (analysis.correlations.length > 0) {
    if (y > 240) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(13);
    doc.text("Corrélations principales", marginX, y);
    autoTable(doc, {
      startY: y + 2,
      head: [["Variable A", "Variable B", "r (Pearson)"]],
      body: analysis.correlations
        .slice(0, 15)
        .map((c) => [c.a, c.b, String(c.r)]),
      theme: "striped",
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 8 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Échantillon de données (30 premières lignes)
  doc.addPage();
  y = 18;
  doc.setFontSize(13);
  doc.text("Échantillon des données nettoyées (30 lignes)", marginX, y);
  const cols = dataset.columns.slice(0, 8);
  autoTable(doc, {
    startY: y + 2,
    head: [cols],
    body: dataset.rows
      .slice(0, 30)
      .map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c])))),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
    styles: { fontSize: 6.5, cellPadding: 1 },
    margin: { left: marginX, right: marginX },
  });

  // Pied de page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `DataLab — page ${i}/${pageCount}`,
      marginX,
      doc.internal.pageSize.getHeight() - 8,
    );
  }

  return doc;
}

// Renvoie les octets du PDF (pour tests / usage programmatique).
export async function buildPDF(
  dataset: Dataset,
  analysis: Analysis,
): Promise<ArrayBuffer> {
  const doc = await buildPDFDoc(dataset, analysis);
  return doc.output("arraybuffer");
}

// Export PDF : construit puis déclenche le téléchargement dans le navigateur.
export async function exportPDF(
  dataset: Dataset,
  analysis: Analysis,
): Promise<void> {
  const doc = await buildPDFDoc(dataset, analysis);
  doc.save(baseName(dataset.fileName) + "_rapport.pdf");
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
