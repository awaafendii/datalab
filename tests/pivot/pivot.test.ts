import { describe, it, expect } from "vitest";
import type { Dataset } from "@/lib/types";
import { autoPivotConfig, computePivot } from "@/lib/pivot/engine";
import type { DatasetProfile } from "@/lib/types";
import type { PivotConfig, PivotRow } from "@/lib/pivot/types";

function ds(columns: string[], rows: Record<string, string | number | null>[]): Dataset {
  return { columns, rows, fileName: "t.xlsx" };
}

const DATA = ds(
  ["Région", "Programme", "Montant"],
  [
    { Région: "Nord", Programme: "A", Montant: 100 },
    { Région: "Nord", Programme: "B", Montant: 50 },
    { Région: "Nord", Programme: "C", Montant: 30 },
    { Région: "Sud", Programme: "A", Montant: 200 },
    { Région: "Sud", Programme: "A", Montant: 40 },
  ],
);

const base: PivotConfig = {
  rows: [],
  columns: [],
  values: [],
  filters: [],
  rowSubtotals: false,
  grandTotal: false,
};

const findRow = (rows: PivotRow[], label0: string, kind?: string) =>
  rows.find((r) => r.labels[0] === label0 && (kind ? r.kind === kind : true));

describe("computePivot — croisement simple (région × programme, somme)", () => {
  const res = computePivot(DATA, {
    ...base,
    rows: [{ column: "Région", kind: "category" }],
    columns: [{ column: "Programme", kind: "category" }],
    values: [{ column: "Montant", agg: "sum" }],
    grandTotal: true,
  });

  it("ordonne les colonnes-feuilles alphabétiquement", () => {
    expect(res.columnLeaves.map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("agrège correctement chaque cellule et le total de ligne", () => {
    const nord = findRow(res.rows, "Nord")!;
    expect(nord.cells[0][0].value).toBe(100); // A
    expect(nord.cells[1][0].value).toBe(50); // B
    expect(nord.cells[2][0].value).toBe(30); // C
    expect(nord.totals[0].value).toBe(180);

    const sud = findRow(res.rows, "Sud")!;
    expect(sud.cells[0][0].value).toBe(240); // A = 200 + 40
    expect(sud.cells[1][0].value).toBeNull(); // pas de B au Sud
    expect(sud.totals[0].value).toBe(240);
  });

  it("calcule la ligne de total général par colonne", () => {
    expect(res.grandTotalRow).not.toBeNull();
    expect(res.grandTotalRow!.cells[0][0].value).toBe(340); // A = 100 + 200 + 40
    expect(res.grandTotalRow!.cells[1][0].value).toBe(50); // B
    expect(res.grandTotalRow!.totals[0].value).toBe(420); // tout
  });
});

describe("computePivot — sous-totaux de moyenne (fusion, pas moyenne de moyennes)", () => {
  const res = computePivot(DATA, {
    ...base,
    rows: [
      { column: "Région", kind: "category" },
      { column: "Programme", kind: "category" },
    ],
    values: [{ column: "Montant", agg: "mean" }],
    rowSubtotals: true,
    grandTotal: true,
  });

  it("le sous-total Nord est la vraie moyenne des lignes du groupe", () => {
    const sub = res.rows.find((r) => r.kind === "subtotal" && r.labels[0] === "Nord")!;
    expect(sub.cells[0][0].value).toBeCloseTo((100 + 50 + 30) / 3, 10); // 60
  });

  it("le total général est la vraie moyenne de toutes les lignes", () => {
    expect(res.grandTotalRow!.cells[0][0].value).toBeCloseTo((100 + 50 + 30 + 200 + 40) / 5, 10); // 84, pas 90
  });
});

describe("computePivot — comptage, distinct et filtres", () => {
  it("compte les lignes quand aucune mesure n'est définie", () => {
    const res = computePivot(DATA, {
      ...base,
      rows: [{ column: "Région", kind: "category" }],
      grandTotal: true,
    });
    expect(findRow(res.rows, "Nord")!.cells[0][0].value).toBe(3);
    expect(findRow(res.rows, "Sud")!.cells[0][0].value).toBe(2);
    expect(res.valueLabels[0]).toBe("Nombre de lignes");
  });

  it("compte les valeurs distinctes", () => {
    const res = computePivot(DATA, {
      ...base,
      rows: [{ column: "Région", kind: "category" }],
      values: [{ column: "Programme", agg: "distinct" }],
    });
    expect(findRow(res.rows, "Nord")!.cells[0][0].value).toBe(3); // A, B, C
    expect(findRow(res.rows, "Sud")!.cells[0][0].value).toBe(1); // A
  });

  it("applique un filtre d'inclusion", () => {
    const res = computePivot(DATA, {
      ...base,
      rows: [{ column: "Région", kind: "category" }],
      values: [{ column: "Montant", agg: "sum" }],
      filters: [{ column: "Région", kind: "category", include: ["Nord"] }],
    });
    expect(res.rows).toHaveLength(1);
    expect(findRow(res.rows, "Nord")!.cells[0][0].value).toBe(180);
  });
});

describe("autoPivotConfig", () => {
  it("met la 1re catégorielle en lignes et somme la 1re numérique", () => {
    const profile = {
      rowCount: 0,
      columnCount: 2,
      duplicateRows: 0,
      totalMissing: 0,
      columns: [
        { name: "Programme", type: "string", count: 0, missing: 0, missingPct: 0, unique: 0 },
        { name: "Montant", type: "number", count: 0, missing: 0, missingPct: 0, unique: 0 },
      ],
    } as DatasetProfile;
    const c = autoPivotConfig(profile);
    expect(c.rows[0]?.column).toBe("Programme");
    expect(c.values[0]).toMatchObject({ column: "Montant", agg: "sum" });
    expect(c.grandTotal).toBe(true);
  });

  it("retombe sur le comptage sans colonne numérique", () => {
    const profile = {
      rowCount: 0,
      columnCount: 1,
      duplicateRows: 0,
      totalMissing: 0,
      columns: [{ name: "Catégorie", type: "string", count: 0, missing: 0, missingPct: 0, unique: 0 }],
    } as DatasetProfile;
    const c = autoPivotConfig(profile);
    expect(c.values[0]).toMatchObject({ column: null, agg: "count" });
  });
});

describe("computePivot — en-têtes de colonnes à deux niveaux", () => {
  const res = computePivot(DATA, {
    ...base,
    rows: [{ column: "Région", kind: "category" }],
    columns: [
      { column: "Programme", kind: "category" },
      { column: "Région", kind: "category" },
    ],
    values: [{ column: "Montant", agg: "sum" }],
  });

  it("produit un en-tête groupé par niveau de colonne", () => {
    // Niveau 0 = Programme (A, B, C), niveau 1 = Région sous chaque programme.
    expect(res.headerRows.length).toBeGreaterThanOrEqual(2);
    const niveau0 = res.headerRows[0].map((h) => h.label);
    expect(niveau0).toContain("A");
    // La somme des spans du 1er niveau couvre toutes les colonnes-feuilles.
    const totalSpan = res.headerRows[0].reduce((s, h) => s + h.span, 0);
    expect(totalSpan).toBe(res.columnLeaves.length);
  });
});
