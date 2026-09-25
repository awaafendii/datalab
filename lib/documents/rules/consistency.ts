import type { Anomaly } from "../types";
import type { DocContext, TableInfo } from "../structure";
import { currencyOf, percentMentions, roundingTolerance, type Currency, type PercentMention } from "../numbers";
import { excerpt, fmt, keywords, norm, plural } from "../text";
import { anomaly, blockLoc, listSome, tableLoc } from "./util";

// Cohérence entre le texte et les tableaux, et au sein du document :
// pourcentages cités qui ne correspondent pas au tableau commenté,
// effectifs de référence qui changent, chiffres du titre introuvables,
// devises ou unités mélangées.

function tableValues(t: TableInfo): number[] {
  const out: number[] = [];
  for (const row of t.nums) for (const n of row) if (n) out.push(n.value);
  return out;
}

// Sommes de deux catégories d'une même colonne : « ces deux types
// représentent plus de 84 % » (43,77 + 40,58).
function pairSums(t: TableInfo): number[] {
  const out: number[] = [];
  t.header.forEach((_, c) => {
    const vals = t.body
      .map((_, r) => r)
      .filter((r) => !t.totalRows.includes(r))
      .map((r) => t.nums[r][c]?.value)
      .filter((v): v is number => v !== undefined && v <= 100);
    if (vals.length > 25) return;
    for (let a = 0; a < vals.length; a++) for (let b = a + 1; b < vals.length; b++) if (vals[a] + vals[b] <= 100) out.push(vals[a] + vals[b]);
  });
  return out;
}

function matches(m: PercentMention, v: number): boolean {
  if (m.decimals === 0) return Math.abs(Math.round(v) - m.value) < 0.5 || Math.abs(v - m.value) <= 0.51;
  return Math.abs(v - m.value) <= roundingTolerance(m.decimals);
}

function qualifierOk(m: PercentMention, values: number[]): boolean {
  if (m.qualifier === "plus") return values.some((v) => v >= m.value && v <= m.value + 10);
  if (m.qualifier === "moins") return values.some((v) => v < m.value && v >= m.value - 10);
  return values.some((v) => Math.abs(v - m.value) <= Math.max(1.5, 0.1 * m.value));
}

