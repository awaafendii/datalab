import { describe, it, expect } from "vitest";
import { anomaly, listSome } from "@/lib/documents/rules/util";

// Utilitaires communs aux familles de contrôles : identifiant stable d'une
// anomalie (sert à mémoriser son statut « corrigée / ignorée » d'une analyse
// à l'autre) et résumé des listes trop longues.

describe("anomaly", () => {
  it("compose un id stable « rule:key » et conserve les autres champs", () => {
    const a = anomaly({
      rule: "budget-plafond",
      key: "prog-22001",
      category: "budget",
      severity: "bloquante",
      title: "Dépassement de plafond",
      detail: "Le programme dépasse son enveloppe.",
      suggestion: "Ramener la dotation sous le plafond voté.",
      location: {},
    });
    expect(a.id).toBe("budget-plafond:prog-22001");
    expect(a.severity).toBe("bloquante");
    expect(a.title).toBe("Dépassement de plafond");
    expect("key" in a).toBe(false); // la clé n'est pas recopiée dans l'anomalie
  });
});

describe("listSome", () => {
  it("joint une liste courte telle quelle", () => {
    expect(listSome(["a", "b", "c"])).toBe("a ; b ; c");
  });
  it("résume au-delà du maximum avec le reste compté", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(listSome(items, 6)).toBe("a ; b ; c ; d ; e ; f ; … (+2)");
  });
  it("respecte un séparateur personnalisé", () => {
    expect(listSome(["x", "y"], 6, ", ")).toBe("x, y");
  });
});
