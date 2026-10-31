import { describe as d, it, expect } from "vitest";
import type { Dataset } from "@/lib/types";
import {
  chiSquareIndependence,
  chiSquarePValue,
  correlationMatrix,
  describe as describeCol,
  fDistPValue,
  isStatError,
  oneWayAnova,
  studentTwoTailedP,
  welchTTest,
} from "@/lib/statlab/statlab";

function ds(columns: string[], rows: Record<string, string | number | null>[]): Dataset {
  return { columns, rows, fileName: "t.xlsx" };
}

d("fonctions spéciales (p-values)", () => {
  it("t de Student bilatéral : t=2, df=10 ≈ 0.0734", () => {
    expect(studentTwoTailedP(2, 10)).toBeCloseTo(0.0734, 3);
  });
  it("t=0 → p=1 ; grand t → p≈0", () => {
    expect(studentTwoTailedP(0, 10)).toBeCloseTo(1, 6);
    expect(studentTwoTailedP(20, 10)).toBeLessThan(1e-6);
  });
  it("khi² : x=3.841, df=1 ≈ 0.05", () => {
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
  });
  it("Fisher : F=1 sur (5,5) → p=0.5 (symétrie)", () => {
    expect(fDistPValue(1, 5, 5)).toBeCloseTo(0.5, 6);
  });
});

d("describe", () => {
  const data = ds(["X"], [{ X: 1 }, { X: 2 }, { X: 3 }, { X: 4 }, { X: 5 }]);
  const s = describeCol(data, "X");
  it("calcule les statistiques usuelles", () => {
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(3, 10);
    expect(s.median).toBeCloseTo(3, 10);
    expect(s.std).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.q1).toBeCloseTo(2, 10);
    expect(s.q3).toBeCloseTo(4, 10);
  });
});

d("correlationMatrix", () => {
  it("corrélation parfaite = 1 sur la diagonale et entre colonnes identiques", () => {
    const data = ds(
      ["A", "B"],
      [
        { A: 1, B: 2 },
        { A: 2, B: 4 },
        { A: 3, B: 6 },
      ],
    );
    const m = correlationMatrix(data, ["A", "B"], "pearson");
    expect(m.matrix[0][0]).toBeCloseTo(1, 10);
    expect(m.matrix[0][1]).toBeCloseTo(1, 10); // B = 2A
  });
});

d("welchTTest", () => {
  it("détecte une différence de moyenne nette", () => {
    const data = ds(
      ["Groupe", "Valeur"],
      [
        { Groupe: "A", Valeur: 1 },
        { Groupe: "A", Valeur: 2 },
        { Groupe: "A", Valeur: 3 },
        { Groupe: "B", Valeur: 10 },
        { Groupe: "B", Valeur: 11 },
        { Groupe: "B", Valeur: 12 },
      ],
    );
    const r = welchTTest(data, "Valeur", "Groupe");
    expect(isStatError(r)).toBe(false);
    if (!isStatError(r)) {
      expect(r.n1).toBe(3);
      expect(r.n2).toBe(3);
      expect(r.p).toBeLessThan(0.01);
    }
  });
});

d("oneWayAnova", () => {
  it("rejette l'égalité des moyennes quand un groupe diffère", () => {
    const data = ds(
      ["G", "V"],
      [
        { G: "A", V: 1 }, { G: "A", V: 2 }, { G: "A", V: 3 },
        { G: "B", V: 1 }, { G: "B", V: 2 }, { G: "B", V: 3 },
        { G: "C", V: 10 }, { G: "C", V: 11 }, { G: "C", V: 12 },
      ],
    );
    const r = oneWayAnova(data, "V", "G");
    expect(isStatError(r)).toBe(false);
    if (!isStatError(r)) {
      expect(r.df1).toBe(2);
      expect(r.df2).toBe(6);
      expect(r.p).toBeLessThan(0.05);
    }
  });
});

d("chiSquareIndependence", () => {
  it("détecte une association parfaite (p faible)", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ A: "x", B: "p" })),
      ...Array.from({ length: 5 }, () => ({ A: "y", B: "q" })),
    ];
    const r = chiSquareIndependence(ds(["A", "B"], rows), "A", "B");
    expect(isStatError(r)).toBe(false);
    if (!isStatError(r)) {
      expect(r.df).toBe(1);
      expect(r.p).toBeLessThan(0.05);
    }
  });
});
