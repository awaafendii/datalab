import type { Anomaly } from "../types";
import type { DocContext } from "../structure";
import { excerpt, norm, plural } from "../text";
import { anomaly, blockLoc, listSome } from "./util";

// Cahiers des charges et termes de référence : une exigence doit être
// vérifiable à la réception. Les qualificatifs subjectifs (« rapide »,
// « convivial », « si possible ») ouvrent la porte aux litiges.

const VAGUE: [RegExp, string][] = [
  [/\brapides?\b|\brapidement\b/, "rapide"],
  [/\bmodernes?\b/, "moderne"],
  [/\bconvivia(l|le|les|ux)\b/, "convivial"],
  [/\bperformant(e|s|es)?\b/, "performant"],
  [/\bsi possible\b/, "si possible"],
  [/\betc\b/, "etc."],
  [/\bsuffisant(e|s|es)?\b|\ben nombre suffisant\b/, "suffisant"],
  [/\bde (bonne |haute )?qualite\b/, "de qualité"],
  [/\bdans les meilleurs delais\b|\bdes que possible\b/, "dans les meilleurs délais"],
  [/\ble cas echeant\b|\bau besoin\b|\beventuellement\b/, "le cas échéant / éventuellement"],
  [/\bfaciles?\b|\bfacilement\b|\bsimples? d.utilisation\b/, "facile"],
  [/\brobustes?\b/, "robuste"],
  [/\boptima(l|le|les|ux)\b/, "optimal"],
  [/\befficaces?\b/, "efficace"],
  [/\brecent(e|s|es)?\b|\bdernier cri\b|\bderniere generation\b|\bhaut de gamme\b/, "récent / dernière génération"],
  [/\bgrande taille\b|\bgrande capacite\b/, "grande taille"],
];

export function requirementRules(ctx: DocContext): Anomaly[] {
  if (ctx.kind !== "cahier-charges" && ctx.kind !== "tdr") return [];
  const found = new Map<string, { i: number; index: number; text: string }>();
  let first = -1;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    const t = norm(b.text);
    for (const [re, label] of VAGUE) {
      const m = re.exec(t);
      if (m && !found.has(label)) {
        found.set(label, { i, index: m.index, text: b.text });
        if (first < 0) first = i;
      }
    }
  });
  if (!found.size) return [];
  const examples = [...found.values()].slice(0, 3).map((f) => `« ${excerpt(f.text, f.index, 12, 45)} »`);
  return [
    anomaly({
      key: "exigences-vagues",
      rule: "exigences-non-mesurables",
      category: "redaction",
      severity: "majeure",
      title: `Exigences non mesurables (${plural(found.size, "terme vague", "termes vagues")})`,
      detail: `Termes subjectifs impossibles à vérifier à la réception : ${listSome([...found.keys()].map((k) => `« ${k} »`), 10, ", ")}. Exemples : ${examples.join(" ; ")}.`,
      suggestion:
        "Remplacer chaque qualificatif par un critère chiffré et vérifiable (ex. « rapide » → « processeur ≥ 2,5 GHz, 16 Go de RAM » ; « si possible » → exigence obligatoire ou optionnelle explicitement notée ; « dans les meilleurs délais » → « sous 30 jours calendaires à compter de la notification »).",
      location: blockLoc(ctx, first),
    }),
  ];
}
