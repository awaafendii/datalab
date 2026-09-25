import type { Anomaly } from "../types";
import type { DocContext } from "../structure";
import { editDistance, endsWithTerminal, excerpt, norm, plural, truncate, wordCount } from "../text";
import { anomaly, blockLoc, listSome, tableLoc } from "./util";

// Qualité rédactionnelle et finition : textes à compléter, renvois cassés,
// coquilles, mots doublés, phrases tronquées, pourcentages sans « % »,
// paragraphes répétés.

const PLACEHOLDER_RE =
  /\[[^\]]{0,40}(date|lieu|localit|nombre|nbre|préciser|preciser|compléter|completer|montant|nom|valeur|chiffre|x{2,}|…|\.\.\.|à définir|a definir|tbd|n°|%|insérer|inserer|titre|année|annee|période|periode)[^\]]{0,40}\]/gi;
const PLACEHOLDER_FREE_RE =
  /(?:^|[\s(])(?:à|a) (?:compléter|completer|préciser|preciser|renseigner)(?=$|[\s).,;:])|\bX{3,}\b|\bTBD\b|\?\?+/gi;
const BROKEN_REF_RE = /erreur\s*!\s*(source du renvoi introuvable|signet non défini|référence non valide)|error!\s*(reference source not found|bookmark not defined)/gi;

function placeholders(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const brokenRefs: { i: number; text: string; index: number }[] = [];
  ctx.blocks.forEach((b, i) => {
    if (b.kind === "paragraph" || b.kind === "heading") {
      const found: { index: number; raw: string }[] = [];
      for (const re of [PLACEHOLDER_RE, PLACEHOLDER_FREE_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(b.text))) found.push({ index: m.index, raw: m[0].trim() });
      }
      // Tableau saisi avec des tabulations dont les cases valent « … ».
      if (/\t/.test(b.text) && /(^|\t)\s*(…|\.{3})\s*(\t|$)/.test(b.text)) found.push({ index: b.text.indexOf("…"), raw: "…" });
      if (found.length) {
        out.push(
          anomaly({
            key: b.id,
            rule: "texte-a-completer",
            category: "completude",
            severity: "bloquante",
            title: "Texte à compléter",
            detail: `Élément(s) laissé(s) en attente : ${listSome([...new Set(found.map((f) => `« ${f.raw} »`))], 6, ", ")}. Le document n'est pas finalisé.`,
            suggestion: "Remplacer chaque espace réservé par l'information réelle (dates, lieux, valeurs) ou retirer la mention si elle n'est pas disponible.",
            excerpt: excerpt(b.text, found[0].index, found[0].raw.length, 90),
            location: blockLoc(ctx, i),
          }),
        );
      }
      BROKEN_REF_RE.lastIndex = 0;
      const br = BROKEN_REF_RE.exec(b.text);
      if (br) brokenRefs.push({ i, text: b.text, index: br.index });
    }
  });
  for (const t of ctx.tables) {
    const cells: string[] = [];
    const rows = [t.header, ...t.body];
    rows.forEach((row) =>
      row.forEach((c) => {
        PLACEHOLDER_RE.lastIndex = 0;
        PLACEHOLDER_FREE_RE.lastIndex = 0;
        if (PLACEHOLDER_RE.test(c) || PLACEHOLDER_FREE_RE.test(c) || /^(…|\.{3}|x{2,}|\?+)$/i.test(c.trim())) cells.push(c);
      }),
    );
    if (cells.length) {
      out.push(
        anomaly({
          key: t.block.id,
          rule: "texte-a-completer",
          category: "completude",
          severity: "bloquante",
          title: `Cases à compléter dans un tableau (${cells.length})`,
          detail: `Valeurs laissées en attente : ${listSome([...new Set(cells.map((c) => `« ${truncate(c, 40)} »`))], 6, ", ")}.`,
          suggestion: "Renseigner les cases (dates, lieux, effectifs, échéances) avant diffusion ; à défaut, indiquer « non disponible » avec la raison.",
          location: tableLoc(ctx, t),
        }),
      );
    }
  }
  if (brokenRefs.length) {
    out.push(
      anomaly({
        key: "renvois",
        rule: "renvoi-casse",
        category: "structure",
        severity: "majeure",
        title: `Renvois Word cassés (${brokenRefs.length})`,
        detail: "Des références croisées affichent un message d'erreur de Word au lieu du numéro de tableau, de figure ou de page.",
        suggestion: "Dans Word : sélectionner tout (Ctrl+A) puis F9 pour mettre à jour les champs, et recréer les renvois dont la cible a été supprimée.",
        excerpt: excerpt(brokenRefs[0].text, brokenRefs[0].index, 30, 60),
        location: blockLoc(ctx, brokenRefs[0].i),
      }),
    );
  }
  return out;
}

