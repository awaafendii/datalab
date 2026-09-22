import type { Analysis, Dataset } from "./types";

// Construit le document Word et renvoie { doc, Packer } (testable hors navigateur).
async function buildDocument(dataset: Dataset, analysis: Analysis) {
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    TextRun,
    WidthType,
    AlignmentType,
  } = await import("docx");

  const BLUE = "2563EB";

  const cell = (text: string, opts?: { bold?: boolean; fill?: string }) =>
    new TableCell({
      shading: opts?.fill ? { fill: opts.fill, type: "clear", color: "auto" } : undefined,
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text,
              bold: opts?.bold,
              color: opts?.fill ? "FFFFFF" : undefined,
              size: 18,
            }),
          ],
        }),
      ],
    });

  const headerRow = (labels: string[]) =>
    new TableRow({
      children: labels.map((l) => cell(l, { bold: true, fill: BLUE })),
      tableHeader: true,
    });

  const dataRow = (values: string[]) =>
    new TableRow({ children: values.map((v) => cell(v)) });

  const fullWidth = { size: 100, type: WidthType.PERCENTAGE };

  // Tableau de synthèse
  const synthTable = new Table({
    width: fullWidth,
    rows: [
      headerRow(["Indicateur", "Valeur"]),
      dataRow(["Lignes", String(analysis.profile.rowCount)]),
      dataRow(["Colonnes", String(analysis.profile.columnCount)]),
      dataRow(["Lignes en double", String(analysis.profile.duplicateRows)]),
      dataRow(["Valeurs manquantes", String(analysis.profile.totalMissing)]),
    ],
  });

  // Tableau de profil
  const profileTable = new Table({
    width: fullWidth,
    rows: [
      headerRow(["Colonne", "Type", "Rempli", "Manq.", "% Manq.", "Uniques", "Moy.", "Méd.", "Outliers"]),
      ...analysis.profile.columns.map((c) =>
        dataRow([
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
      ),
    ],
  });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      text: "Rapport d'analyse de données",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `Fichier : ${dataset.fileName}  •  Généré le ${new Date().toLocaleString("fr-FR")}`,
          italics: true,
          color: "666666",
          size: 18,
        }),
      ],
    }),
    new Paragraph({ text: "Synthèse", heading: HeadingLevel.HEADING_1 }),
    synthTable,
    new Paragraph({ text: "" }),
    new Paragraph({
      text: "Observations et appréciations",
      heading: HeadingLevel.HEADING_1,
    }),
    ...analysis.observations.map(
      (o) => new Paragraph({ text: o, bullet: { level: 0 } }),
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      text: "Profil des colonnes",
      heading: HeadingLevel.HEADING_1,
    }),
    profileTable,
  ];

  if (analysis.correlations.length > 0) {
    children.push(
      new Paragraph({ text: "" }),
      new Paragraph({
        text: "Corrélations principales",
        heading: HeadingLevel.HEADING_1,
      }),
      new Table({
        width: fullWidth,
        rows: [
          headerRow(["Variable A", "Variable B", "r (Pearson)"]),
          ...analysis.correlations
            .slice(0, 15)
            .map((c) => dataRow([c.a, c.b, String(c.r)])),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return { doc, Packer };
}

// Renvoie les octets du .docx (pour tests / usage programmatique).
export async function buildDOCX(
  dataset: Dataset,
  analysis: Analysis,
): Promise<Buffer> {
  const { doc, Packer } = await buildDocument(dataset, analysis);
  return Packer.toBuffer(doc);
}

// Export Word : construit puis déclenche le téléchargement dans le navigateur.
export async function exportDOCX(
  dataset: Dataset,
  analysis: Analysis,
): Promise<void> {
  const { doc, Packer } = await buildDocument(dataset, analysis);
  const { saveAs } = await import("file-saver");
  const blob = await Packer.toBlob(doc);
  saveAs(blob, baseName(dataset.fileName) + "_rapport.docx");
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
