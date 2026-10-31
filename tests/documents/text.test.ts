import { describe, it, expect } from "vitest";
import {
  norm,
  editDistance,
  romanToInt,
  monthsIn,
  yearsIn,
  hasDate,
  upperRatio,
  endsWithTerminal,
  fmt,
  plural,
  keywords,
} from "@/lib/documents/text";

// Outils texte partagés par l'extraction et les contrôles (rapprochement de
// libellés, coquilles, numérotation romaine, dates, mise en forme des nombres).

describe("norm", () => {
  it("retire accents, normalise apostrophes et espaces", () => {
    expect(norm("  Côte  d’Ivoire ")).toBe("cote d'ivoire");
    expect(norm("RÉPUBLIQUE")).toBe("republique");
  });
});

describe("editDistance (Damerau-Levenshtein bornée)", () => {
  it("vaut 0 pour deux chaînes identiques", () => {
    expect(editDistance("rapport", "rapport")).toBe(0);
  });
  it("compte une transposition comme une seule opération", () => {
    expect(editDistance("ab", "ba")).toBe(1);
  });
  it("compte une substitution simple", () => {
    expect(editDistance("chat", "chad")).toBe(1);
  });
  it("renvoie max+1 au-delà du seuil sans finir le calcul", () => {
    expect(editDistance("abc", "xyz")).toBe(3); // max par défaut = 2
  });
});

describe("romanToInt", () => {
  it("convertit les numérotations romaines usuelles", () => {
    expect(romanToInt("IV")).toBe(4);
    expect(romanToInt("XII")).toBe(12);
    expect(romanToInt("XL")).toBe(40);
  });
  it("renvoie null hors alphabet romain", () => {
    expect(romanToInt("")).toBeNull();
    expect(romanToInt("ABC")).toBeNull();
  });
});

describe("monthsIn / yearsIn / hasDate", () => {
  it("extrait les mois cités en toutes lettres", () => {
    expect(monthsIn("du 19 avril au 03 mai 2025")).toEqual([4, 5]);
  });
  it("extrait les années distinctes", () => {
    expect(yearsIn("activités 2024 et 2025, bilan 2025").sort()).toEqual([2024, 2025]);
  });
  it("détecte une mention de date", () => {
    expect(hasDate("12/03/2025")).toBe(true);
    expect(hasDate("en avril 2025")).toBe(true);
    expect(hasDate("sans aucune date")).toBe(false);
  });
});

describe("upperRatio", () => {
  it("mesure la proportion de majuscules", () => {
    expect(upperRatio("ABC")).toBe(1);
    expect(upperRatio("AbC")).toBeCloseTo(2 / 3, 10);
    expect(upperRatio("123")).toBe(0);
  });
});

describe("endsWithTerminal", () => {
  it("reconnaît une ponctuation finale, tiret parasite compris", () => {
    expect(endsWithTerminal("Fin de phrase.")).toBe(true);
    expect(endsWithTerminal("technologie.-")).toBe(true);
    expect(endsWithTerminal("phrase inachevée")).toBe(false);
  });
});

describe("fmt", () => {
  it("formate à la française sans espaces fines insécables", () => {
    const s = fmt(1_234_567.5, 2);
    expect(/[  ]/.test(s)).toBe(false); // pas d'espace fine/insécable
    expect(s).toContain(",5");
    expect(s).toContain("234");
  });
});

describe("plural", () => {
  it("accorde le mot selon le nombre", () => {
    expect(plural(1, "ligne")).toBe("1 ligne");
    expect(plural(3, "ligne")).toBe("3 lignes");
    expect(plural(2, "cheval", "chevaux")).toBe("2 chevaux");
  });
});

describe("keywords", () => {
  it("garde les mots significatifs, écarte les mots vides", () => {
    const k = keywords("Le rapport d'activités 2024");
    expect(k).toContain("rapport");
    expect(k).not.toContain("le");
  });
});