// Chiffres du texte ↔ tableau commenté (paragraphes voisins d'un tableau,
// dans la même section).
function textVsTables(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const WINDOW = 6;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" || ctx.captionBlocks.has(i) || ctx.tocBlocks.has(i)) return;
    // Une part budgétaire (« 47,43 % du budget total ») se compare aux
    // montants, pas aux pourcentages d'un tableau voisin.
    const mentions = percentMentions(b.text).filter(
      (m) =>
        !/^\s*(?:%\s*)?(?:du budget|de l.enveloppe|des ressources|du total|des credits|de la dotation|du cout|des depenses|du montant)/.test(
          norm(b.text.slice(m.index + m.raw.length, m.index + m.raw.length + 30)),
        ),
    );
    if (!mentions.length) return;
    const near = ctx.tables.filter(
      (t) => !t.empty && Math.abs(t.index - i) <= WINDOW && ctx.headingOf[t.index] === ctx.headingOf[i] && t.nums.length > 0,
    );
    if (!near.length) return;
    // Le paragraphe commente le tableau dont la légende partage le plus de mots.
    const words = new Set(keywords(b.text, 5));
    const overlap = (t: TableInfo) => keywords(t.title, 5).filter((w) => words.has(w)).length;
    const scored = near.map((t) => ({ t, s: overlap(t) })).sort((a, b) => b.s - a.s || Math.abs(a.t.index - i) - Math.abs(b.t.index - i));
    const target = scored[0].s >= 2 && (scored.length === 1 || scored[0].s > scored[1].s) ? [scored[0].t] : near;
    const targetValues = target.flatMap(tableValues);
    const allValues = near.flatMap(tableValues);
    const sums = near.flatMap(pairSums);

    const mismatches: string[] = [];
    const approximations: string[] = [];
    const fromOther: PercentMention[] = [];
    const fixes: string[] = [];
    let matched = 0;
    for (const m of mentions) {
      if (targetValues.some((v) => matches(m, v))) {
        if (!m.qualifier) matched++;
        continue;
      }
      if (m.qualifier) {
        if (!qualifierOk(m, targetValues) && !qualifierOk(m, allValues) && !qualifierOk(m, sums)) {
          approximations.push(`« ${excerpt(b.text, m.index, m.raw.length, 25)} » : aucune valeur du tableau ne correspond à cette approximation`);
        }
        continue;
      }
      if (target.length === 1 && allValues.some((v) => matches(m, v))) {
        fromOther.push(m);
        continue;
      }
      if (sums.some((v) => matches(m, v))) {
        matched++;
        continue;
      }
      // Valeur voisine du tableau (écart faible en relatif), qui n'est pas
      // déjà citée exactement ailleurs dans le paragraphe : sinon le chiffre
      // du texte désigne autre chose (un sous-groupe), pas une erreur.
      const closest = targetValues
        .map((v) => ({ v, d: Math.abs(v - m.value) }))
        .filter((x) => x.d <= Math.min(3, Math.max(0.5, 0.1 * x.v)))
        .filter((x) => !mentions.some((o) => o !== m && matches(o, x.v)))
        .sort((a, b) => a.d - b.d)[0];
      if (closest) {
        mismatches.push(`le texte indique ${fmt(m.value)} %, le tableau ${fmt(closest.v)} %`);
        fixes.push(`${fmt(m.value)} → ${fmt(closest.v)}`);
      }
    }
    // Un paragraphe qui cite surtout des chiffres absents du tableau commente
    // d'autres données (ventilations par type, par filière…) : les valeurs
    // proches du tableau y sont des coïncidences, pas des erreurs.
    const explicitCount = mentions.filter((m) => !m.qualifier).length;
    const otherData = explicitCount > 3 && mismatches.length + fromOther.length > matched;
    if (otherData) {
      mismatches.length = 0;
      approximations.length = 0;
      fromOther.length = 0;
    }
    // Une approximation n'est vérifiable que si le paragraphe commente bien
    // ce tableau (au moins une valeur citée exactement).
    if (matched === 0) approximations.length = 0;
    if (fromOther.length >= 2) {
      const other = near.find((t) => t !== target[0] && fromOther.every((m) => tableValues(t).some((v) => matches(m, v))));
      out.push(
        anomaly({
          key: `${b.id}:autre`,
          rule: "texte-tableau-voisin",
          category: "coherence",
          severity: "majeure",
          title: "Chiffres repris du mauvais tableau",
          detail: `Le paragraphe commente le tableau « ${target[0].title} » mais cite ${fromOther
            .map((m) => fmt(m.value))
            .join(" ; ")}, qui sont les valeurs du tableau « ${other?.title ?? "voisin"} ». Valeurs du tableau commenté : ${listSome(
            tableValues(target[0]).filter((v) => v <= 100).map((v) => fmt(v)),
            8,
          )}.`,
          suggestion: "Reprendre les pourcentages du bon tableau dans ce paragraphe (copier-coller probable).",
          excerpt: excerpt(b.text, fromOther[0].index, 0, 110),
          location: blockLoc(ctx, i),
        }),
      );
    }
    if (mismatches.length) {
      out.push(
        anomaly({
          key: `${b.id}:ecart`,
          rule: "texte-tableau",
          category: "coherence",
          // Au-delà de trois chiffres cités, le paragraphe mêle souvent
          // plusieurs sources : à vérifier plutôt qu'erreur certaine.
          severity: explicitCount <= 3 ? "majeure" : "mineure",
          title: "Chiffre du texte différent du tableau",
          detail: `${listSome(mismatches)}. Tableau concerné : « ${target[0].title} »${target.length > 1 ? " (ou tableau voisin)" : ""}.`,
          suggestion: `Aligner le texte sur le tableau (${fixes.join(" ; ")}) ou corriger le tableau si c'est lui qui est faux.`,
          excerpt: excerpt(b.text, mentions[0].index, 0, 110),
          location: blockLoc(ctx, i),
        }),
      );
    }
    if (approximations.length) {
      out.push(
        anomaly({
          key: `${b.id}:approx`,
          rule: "texte-tableau-approximation",
          category: "coherence",
          severity: "mineure",
          title: "Approximation non vérifiable dans le tableau",
          detail: `${listSome(approximations)}. Tableau concerné : « ${target[0].title} »${target.length > 1 ? " (ou tableau voisin)" : ""}.`,
          suggestion: "Citer la valeur exacte du tableau (ou la somme exacte des catégories regroupées).",
          excerpt: excerpt(b.text, mentions[0].index, 0, 110),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

// Effectif de référence : dans une enquête, la plupart des tableaux de
// répartition portent sur la même population (par ex. 137 laboratoires).
function populationConsistency(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const totals: { t: TableInfo; n: number }[] = [];
  for (const t of ctx.tables) {
    const grand = t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop();
    if (grand === undefined) continue;
    // Colonne de pourcentages dont le total vaut 100 %, et l'effectif juste à sa gauche.
    const pctCol = t.kinds.findIndex((k, c) => k === "percent" && Math.abs((t.nums[grand][c]?.value ?? 0) - 100) <= 0.6);
    if (pctCol < 0) continue;
    let countCol = pctCol - 1;
    while (countCol >= 0 && t.kinds[countCol] !== "count") countCol--;
    if (countCol < 0) continue;
    const n = t.nums[grand][countCol];
    if (!n || !Number.isInteger(n.value)) continue;
    totals.push({ t, n: n.value });
  }
  if (totals.length < 4) return out;
  const freq = new Map<number, number>();
  for (const x of totals) freq.set(x.n, (freq.get(x.n) ?? 0) + 1);
  const [modal, count] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count < 3 || count / totals.length < 0.5) return out;
  const others = totals.filter((x) => x.n !== modal);
  if (others.length) {
    out.push(
      anomaly({
        key: "effectif",
        rule: "effectif-reference",
        category: "coherence",
        severity: "mineure",
        title: `Effectif total variable d'un tableau à l'autre`,
        detail: `${count} tableaux de répartition portent sur ${fmt(modal)} unités, mais ${plural(others.length, "tableau totalise", "tableaux totalisent")} un autre effectif : ${listSome(
          others.map((x) => `« ${x.t.title} » (${fmt(x.n)})`),
          5,
        )}.`,
        suggestion: `Vérifier si ces tableaux portent sur une autre population (réponses multiples, autre unité de compte) et le préciser en note ; sinon corriger pour retrouver ${fmt(modal)}.`,
        location: tableLoc(ctx, others[0].t),
      }),
    );
  }
  // Effectif annoncé dans le texte, à une ou deux unités près.
  const re = /(total de|sur un total de|sur les|l.ensemble des|au total,?)\s+(\d{2,6})\b/gi;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.text))) {
      const v = parseInt(m[2], 10);
      if (v !== modal && Math.abs(v - modal) <= Math.max(3, modal * 0.03)) {
        out.push(
          anomaly({
            key: `${b.id}:${v}`,
            rule: "effectif-texte",
            category: "coherence",
            severity: "mineure",
            title: `Effectif annoncé (${fmt(v)}) différent des tableaux (${fmt(modal)})`,
            detail: `Le texte annonce ${fmt(v)} alors que ${count} tableaux totalisent ${fmt(modal)}.`,
            suggestion: `Harmoniser : utiliser ${fmt(modal)} dans le texte, ou corriger les tableaux si ${fmt(v)} est le bon effectif.`,
            excerpt: excerpt(b.text, m.index, m[0].length, 90),
            location: blockLoc(ctx, i),
          }),
        );
      }
    }
  });
  return out;
}

