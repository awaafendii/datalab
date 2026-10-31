import { describe, it, expect } from "vitest";
import type { Dataset, DatasetProfile } from "@/lib/types";
import { autoKpis, computeKpi } from "@/lib/kpi/kpi";

function ds(columns: string[], rows: Record<string, string | number | null>[]): Dataset {
  return { columns, rows, fileName: "t.xlsx" };
}

const DATA = ds(
  ["Montant", "Catégorie"],
  [
    { Montant: 100, Catégorie: "A" },
    { Montant: 200, Catégorie: "A" },
    { Montant: null, Catégorie: "B" },
    { Montant: 300, Catégorie: "" },
  ],
);

const def = (column: string | null, agg: string, extra: object = {}) =>
  ({ id: "x", label: "x", column, agg, ...extra }) as Parameters<typeof computeKpi>[1];

describe("computeKpi", () => {
  it("compte les lignes", () => {
    expect(computeKpi(DATA, def(null, "count")).value).toBe(4);
  });
  it("somme une colonne numérique (ignore les vides)", () => {
    expect(computeKpi(DATA, def("Montant", "sum")).value).toBe(600);
  });
  it("calcule la moyenne sur les valeurs renseignées", () => {
    expect(computeKpi(DATA, def("Montant", "mean")).value).toBeCloseTo(200, 10);
  });
  it("compte les valeurs renseignées et le % manquant", () => {
    expect(computeKpi(DATA, def("Montant", "nonEmpty")).value).toBe(3);
    expect(computeKpi(DATA, def("Montant", "missingPct")).value).toBeCloseTo(25, 10);
  });
  it("compte les modalités distinctes (hors vide)", () => {
    expect(computeKpi(DATA, def("Catégorie", "distinct")).value).toBe(2);
  });
  it("formate avec préfixe/suffixe", () => {
    const k = computeKpi(DATA, def("Montant", "sum", { suffix: " GNF" }));
    expect(k.display).toContain("GNF");
    expect(k.display).toContain("600");
  });
  it("renvoie — quand aucune valeur numérique", () => {
    const empty = ds(["X"], [{ X: "a" }, { X: "b" }]);
    const k = computeKpi(empty, def("X", "sum"));
    expect(k.value).toBeNull();
    expect(k.display).toBe("—");
  });
});

describe("autoKpis", () => {
  it("propose le comptage, les sommes/moyennes numériques et les modalités", () => {
    const profile = {
      rowCount: 4,
      columnCount: 2,
      duplicateRows: 0,
      totalMissing: 1,
      columns: [
        { name: "Montant", type: "number", count: 3, missing: 1, missingPct: 25, unique: 3 },
        { name: "Catégorie", type: "string", count: 3, missing: 1, missingPct: 25, unique: 2 },
      ],
    } as DatasetProfile;
    const defs = autoKpis(profile);
    const aggs = defs.map((d) => `${d.agg}:${d.column ?? "*"}`);
    expect(aggs).toContain("count:*");
    expect(aggs).toContain("sum:Montant");
    expect(aggs).toContain("mean:Montant");
    expect(aggs).toContain("distinct:Catégorie");
  });
});
