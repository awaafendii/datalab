import { describe, it, expect } from "vitest";
import type { Dataset } from "@/lib/types";
import { detectColumns } from "@/lib/execution/columns";
import { analyzeExecution, isTotalRow, reconcileWithLf } from "@/lib/execution/analyze";
import { LF } from "@/lib/documents/lf";

function ds(columns: string[], rows: Record<string, string | number | null>[]): Dataset {
  return { columns, rows, fileName: "execution.xlsx" };
}

describe("detectColumns", () => {
  it("reconnaît dotation, engagement et paiement (crédits de paiement ≠ dotation)", () => {
    const dataset = ds(
      ["Programme", "Crédits ouverts", "Engagements", "Crédits de paiement"],
      [
        { Programme: "Pilotage", "Crédits ouverts": 1000, Engagements: 800, "Crédits de paiement": 700 },
        { Programme: "Formation", "Crédits ouverts": 2000, Engagements: 1500, "Crédits de paiement": 1200 },
      ],
    );
    const m = detectColumns(dataset);
    expect(m.dotation).toBe("Crédits ouverts");
    expect(m.engagement).toBe("Engagements");
    expect(m.paiement).toBe("Crédits de paiement");
    expect(m.label).toBe("Programme");
  });
});

describe("isTotalRow", () => {
  it("repère les lignes de total/ensemble", () => {
    expect(isTotalRow("Total général")).toBe(true);
    expect(isTotalRow("TOTAL")).toBe(true);
    expect(isTotalRow("Ensemble des programmes")).toBe(true);
    expect(isTotalRow("Programme pilotage")).toBe(false);
  });
});

describe("analyzeExecution — statuts de ligne", () => {
  const mapping = {
    label: "Libellé",
    code: null,
    dotation: "Dotation",
    engagement: "Engagement",
    paiement: "Paiement",
  };

  function analyzeOne(dotation: number, engagement: number, paiement: number) {
    const dataset = ds(
      ["Libellé", "Dotation", "Engagement", "Paiement"],
      [{ Libellé: "Ligne A", Dotation: dotation, Engagement: engagement, Paiement: paiement }],
    );
    return analyzeExecution(dataset, mapping).lines[0];
  }

  it("signale un dépassement de dotation (bloquant)", () => {
    const l = analyzeOne(100, 120, 0);
    expect(l.statut).toBe("depassement");
    expect(l.alerts.some((a) => a.severity === "bloquante" && a.rule === "depassement-engagement")).toBe(true);
  });

  it("signale des crédits dotés mais non exécutés", () => {
    const l = analyzeOne(100, 0, 0);
    expect(l.statut).toBe("non-execute");
  });

  it("signale une sous-exécution", () => {
    const l = analyzeOne(100, 60, 30);
    expect(l.statut).toBe("sous-execution");
    expect(l.tauxExecution).toBeCloseTo(0.3, 10);
  });

  it("considère normale une exécution satisfaisante", () => {
    const l = analyzeOne(100, 80, 80);
    expect(l.statut).toBe("normal");
    expect(l.alerts).toHaveLength(0);
  });

  it("signale des paiements supérieurs aux engagements", () => {
    const l = analyzeOne(100, 50, 70);
    expect(l.alerts.some((a) => a.rule === "paiement-sup-engagement")).toBe(true);
  });

  it("calcule le disponible (dotation - engagement)", () => {
    const l = analyzeOne(100, 80, 70);
    expect(l.disponible).toBe(20);
  });
});

describe("analyzeExecution — totaux", () => {
  it("exclut les lignes de total des agrégats", () => {
    const dataset = ds(
      ["Libellé", "Dotation", "Engagement", "Paiement"],
      [
        { Libellé: "Programme 1", Dotation: 100, Engagement: 80, Paiement: 70 },
        { Libellé: "Programme 2", Dotation: 200, Engagement: 150, Paiement: 120 },
        { Libellé: "Total", Dotation: 300, Engagement: 230, Paiement: 190 },
      ],
    );
    const r = analyzeExecution(dataset, {
      label: "Libellé",
      code: null,
      dotation: "Dotation",
      engagement: "Engagement",
      paiement: "Paiement",
    });
    expect(r.totals.dotation).toBe(300); // 100 + 200, pas la ligne « Total »
    expect(r.totals.lignes).toBe(2);
    expect(r.totals.tauxExecution).toBeCloseTo(190 / 300, 10);
  });

  it("lit les montants « à la française » saisis en texte", () => {
    const dataset = ds(
      ["Libellé", "Dotation", "Paiement"],
      [{ Libellé: "A", Dotation: "1 200 000", Paiement: "600 000 GNF" }],
    );
    const r = analyzeExecution(dataset, {
      label: "Libellé",
      code: null,
      dotation: "Dotation",
      engagement: null,
      paiement: "Paiement",
    });
    expect(r.totals.dotation).toBe(1_200_000);
    expect(r.totals.paiement).toBe(600_000);
  });
});

describe("analyzeExecution — fichier sans colonne d'exécution", () => {
  it("n'invente pas d'alertes « non exécuté » mais agrège la dotation", () => {
    const dataset = ds(
      ["Libellé", "Dotation"],
      [
        { Libellé: "Programme 1", Dotation: 100 },
        { Libellé: "Programme 2", Dotation: 200 },
      ],
    );
    const r = analyzeExecution(dataset, {
      label: "Libellé",
      code: null,
      dotation: "Dotation",
      engagement: null,
      paiement: null,
    });
    expect(r.alerts.some((a) => a.rule === "non-execute")).toBe(false);
    expect(r.totals.dotation).toBe(300);
  });
});

describe("reconcileWithLf", () => {
  const section = LF.sections.find((s) => s.total.lf > 0) ?? LF.sections[0];

  it("conforme quand le total égale les crédits votés", () => {
    const rec = reconcileWithLf(section.total.lf, section.code);
    expect(rec).not.toBeNull();
    expect(rec!.conforme).toBe(true);
    expect(rec!.ecart).toBe(0);
  });

  it("non conforme au-delà de la tolérance de 1 %", () => {
    const rec = reconcileWithLf(section.total.lf * 1.05, section.code);
    expect(rec!.conforme).toBe(false);
    expect(rec!.ecartPct).toBeCloseTo(0.05, 6);
  });

  it("renvoie null pour une section inconnue", () => {
    expect(reconcileWithLf(1000, "ZZ")).toBeNull();
  });
});