// Coquilles : un mot rare très proche d'un mot fréquent du même document
// (« équpements » alors que « équipements » apparaît 600 fois). Le
// document sert de dictionnaire : pas de faux positifs sur le vocabulaire
// métier, les noms propres ni les sigles. Calibré sur des documents réels :
// les fautes de frappe sont des lettres oubliées, en trop, inversées ou mal
// accentuées ; une lettre remplacée par une autre donne le plus souvent un
// autre mot correct (longue/langue, professeurs/processeurs), et un écart
// en fin de mot une autre forme du même mot (établir/établis).
// Mots corrects qui ne diffèrent d'un autre mot courant que d'une lettre
// ajoutée, retirée ou inversée : ils ne sont jamais signalés. Liste à
// compléter au fil des faux positifs rencontrés.
const VALID_WORDS = new Set([
  "fiable", "fiables", "faible", "faibles", "couvrant", "courant", "blanc", "blancs", "banc", "bancs",
  "stimulation", "simulation", "traceur", "traceurs", "tracteur", "tracteurs", "charte", "chartes", "carte",
  "cartes", "tâche", "tâches", "tache", "taches", "côte", "côtes", "cote", "cotes", "entrée", "entrées",
  "proche", "proches", "porche", "clause", "clauses", "cause", "causes", "former", "fermer", "source",
  "sources", "course", "courses", "compte", "comptes", "conte", "contes", "compter", "conter", "grade",
  "grades", "grande", "grandes",
]);

function plausibleTypo(rare: string, good: string): boolean {
  if (rare[0] !== good[0]) return false; // stable/table, révolution/évolution
  let prefix = 0;
  while (prefix < rare.length && prefix < good.length && rare[prefix] === good[prefix]) prefix++;
  if (prefix >= Math.min(rare.length, good.length) - 2) return false; // variation de terminaison
  if (rare.length === good.length) {
    const diffs: number[] = [];
    for (let i = 0; i < rare.length; i++) if (rare[i] !== good[i]) diffs.push(i);
    if (diffs.length === 1) return norm(rare[diffs[0]]) === norm(good[diffs[0]]); // accent seulement
  }
  return true;
}