const FILLER = new Set(["nouveaux", "nouvelles", "nouvelle", "nouveau", "premiers", "premieres", "autres", "principaux", "principales"]);
const SYNONYMS: Record<string, string> = { labo: "laboratoire", labos: "laboratoire" };

function nounKey(after: string): string | null {
  const tokens = norm(after).split(/[^a-z-]+/).filter(Boolean);
  for (const tk of tokens.slice(0, 3)) {
    if (FILLER.has(tk)) continue;
    if (tk.length < 4) return null;
    const base = SYNONYMS[tk] ?? tk;
    return base
      .split("-")
      .map((p) => p.replace(/(aux)$/, "al").replace(/[sx]$/, ""))
      .join("-");
  }
  return null;
}

// Chiffres clés : le chiffre du titre doit se retrouver dans le corps, et
// une même population (« les 850 enseignants-chercheurs ») ne doit pas
// changer de valeur au fil du document.
function keyFigures(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const firstIdx = ctx.blocks.findIndex((b) => b.kind === "heading" || b.kind === "paragraph");
  if (firstIdx < 0) return out;
  const titleBlocks = ctx.blocks.slice(firstIdx, firstIdx + 2).filter((b) => b.kind === "heading" || b.kind === "paragraph");
  const titleText = titleBlocks.map((b) => (b.kind === "heading" || b.kind === "paragraph" ? b.text : "")).join(" ");
  const bodyText = ctx.blocks
    .slice(firstIdx + 2)
    .map((b) => (b.kind === "heading" || b.kind === "paragraph" ? b.text : b.kind === "table" ? b.rows.flat().join(" ") : ""))
    .join(" \n ");

  const claims = new Map<string, { value: number; index: number; snippet: string }[]>();
  const re = /\b(des|les|sur les|total de|l.ensemble des|au total,?)\s+(\d{2,3}(?:[   ]\d{3})?)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)?)/giu;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" && b.kind !== "heading") return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.text))) {
      const value = parseInt(m[2].replace(/\s/g, ""), 10);
      if (value >= 1900 && value <= 2100) continue;
      const key = nounKey(m[3]);
      if (!key) continue;
      const list = claims.get(key) ?? [];
      list.push({ value, index: i, snippet: excerpt(b.text, m.index, m[0].length, 40) });
      claims.set(key, list);
    }
  });

  // Chiffre du titre absent du corps.
  const nums = (titleText.match(/\b\d{2,3}(?:[   ]\d{3})?\b/g) ?? [])
    .map((s) => parseInt(s.replace(/\s/g, ""), 10))
    .filter((n) => !(n >= 1900 && n <= 2100));
  for (const n of nums) {
    const inBody = new RegExp(`(^|[^\\d])${n}([^\\d]|$)`).test(bodyText.replace(/(\d)[   ](\d{3})\b/g, "$1$2"));
    if (inBody) continue;
    const rivals = [...claims.values()].flat().filter((c) => c.value !== n && Math.abs(c.value - n) / n <= 0.3);
    const rivalValues = [...new Set(rivals.map((r) => r.value))];
    out.push(
      anomaly({
        key: `titre:${n}`,
        rule: "chiffre-titre",
        category: "coherence",
        severity: "majeure",
        title: `Le chiffre du titre (${fmt(n)}) n'apparaît nulle part dans le document`,
        detail: rivalValues.length
          ? `Le titre annonce ${fmt(n)}, mais le corps du document utilise ${rivalValues.map((v) => fmt(v)).join(" et ")}.`
          : `Le titre annonce ${fmt(n)}, chiffre qui n'est ni repris ni expliqué dans le corps du document.`,
        suggestion: "Aligner le titre sur l'effectif réellement analysé, ou expliquer l'écart (par ex. « 875 recrutés, dont 765 ayant répondu »).",
        excerpt: titleText.slice(0, 160),
        location: blockLoc(ctx, firstIdx),
      }),
    );
  }

  // Une même population citée avec des effectifs différents.
  for (const [key, list] of claims) {
    const values = [...new Set(list.map((c) => c.value))];
    if (values.length < 2) continue;
    const sorted = values.sort((a, b) => b - a);
    const occ = (v: number) => list.filter((c) => c.value === v).length;
    // Une vraie contradiction se répète (« 850 » trois fois, « 765 » deux
    // fois) ; une valeur isolée est souvent un sous-ensemble (« sur les 131
    // laboratoires identifiés » parmi 163), sauf si les deux sont presque égales.
    const pairs = sorted.filter(
      (v) => v !== sorted[0] && sorted[0] / v <= 1.5 && ((occ(v) >= 2 && occ(sorted[0]) >= 2) || sorted[0] / v <= 1.05),
    );
    if (!pairs.length) continue;
    const involved = [sorted[0], ...pairs];
    const occurrences = list.filter((c) => involved.includes(c.value));
    const counts = involved.map((v) => `${fmt(v)} (${plural(occurrences.filter((c) => c.value === v).length, "fois", "fois")})`);
    out.push(
      anomaly({
        key: `population:${key}`,
        rule: "effectif-contradictoire",
        category: "coherence",
        severity: "majeure",
        title: `Effectif contradictoire : ${involved.map((v) => fmt(v)).join(" ou ")} « ${key.replace(/-/g, " ")} » ?`,
        detail: `Le document désigne la même population avec des effectifs différents : ${counts.join(", ")}. Exemples : ${listSome(
          involved.map((v) => `« ${occurrences.find((c) => c.value === v)!.snippet} »`),
          3,
        )}.`,
        suggestion:
          "Retenir un effectif unique (celui des tableaux, en général) et l'utiliser partout ; si plusieurs populations coexistent (recrutés, répondants, retenus), les nommer explicitement.",
        location: blockLoc(ctx, occurrences[0].index),
      }),
    );
  }
  return out;
}

