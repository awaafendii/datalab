import { describe, it, expect } from "vitest";
import {
  parseNumber,
  currencyOf,
  isYear,
  roundingTolerance,
  percentMentions,
} from "@/lib/documents/numbers";

// Le parsing des nombres « à la française » est le socle de tous les contrôles
// de calcul budgétaire (totaux, pourcentages, écarts LF/CDMT). Une erreur ici
// se propage silencieusement à l'avis de conformité : d'où ces tests.

describe("parseNumber", () => {
  it("lit un grand nombre avec espaces de milliers", () => {
    expect(parseNumber("1 200 000")).toMatchObject({ value: 1_200_000, percent: false, currency: null });
  });

  it("lit un pourcentage avec décimale", () => {
    expect(parseNumber("63,14 %")).toMatchObject({ value: 63.14, percent: true, decimals: 2 });
  });

  it("reconnaît les devises (€, GNF, FCFA)", () => {
    expect(parseNumber("25 000 €")).toMatchObject({ value: 25_000, currency: "EUR" });
    expect(parseNumber("100000€")).toMatchObject({ value: 100_000, currency: "EUR" });
    expect(parseNumber("1 500 000 GNF")).toMatchObject({ value: 1_500_000, currency: "GNF" });
    expect(parseNumber("2 000 FCFA")).toMatchObject({ value: 2_000, currency: "XOF" });
  });

  it("ignore une précision entre parenthèses en fin de cellule", () => {
    expect(parseNumber("14 (12 + 2)")).toMatchObject({ value: 14 });
  });

  it("lit le format anglo-saxon à virgules de milliers", () => {
    expect(parseNumber("1,234,567.89")).toMatchObject({ value: 1_234_567.89, decimals: 2 });
  });

  it("gère les nombres négatifs (tirets typographiques compris)", () => {
    expect(parseNumber("-1 500")).toMatchObject({ value: -1_500 });
    expect(parseNumber("–2 000")!.value).toBe(-2_000); // tiret demi-cadratin
  });

  it("accepte directement un nombre JS", () => {
    expect(parseNumber(1234.5)).toMatchObject({ value: 1234.5, decimals: 1, percent: false });
  });

  it("renvoie null sur une entrée non numérique ou vide", () => {
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(NaN)).toBeNull();
  });

  it("refuse une chaîne anormalement longue (garde-fou)", () => {
    expect(parseNumber("1".repeat(50))).toBeNull();
  });
});

describe("currencyOf", () => {
  it("rapproche les graphies usuelles", () => {
    expect(currencyOf("€")).toBe("EUR");
    expect(currencyOf("$")).toBe("USD");
    expect(currencyOf("USD")).toBe("USD");
    expect(currencyOf("dollars US")).toBe("USD");
    expect(currencyOf("FCFA")).toBe("XOF");
    expect(currencyOf("GNF")).toBe("GNF");
    expect(currencyOf("francs guinéens")).toBe("GNF");
    expect(currencyOf("xyz")).toBeNull();
  });
});

describe("isYear", () => {
  it("reconnaît une année seule ou précédée d'un libellé court", () => {
    expect(isYear("2025")).toBe(2025);
    expect(isYear("LFI 2025")).toBe(2025);
    expect(isYear("Projection 2026")).toBe(2026);
  });

  it("refuse ce qui n'est pas une année en fin de chaîne", () => {
    expect(isYear("2025 montant")).toBeNull();
    expect(isYear("1800")).toBeNull(); // hors plage 19xx/20xx
  });
});

describe("roundingTolerance", () => {
  it("croît quand il y a moins de décimales affichées", () => {
    expect(roundingTolerance(0)).toBeCloseTo(0.51, 10);
    expect(roundingTolerance(2)).toBeCloseTo(0.015, 10);
    expect(roundingTolerance(0)).toBeGreaterThan(roundingTolerance(2));
  });
});

describe("percentMentions", () => {
  it("repère un pourcentage explicite", () => {
    const m = percentMentions("un taux de 63,14 % a été atteint");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ value: 63.14, explicit: true });
  });

  it("capte le qualificatif « plus de »", () => {
    const m = percentMentions("plus de 90 % des cibles");
    expect(m[0]).toMatchObject({ value: 90, qualifier: "plus" });
  });

  it("ignore les nombres > 100 et les renvois de tableau", () => {
    expect(percentMentions("voir tableau 12")).toHaveLength(0);
    expect(percentMentions("le montant est 250 %").every((p) => p.value <= 100)).toBe(true);
  });
});