function typos(ctx: DocContext): Anomaly[] {
  const freq = new Map<string, number>();
  const firstBlock = new Map<string, number>();
  const display = new Map<string, string>();
  ctx.blocks.forEach((b, i) => {
    const text = b.kind === "paragraph" || b.kind === "heading" ? b.text : b.kind === "table" ? b.rows.flat().join(" ") : "";
    for (const w of text.match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu) ?? []) {
      for (const part of w.split(/['’-]/)) {
        if (part.length < 5) continue;
        if (part === part.toUpperCase()) continue; // sigles et titres en capitales
        const k = part.toLowerCase();
        freq.set(k, (freq.get(k) ?? 0) + 1);
        if (!firstBlock.has(k)) {
          firstBlock.set(k, i);
          display.set(k, part);
        }
      }
    }
  });
  const frequent = [...freq.entries()].filter(([, n]) => n >= 3);
  const byLength = new Map<number, string[]>();
  for (const [w] of frequent) {
    const list = byLength.get(w.length) ?? [];
    list.push(w);
    byLength.set(w.length, list);
  }
  const found: { rare: string; good: string; count: number; goodCount: number }[] = [];
  for (const [w, n] of freq) {
    if (n > 2 || w.length < 6 || VALID_WORDS.has(w)) continue;
    const candidates = [w.length - 1, w.length, w.length + 1].flatMap((l) => byLength.get(l) ?? []);
    let best: string | null = null;
    for (const f of candidates) {
      const fc = freq.get(f)!;
      if (fc < Math.max(3, n * 3) || f === w) continue;
      if (editDistance(w, f, 1) !== 1 || !plausibleTypo(w, f)) continue;
      if (!best || fc > freq.get(best)!) best = f;
    }
    if (best) found.push({ rare: w, good: best, count: n, goodCount: freq.get(best)! });
  }
  // Caractère parasite au milieu d'un mot (« d2veloppement »).
  const digitWords: { w: string; i: number }[] = [];
  ctx.blocks.forEach((b, i) => {
    const text = b.kind === "paragraph" || b.kind === "heading" ? b.text : b.kind === "table" ? b.rows.flat().join(" ") : "";
    for (const m of text.match(/\b\p{Ll}{1,}\d\p{Ll}{3,}\b/gu) ?? []) digitWords.push({ w: m, i });
  });
  const out: Anomaly[] = [];
  found.sort((a, b) => b.goodCount - a.goodCount);
  for (const f of found.slice(0, 40)) {
    const i = firstBlock.get(f.rare)!;
    const shown = display.get(f.rare)!;
    const goodShown = shown[0] === shown[0].toUpperCase() ? f.good[0].toUpperCase() + f.good.slice(1) : f.good;
    out.push(
      anomaly({
        key: f.rare,
        rule: "coquille",
        category: "redaction",
        severity: "mineure",
        title: `Coquille probable : « ${shown} »`,
        detail: `« ${shown} » (${plural(f.count, "occurrence")}) ressemble à « ${goodShown} », employé ${f.goodCount} fois dans le document.`,
        suggestion: `Remplacer « ${shown} » par « ${goodShown} » (vérifier chaque occurrence avec Rechercher/Remplacer).`,
        location: blockLoc(ctx, i),
      }),
    );
  }
  for (const d of digitWords.slice(0, 10)) {
    out.push(
      anomaly({
        key: `chiffre:${d.w}`,
        rule: "coquille",
        category: "redaction",
        severity: "mineure",
        title: `Caractère parasite : « ${d.w} »`,
        detail: `Le mot « ${d.w} » contient un chiffre (faute de frappe probable).`,
        suggestion: "Corriger la faute de frappe.",
        location: blockLoc(ctx, d.i),
      }),
    );
  }
  return out;
}

const REFLEXIVE = new Set(["nous", "vous"]);

function sentencesIssues(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const truncated: number[] = [];
  const lowercase: number[] = [];
  const doubled: { i: number; w: string; index: number }[] = [];
  const missingPct: { i: number; raw: string; index: number }[] = [];
  const missingWord: { i: number; raw: string; index: number; text?: string }[] = [];
  const seen = new Map<string, number>();
  const repeated: { i: number; first: number }[] = [];

  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" || ctx.captionBlocks.has(i) || ctx.tocBlocks.has(i)) return;
    const text = b.text.replace(/\s+/g, " ").trim();
    const n = wordCount(text);

    // Mots doublés (« de de », « le le »). Frontières de mot explicites : \b
    // ne connaît pas les lettres accentuées (« guinéen en » n'est pas « en en »).
    const dm = /(^|[^\p{L}])(\p{L}{2,})\s+\2(?![\p{L}])/iu.exec(text);
    if (dm && !REFLEXIVE.has(dm[2].toLowerCase())) {
      const index = dm.index + dm[1].length;
      doubled.push({ i, w: dm[0].slice(dm[1].length), index });
    }

    // Mot manquant : un article directement suivi d'une conjonction ou d'une
    // ponctuation (« à travers la et le suivi des résultats »).
    const mm = /(^|[^\p{L}])(la|le|les|des|du|une|aux|au)\s+(et|ou|,|\.)(?![\p{L}])/iu.exec(text);
    if (mm && !/\b(ou|et)\s+(la|le|les|des|du)\s+(et|ou)\b/i.test(text.slice(Math.max(0, mm.index - 6), mm.index + 12))) {
      missingWord.push({ i, raw: mm[0].slice(mm[1].length), index: mm.index + mm[1].length });
    }

    // Pourcentage dont le signe a été oublié (« 44,1 des répondants »).
    const pm = /(?:^|[\s(])(\d{1,2},\d{1,2})\s+(des|de|d’|d'|qui|contre|affirment|déclarent|declarent|disent|jugent|ont|sont|estiment|indiquent)\b/i.exec(text);
    if (pm) missingPct.push({ i, raw: pm[1], index: pm.index });

    if (!b.list && n >= 8) {
      const prev = ctx.blocks[i - 1];
      const prevText = prev && (prev.kind === "paragraph" || prev.kind === "heading") ? prev.text.trim() : "";
      // Phrase inachevée : un vrai paragraphe (pas une ligne de liste ou de
      // notes) qui s'arrête sans ponctuation.
      const lastSentence = text.split(/[.!?…]\s/).pop() ?? "";
      if (n >= 20 && !endsWithTerminal(text) && wordCount(lastSentence) >= 2 && !/\d$/.test(text)) truncated.push(i);
      // Paragraphe commençant par une minuscule après un texte clos : coupé ou déplacé.
      if (/^\p{Ll}/u.test(text) && prev && prev.kind === "paragraph" && !/[,:;(]$/.test(prevText) && !/^(e\.g|n°|cf\.|ex\.|i\.e)/i.test(text)) {
        lowercase.push(i);
      }
    }
    if (n >= 25) {
      const key = norm(text);
      const first = seen.get(key);
      if (first !== undefined) repeated.push({ i, first });
      else seen.set(key, i);
    }
  });

  for (const d of doubled) {
    out.push(
      anomaly({
        key: `${ctx.blocks[d.i].id}:double`,
        rule: "mot-double",
        category: "redaction",
        severity: "mineure",
        title: `Mot répété : « ${d.w} »`,
        detail: "Le même mot est écrit deux fois de suite.",
        suggestion: "Supprimer le mot en trop.",
        excerpt: excerpt((ctx.blocks[d.i] as { text: string }).text, d.index, d.w.length, 50),
        location: blockLoc(ctx, d.i),
      }),
    );
  }
  // Même contrôle dans les cellules de tableau (une cellule reprise dans
  // plusieurs tableaux n'est signalée qu'une fois).
  const seenCells = new Set<string>();
  for (const t of ctx.tables) {
    for (const row of [t.header, ...t.body]) {
      for (const c of row) {
        if (c.length < 15 || seenCells.has(c)) continue;
        seenCells.add(c);
        const mm = /(^|[^\p{L}])(la|le|les|des|du|une|aux|au)\s+(et|ou|,|\.)(?![\p{L}])/iu.exec(c);
        if (mm) missingWord.push({ i: t.index, raw: mm[0].slice(mm[1].length), index: mm.index + mm[1].length, text: c });
      }
    }
  }
  for (const w of missingWord) {
    out.push(
      anomaly({
        key: `${ctx.blocks[w.i].id}:mot-manquant:${w.index}`,
        rule: "mot-manquant",
        category: "redaction",
        severity: "mineure",
        title: `Mot manquant : « ${w.raw} »`,
        detail: "Un article est directement suivi d'une conjonction ou d'une ponctuation : un mot a été oublié ou supprimé.",
        suggestion: "Rétablir le mot manquant (par ex. « à travers la contractualisation et le suivi des résultats »).",
        excerpt: excerpt(w.text ?? (ctx.blocks[w.i] as { text: string }).text, w.index, w.raw.length, 60),
        location: ctx.tableAt.get(w.i) ? tableLoc(ctx, ctx.tableAt.get(w.i)!) : blockLoc(ctx, w.i),
      }),
    );
  }
  for (const p of missingPct) {
    out.push(
      anomaly({
        key: `${ctx.blocks[p.i].id}:pct`,
        rule: "pourcentage-sans-signe",
        category: "redaction",
        severity: "mineure",
        title: `Signe « % » manquant après ${p.raw}`,
        detail: `Le nombre ${p.raw} désigne visiblement une proportion mais n'est suivi d'aucune unité.`,
        suggestion: `Écrire « ${p.raw} % ».`,
        excerpt: excerpt((ctx.blocks[p.i] as { text: string }).text, p.index, 12, 60),
        location: blockLoc(ctx, p.i),
      }),
    );
  }
  for (const i of truncated.slice(0, 15)) {
    const text = (ctx.blocks[i] as { text: string }).text;
    out.push(
      anomaly({
        key: `${ctx.blocks[i].id}:tronque`,
        rule: "phrase-inachevee",
        category: "redaction",
        severity: "mineure",
        title: "Phrase inachevée",
        detail: "Le paragraphe se termine sans ponctuation, au milieu d'une phrase : du texte a peut-être été supprimé ou coupé.",
        suggestion: "Compléter ou supprimer la fin de phrase, puis terminer par un point.",
        excerpt: "…" + text.slice(-120),
        location: blockLoc(ctx, i),
      }),
    );
  }
  for (const i of lowercase.slice(0, 15)) {
    out.push(
      anomaly({
        key: `${ctx.blocks[i].id}:minuscule`,
        rule: "paragraphe-coupe",
        category: "redaction",
        severity: "mineure",
        title: "Paragraphe commençant par une minuscule",
        detail: "Ce paragraphe semble être la suite d'une phrase commencée ailleurs (texte coupé ou paragraphes inversés).",
        suggestion: "Rattacher ce texte à la phrase qu'il complète ou rétablir l'ordre des paragraphes.",
        excerpt: truncate((ctx.blocks[i] as { text: string }).text, 160),
        location: blockLoc(ctx, i),
      }),
    );
  }
  for (const r of repeated) {
    out.push(
      anomaly({
        key: `${ctx.blocks[r.i].id}:repete`,
        rule: "paragraphe-repete",
        category: "redaction",
        severity: "mineure",
        title: "Paragraphe répété",
        detail: `Ce paragraphe figure déjà plus haut (section « ${ctx.pathOf[r.first].slice(-1)[0] ?? "début du document"} »).`,
        suggestion: "Supprimer la répétition ou la remplacer par un renvoi.",
        excerpt: truncate((ctx.blocks[r.i] as { text: string }).text, 160),
        location: blockLoc(ctx, r.i),
      }),
    );
  }
  return out;
}

export function writingRules(ctx: DocContext): Anomaly[] {
  return [...placeholders(ctx), ...typos(ctx), ...sentencesIssues(ctx)];
}