// Devises et unités de compte : un même document ne doit pas mélanger USD,
// euros et GNF (ni milliers et millions) sans taux ni précision.
function currencies(ctx: DocContext): Anomaly[] {
  const found = new Map<Currency, { count: number; where: Set<string>; first: number }>();
  const note = (c: Currency | null, where: string, index: number) => {
    if (!c) return;
    const f = found.get(c) ?? { count: 0, where: new Set<string>(), first: index };
    f.count++;
    f.where.add(where);
    found.set(c, f);
  };
  const amountRe =
    /\d[\d   .,]*\s?(milliards?|millions?|mds?)?\s?(de\s)?(gnf|fg|francs? guin[ée]ens?|usd|dollars?|\$|€|euros?|eur|fcfa)(?=$|[^\p{L}\d])|(?:^|[^\p{L}])(gnf|usd|€|\$)\s?\d/giu;
  ctx.blocks.forEach((b, i) => {
    if (b.kind === "paragraph" || b.kind === "heading") {
      let m: RegExpExecArray | null;
      while ((m = amountRe.exec(b.text))) note(currencyOf((m[3] ?? m[4] ?? "").trim()), `texte (${(ctx.pathOf[i].slice(-1)[0] ?? "début").slice(0, 50)})`, i);
    }
  });
  for (const t of ctx.tables) {
    t.header.forEach((h, c) => {
      const m = h.match(/\b(gnf|fg|usd|eur|euros?|dollars?|fcfa)\b|[€$]/i);
      if (m && t.kinds[c] === "count") note(currencyOf(m[0]), `« ${t.title.slice(0, 60)} »`, t.index);
    });
    t.nums.forEach((row) => row.forEach((n) => n?.currency && note(n.currency, `« ${t.title.slice(0, 60)} »`, t.index)));
  }
  const used = [...found.entries()].filter(([, f]) => f.count >= 1);
  if (used.length < 2) return [];
  const names: Record<Currency, string> = { GNF: "francs guinéens (GNF)", USD: "dollars (USD)", EUR: "euros", XOF: "francs CFA" };
  return [
    anomaly({
      key: "devises",
      rule: "devises-multiples",
      category: "budget",
      severity: "majeure",
      title: `Montants exprimés en ${used.length} devises différentes`,
      detail: used.map(([c, f]) => `${names[c]} : ${plural(f.count, "montant")} (${listSome([...f.where], 3, ", ")})`).join(" ; ") + ".",
      suggestion:
        "Exprimer tous les montants dans une devise unique (GNF pour le budget de l'État) ou indiquer le taux de change retenu et sa date, puis consolider les totaux dans cette devise.",
      location: blockLoc(ctx, Math.min(...used.map(([, f]) => f.first))),
    }),
  ];
}

