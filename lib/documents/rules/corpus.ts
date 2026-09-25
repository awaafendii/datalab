import type { Anomaly } from "../types";
import { norm, plural, truncate, wordCount } from "../text";
import { sameExpansion } from "./sigles";
import { anomaly, listSome } from "./util";

// Contrôles entre plusieurs documents chargés ensemble (rapports de
// plusieurs années, de plusieurs directions, versions successives) : texte
// recopié d'un document à l'autre, sigles définis différemment.

export interface CorpusInput {
  name: string;
  paragraphs: { text: string; section: string }[];
  sigles: { sigle: string; expansion: string }[];
}

export function corpusRules(docs: CorpusInput[]): Anomaly[] {
  const out: Anomaly[] = [];
  if (docs.length < 2) return out;

  // Texte recopié : phrases identiques d'au moins 8 mots (les éléments de
  // liste d'un rapport à l'autre sont souvent repris tels quels).
  const index = docs.map((d) => {
    const m = new Map<string, string>();
    for (const p of d.paragraphs) {
      for (const s of p.text.replace(/([.;!?])\s+/g, "$1\n").split("\n")) {
        const clean = s.replace(/^[•\-–]\s*/, "").replace(/[.;!?]+$/, "").trim();
        if (wordCount(clean) >= 8) m.set(norm(clean), p.section);
      }
    }
    return m;
  });
  for (let a = 0; a < docs.length; a++) {
    for (let b = a + 1; b < docs.length; b++) {
      const shared: { text: string; section: string }[] = [];
      for (const [k, section] of index[b]) if (index[a].has(k)) shared.push({ text: k, section });
      if (shared.length < 3) continue;
      const share = shared.length / Math.max(1, Math.min(index[a].size, index[b].size));
      const sections = [...new Set(shared.map((s) => s.section.split(" › ").pop() || "début"))];
      out.push(
        anomaly({
          key: `copie:${docs[a].name}:${docs[b].name}`,
          rule: "texte-recopie",
          category: "coherence",
          severity: share >= 0.3 ? "majeure" : "mineure",
          title: `${plural(shared.length, "phrase identique", "phrases identiques")} entre deux documents`,
          detail: `« ${docs[a].name} » et « ${docs[b].name} » ont ${shared.length} phrases rigoureusement identiques (${Math.round(share * 100)} % des phrases du plus court), notamment dans : ${listSome(
            sections.map((s) => `« ${truncate(s, 40)} »`),
            5,
            ", ",
          )}.`,
          suggestion:
            "Vérifier que le contenu repris a bien été actualisé (difficultés, recommandations, résultats de l'année) ; sinon, le mettre à jour ou indiquer explicitement qu'il s'agit d'un rappel (par ex. recommandations non encore mises en œuvre).",
          excerpt: truncate(shared[0].text, 160),
          location: { section: `${docs[a].name} ↔ ${docs[b].name}` },
        }),
      );
    }
  }

  // Sigles définis différemment selon les documents.
  const bySigle = new Map<string, { doc: string; expansion: string }[]>();
  for (const d of docs) {
    for (const s of d.sigles) {
      const list = bySigle.get(s.sigle) ?? [];
      if (!list.some((x) => x.doc === d.name && sameExpansion(x.expansion, s.expansion))) list.push({ doc: d.name, expansion: s.expansion });
      bySigle.set(s.sigle, list);
    }
  }
  for (const [sigle, list] of bySigle) {
    const distinct: { doc: string; expansion: string }[] = [];
    for (const x of list) if (!distinct.some((d) => sameExpansion(d.expansion, x.expansion))) distinct.push(x);
    if (distinct.length < 2 || new Set(distinct.map((d) => d.doc)).size < 2) continue;
    out.push(
      anomaly({
        key: `sigle:${sigle}`,
        rule: "sigle-inter-documents",
        category: "sigles",
        severity: "majeure",
        title: `Sigle ${sigle} défini différemment selon les documents`,
        detail: distinct.map((d) => `« ${truncate(d.expansion, 80)} » (${d.doc})`).join(" / ") + ".",
        suggestion: `Arrêter le développé officiel de ${sigle} et l'harmoniser dans tous les documents de l'administration.`,
        location: { section: distinct.map((d) => d.doc).join(" ↔ ") },
      }),
    );
  }
  return out;
}
