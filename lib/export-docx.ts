import type { Analysis, Dataset } from "./types";
import { loadSaveAs } from "./save-file";

// Une feuille prête à l'export : données nettoyées + analyse correspondante.
export interface ExportSheet {
  name: string;
  dataset: Dataset;
  analysis: Analysis;
}

// Construit le document Word et renvoie { doc, Packer } (testable hors navigateur).
// Avec une seule feuille, produit exactement le même rapport qu'avant. Avec
// plusieurs, ajoute un sommaire puis une section par feuille (saut de page).
async function buildDocument(fileName: string, sheets: ExportSheet[]) {
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
    PageBreak,
  } = await import("docx");

  const BLUE = "2563EB";
  const multi = sheets.length > 1;
  const sectionHeading = multi ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1;

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

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      text: "Rapport d'analyse de données",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `Fichier : ${fileName}${multi ? `  •  ${sheets.length} feuilles` : ""}  •  Généré le ${new Date().toLocaleString("fr-FR")}`,
          italics: true,
          color: "666666",
          size: 18,
        }),
      ],
    }),
  ];

  if (multi) {
    children.push(
      new Paragraph({ text: "Sommaire", heading: HeadingLevel.HEADING_1 }),
      new Table({
        width: fullWidth,
        rows: [
          headerRow(["Feuille", "Lignes", "Colonnes", "Doublons retirés", "Valeurs manquantes"]),
          ...sheets.map((s) =>
            dataRow([
              s.name,
              String(s.analysis.profile.rowCount),
              String(s.analysis.profile.columnCount),
              String(s.analysis.profile.duplicateRows),
              String(s.analysis.profile.totalMissing),
            ]),
          ),
        ],
      }),
      new Paragraph({ text: "" }),
    );
  }

  for (const s of sheets) {
    if (multi) {
      children.push(
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ text: `Feuille : ${s.name}`, heading: HeadingLevel.HEADING_1 }),
      );
    }

    // Tableau de synthèse
    const synthTable = new Table({
      width: fullWidth,
      rows: [
        headerRow(["Indicateur", "Valeur"]),
        dataRow(["Lignes", String(s.analysis.profile.rowCount)]),
        dataRow(["Colonnes", String(s.analysis.profile.columnCount)]),
        dataRow(["Lignes en double", String(s.analysis.profile.duplicateRows)]),
        dataRow(["Valeurs manquantes", String(s.analysis.profile.totalMissing)]),
      ],
    });

    // Tableau de profil
    const profileTable = new Table({
      width: fullWidth,
      rows: [
        headerRow(["Colonne", "Type", "Rempli", "Manq.", "% Manq.", "Uniques", "Moy.", "Méd.", "Outliers"]),
        ...s.analysis.profile.columns.map((c) =>
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

    children.push(
      new Paragraph({ text: "Synthèse", heading: sectionHeading }),
      synthTable,
      new Paragraph({ text: "" }),
      new Paragraph({ text: "Observations et appréciations", heading: sectionHeading }),
      ...s.analysis.observations.map(
        (o) => new Paragraph({ text: o, bullet: { level: 0 } }),
      ),
      new Paragraph({ text: "" }),
      new Paragraph({ text: "Profil des colonnes", heading: sectionHeading }),
      profileTable,
    );

    if (s.analysis.correlations.length > 0) {
      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({ text: "Corrélations principales", heading: sectionHeading }),
        new Table({
          width: fullWidth,
          rows: [
            headerRow(["Variable A", "Variable B", "r (Pearson)"]),
            ...s.analysis.correlations
              .slice(0, 15)
              .map((c) => dataRow([c.a, c.b, String(c.r)])),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return { doc, Packer };
}

// Renvoie les octets du .docx (pour tests / usage programmatique).
export async function buildDOCX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<Buffer> {
  const { doc, Packer } = await buildDocument(fileName, sheets);
  return Packer.toBuffer(doc);
}

// Export Word : construit puis déclenche le téléchargement dans le navigateur.
export async function exportDOCX(
  fileName: string,
  sheets: ExportSheet[],
): Promise<void> {
  const { doc, Packer } = await buildDocument(fileName, sheets);
  const saveAs = await loadSaveAs();
  const blob = await Packer.toBlob(doc);
  saveAs(blob, baseName(fileName) + "_rapport.docx");
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "donnees";
}