function scales(ctx: DocContext): Anomaly[] {
  const re = /\ben\s+(milliers|millions|milliards)\s+de\s+(gnf|fg|francs|usd|dollars|euros|fcfa)/gi;
  const found = new Map<string, number>();
  ctx.blocks.forEach((b, i) => {
    const text = b.kind === "paragraph" || b.kind === "heading" ? b.text : b.kind === "table" ? b.rows.slice(0, 3).flat().join(" ") : "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) if (!found.has(m[1].toLowerCase())) found.set(m[1].toLowerCase(), i);
  });
  if (found.size < 2) return [];
  return [
    anomaly({
      key: "echelles",
      rule: "unites-multiples",
      category: "budget",
      severity: "majeure",
      title: "Unités de compte différentes selon les tableaux",
      detail: `Le document mélange des montants « en ${[...found.keys()].join(" », « en ")} ».`,
      suggestion: "Adopter une seule unité (par ex. millions de GNF) pour tous les tableaux budgétaires, ou la rappeler clairement dans chaque titre de tableau avant toute comparaison.",
      location: blockLoc(ctx, Math.min(...found.values())),
    }),
  ];
}

// Montant cité dans le texte ≈ total d'un tableau, mais pas égal
// (« coût total estimé à 221 000 000 GNF » pour un tableau à 220 000 000).
function moneyVsTotals(ctx: DocContext): Anomaly[] {
  const totals: { t: TableInfo; value: number; c: number; r: number }[] = [];
  for (const t of ctx.tables) {
    for (const r of t.totalRows) {
      t.nums[r].forEach((n, c) => {
        if (n && t.money[c] && n.value >= 1000) totals.push({ t, value: n.value, c, r });
      });
    }
  }
  if (!totals.length) return [];
  const out: Anomaly[] = [];
  const re = /(\d{1,3}(?:[   .]\d{3})+|\d{4,})(?:,(\d+))?\s*(milliards?|millions?)?\s*(?:de\s)?(gnf|fg|francs|usd|dollars?|\$|€|euros?|fcfa)/gi;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.text))) {
      const scale = /milliard/i.test(m[3] ?? "") ? 1e9 : /million/i.test(m[3] ?? "") ? 1e6 : 1;
      const v = Number(m[1].replace(/[   .]/g, "") + (m[2] ? "." + m[2] : "")) * scale;
      // « 2 151,10 milliards » pour 2 151 099 853 573 : c'est le même montant arrondi.
      const rounding = 0.5 * Math.pow(10, -(m[2]?.length ?? 0)) * scale + 1;
      if (totals.some((x) => Math.abs(x.value - v) <= rounding)) continue;
      const near = totals.find((x) => Math.abs(v - x.value) / x.value <= 0.02);
      if (!near) continue;
      const rowsSum = near.t.nums
        .map((row, r) => (near.t.totalRows.includes(r) ? 0 : row[near.c]?.value ?? 0))
        .reduce((a, x) => a + x, 0);
      out.push(
        anomaly({
          key: `${b.id}:montant:${v}`,
          rule: "montant-texte-tableau",
          category: "budget",
          severity: "majeure",
          title: "Montant du texte différent du total du tableau",
          detail:
            `Le texte annonce ${fmt(v)}, alors que le tableau « ${near.t.title} » totalise ${fmt(near.value)}.` +
            (Math.abs(rowsSum - v) < 0.5 ? ` Le montant du texte correspond à la somme des lignes : c'est le total du tableau qui est faux.` : ""),
          suggestion: "Harmoniser le texte et le tableau après avoir recalculé le total.",
          excerpt: excerpt(b.text, m.index, m[0].length, 70),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

// Dates impossibles : jour de la semaine qui ne correspond pas à la date
// (« lundi 9 février 2025 » était un dimanche), texte officiel dont le
// numéro porte une année postérieure à sa date (« D/2026/0020 du … 2025 »).
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTH_NAMES = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

function dates(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const re = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+((?:19|20)\d{2})\b/gi;
  const decree = /\b[A-Z]{1,3}\s*\/\s*((?:19|20)\d{2})\s*\/\s*\d+[^,;.]{0,60}?\bdu\s+(?:\w+\s+)?\d{1,2}(?:er)?\s+\w+\s+((?:19|20)\d{2})/g;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" && b.kind !== "heading") return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(b.text))) {
      const month = MONTH_NAMES.indexOf(norm(m[3]));
      const day = parseInt(m[2], 10);
      const year = parseInt(m[4], 10);
      const d = new Date(Date.UTC(year, month, day));
      if (d.getUTCMonth() !== month) continue;
      const actual = WEEKDAYS[d.getUTCDay()];
      if (actual === norm(m[1])) continue;
      // Quelle année donnerait le bon jour ? (souvent une faute sur l'année)
      const fix = [year - 1, year + 1].find((y) => WEEKDAYS[new Date(Date.UTC(y, month, day)).getUTCDay()] === norm(m![1]));
      out.push(
        anomaly({
          key: `${b.id}:date:${m.index}`,
          rule: "date-impossible",
          category: "coherence",
          severity: "majeure",
          title: `Date impossible : « ${m[0]} »`,
          detail: `Le ${day} ${m[3]} ${year} était un ${actual}, pas un ${norm(m[1])}.${fix ? ` Le ${day} ${m[3]} ${fix} était bien un ${norm(m[1])} : l'année est probablement fausse.` : ""}`,
          suggestion: fix ? `Vérifier la date sur le texte original (vraisemblablement le ${norm(m[1])} ${day} ${m[3]} ${fix}).` : "Vérifier la date sur le texte original.",
          excerpt: excerpt(b.text, m.index, m[0].length, 60),
          location: blockLoc(ctx, i),
        }),
      );
    }
    decree.lastIndex = 0;
    while ((m = decree.exec(b.text))) {
      const numYear = parseInt(m[1], 10);
      const dateYear = parseInt(m[2], 10);
      if (numYear <= dateYear) continue;
      out.push(
        anomaly({
          key: `${b.id}:texte:${m.index}`,
          rule: "date-texte-officiel",
          category: "coherence",
          severity: "majeure",
          title: "Numéro et date d'un texte officiel incompatibles",
          detail: `Le texte est numéroté en ${numYear} mais daté de ${dateYear} : un texte ne peut pas être antérieur à l'année de son numéro.`,
          suggestion: "Vérifier la référence exacte (numéro et date) sur le Journal officiel ou l'original signé.",
          excerpt: excerpt(b.text, m.index, m[0].length, 50),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

// Ventilation qui ne tombe pas juste : « 80 programmes de Master (41 Masters
// de recherche et 19 Masters professionnels) », « 141 programmes, dont 113
// Licences et 28 formations ».
function breakdowns(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const num = String.raw`(\d{1,3}(?:[   ]\d{3})*|\d+)`;
  const re = new RegExp(
    String.raw`${num}\s+([\p{L}’'-]+(?:\s+[\p{L}’'-]+){0,4}?)\s*(?:\(|,\s*dont\s+|:\s*)${num}\s+[^()]{2,60}?\s+et\s+${num}\s+[^()]{2,60}?(?:\)|[.;]|$)`,
    "gu",
  );
  const toInt = (s: string) => parseInt(s.replace(/\s/g, ""), 10);
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(b.text))) {
      const total = toInt(m[1]);
      const a = toInt(m[3]);
      const c = toInt(m[4]);
      if (total >= 1900 && total <= 2100) continue; // une année, pas un total
      if (a + c === total || a > total || c > total) continue;
      // « dont a … et b … » peut être partiel (« 153 enseignants, dont 103… ») :
      // on ne signale que si la parenthèse ou le « dont » semble exhaustif.
      const partial = /dont/.test(m[0]) && a + c < total && !/\(/.test(m[0]);
      if (partial) continue;
      out.push(
        anomaly({
          key: `${b.id}:ventilation:${m.index}`,
          rule: "ventilation-incoherente",
          category: "calcul",
          severity: "majeure",
          title: `Ventilation qui ne tombe pas juste : ${fmt(a)} + ${fmt(c)} ≠ ${fmt(total)}`,
          detail: `Le texte annonce ${fmt(total)} ${m[2]} puis les répartit en ${fmt(a)} et ${fmt(c)}, soit ${fmt(a + c)} (écart de ${fmt(total - a - c)}).`,
          suggestion: `Corriger le total (${fmt(a + c)}) ou compléter la répartition avec la catégorie manquante (${fmt(total - a - c)}).`,
          excerpt: excerpt(b.text, m.index, m[0].length, 40),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

// Unité annoncée fausse : un tableau « en millions de GNF » dont les montants
// sont exactement ceux des tableaux exprimés en GNF.
function unitLabels(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const scaleOf = (t: TableInfo) => norm([t.title, ...t.preamble, ...t.header].join(" ")).match(/en (milliers|millions|milliards) de/)?.[1] ?? null;
  const unitValues = new Set<number>();
  for (const t of ctx.tables) {
    if (scaleOf(t)) continue;
    for (const row of t.nums) for (const n of row) if (n && n.value >= 1e8) unitValues.add(n.value);
  }
  for (const t of ctx.tables) {
    const scale = scaleOf(t);
    if (!scale) continue;
    const shared = [...new Set(t.nums.flat().filter((n): n is NonNullable<typeof n> => !!n && n.value >= 1e8).map((n) => n.value))].filter((v) => unitValues.has(v));
    if (shared.length < 2) continue;
    out.push(
      anomaly({
        key: `${t.block.id}:unite`,
        rule: "unite-erronee",
        category: "budget",
        severity: "majeure",
        title: `Unité du tableau probablement fausse (« en ${scale} »)`,
        detail: `Le tableau « ${t.title} » annonce des montants en ${scale}, mais ${plural(shared.length, "montant")} (par ex. ${fmt(shared[0])}) sont identiques à ceux de tableaux exprimés en unités : ils seraient ${scale === "millions" ? "un million" : scale === "milliards" ? "un milliard" : "mille"} de fois plus élevés.`,
        suggestion: `Corriger l'unité du titre (« en GNF ») ou convertir les montants en ${scale}.`,
        location: tableLoc(ctx, t),
      }),
    );
  }
  return out;
}

export function consistencyRules(ctx: DocContext): Anomaly[] {
  return [
    ...textVsTables(ctx),
    ...populationConsistency(ctx),
    ...keyFigures(ctx),
    ...currencies(ctx),
    ...scales(ctx),
    ...moneyVsTotals(ctx),
    ...dates(ctx),
    ...breakdowns(ctx),
    ...unitLabels(ctx),
  ];
}
