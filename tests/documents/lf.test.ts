import { describe, it, expect } from "vitest";
import {
  LF,
  sectionByCode,
  imputationLabel,
  titreOf,
  titreLabelMatches,
  programmeKey,
  significantWords,
  labelSimilarity,
  sectionSigle,
} from "@/lib/documents/lf";

// Rattachement d'un document à la loi de finances : numéro de programme,
// nature économique (titre), nomenclature, rapprochement d'intitulés.

describe("programmeKey", () => {
  it("ordonne le programme support en premier", () => {
    expect(programmeKey("21001")).toBe("1"); // pilotage et soutien
    expect(programmeKey("22001")).toBe("2"); // 1er programme opérationnel
    expect(programmeKey("22002")).toBe("3");
  });
  it("retombe sur l'entier pour un code purement numérique", () => {
    expect(programmeKey("3")).toBe("3");
  });
});

describe("titreOf", () => {
  it("reconnaît la nature économique depuis divers libellés", () => {
    expect(titreOf("2 Dépenses de personnel")).toBe("2");
    expect(titreOf("Titre 3")).toBe("3");
    expect(titreOf("Dépenses de personnel")).toBe("2");
    expect(titreOf("Dépenses de biens et services")).toBe("3");
  });
  it("renvoie null hors nomenclature", () => {
    expect(titreOf("Observations diverses")).toBeNull();
  });
});

describe("titreLabelMatches", () => {
  it("valide un libellé cohérent avec son numéro de titre", () => {
    expect(titreLabelMatches("2", "Dépenses de personnel")).toBe(true);
  });
  it("détecte le libellé incompatible avec le numéro (gotcha LF)", () => {
    // « 4 » = transferts ; « Dépenses d'investissement » = titre 5.
    expect(titreLabelMatches("4", "4 Dépenses d'investissement")).toBe(false);
  });
});

describe("imputationLabel", () => {
  it("renvoie null sur un code inexistant ou de longueur invalide", () => {
    expect(imputationLabel("999")).toBeNull();
    expect(imputationLabel("1-2-3-4")).toBeNull(); // 4 niveaux : non valide
  });
});

describe("significantWords / labelSimilarity", () => {
  it("retire les mots-outils", () => {
    expect(significantWords("Dépenses de personnel")).not.toContain("de");
  });
  it("vaut 1 pour deux intitulés équivalents (au pluriel près)", () => {
    expect(labelSimilarity("Dépenses de personnel", "depenses personnel")).toBe(1);
  });
  it("vaut 0 sans mot commun", () => {
    expect(labelSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("sectionSigle", () => {
  it("compose le sigle à partir des mots pleins", () => {
    expect(
      sectionSigle("Ministère de l'Enseignement Supérieur et de la Recherche Scientifique"),
    ).toBe("MESRS");
  });
});

describe("intégrité du référentiel LF (généré depuis le PDF de la loi)", () => {
  it("expose une année et des sections", () => {
    expect(typeof LF.annee).toBe("number");
    expect(LF.sections.length).toBeGreaterThan(0);
  });
  it("sectionByCode retrouve une section existante et rien pour un code inconnu", () => {
    const first = LF.sections[0];
    expect(sectionByCode(first.code)).toBe(first);
    expect(sectionByCode("ZZ")).toBeUndefined();
  });
  it("chaque code de section est unique", () => {
    const codes = LF.sections.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
