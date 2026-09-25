import type { Anomaly } from "../types";
import type { DocContext, HeadingInfo } from "../structure";
import { CAPTION_RE } from "../structure";
import { profileOf } from "../referentiel";
import { endsWithTerminal, excerpt, hasDate, norm, plural, truncate, upperRatio, wordCount } from "../text";
import { anomaly, blockLoc, listSome } from "./util";

// Contrôles de structure : sections attendues selon le type de document,
// numérotation, sections vides ou à l'état de notes, annexes annoncées,
// renvois « ci-dessus / ci-dessous », liste des tableaux, date et
// structure émettrice.

const FRONT_MATTER_RE =
  /table des matieres|sommaire|liste des (tableaux|figures|graphiques|sigles|abreviations|illustrations|cartes)|sigles|abreviations|annexes?$|comite de redaction|composition|destinataires|references|bibliographie|signature|remerciements|avant-propos|preface/;

// Libellés de sections : titres (explicites ou déduits) et lignes courtes
// isolées qui jouent le rôle de titre (« Contexte général », « Résumé
// Exécutif ») même sans mise en forme.
function sectionLabels(ctx: DocContext): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  ctx.blocks.forEach((b, i) => {
    if (ctx.tocBlocks.has(i)) return;
    if (b.kind === "heading") out.push({ text: norm(b.text), index: i });
    else if (b.kind === "paragraph") {
      const t = b.text.trim();
      if (wordCount(t) <= 6 && !/[.;,]$/.test(t) && /^\P{Ll}/u.test(t)) out.push({ text: norm(t), index: i });
    } else if (b.kind === "table") {
      const first = b.rows[0]?.filter(Boolean) ?? [];
      if (first.length === 1 && wordCount(first[0]) <= 12) out.push({ text: norm(first[0]), index: i });
    }
  });
  return out;
}

function requiredSections(ctx: DocContext): Anomaly[] {
  const profile = profileOf(ctx.kind);
  if (!profile.sections.length) return [];
  const labels = sectionLabels(ctx);
  const out: Anomaly[] = [];
  for (const spec of profile.sections) {
    if (labels.some((l) => spec.patterns.some((re) => re.test(l.text)))) continue;
    out.push(
      anomaly({
        key: spec.id,
        rule: "section-absente",
        category: "completude",
        severity: spec.severity,
        title: `Section attendue absente : ${spec.label}`,
        detail: `Pour un document de type « ${profile.label} », cette section est attendue : ${spec.why}.`,
        suggestion: `Ajouter une section « ${spec.label} » (ou renommer la section existante qui en tient lieu pour qu'elle soit identifiable).`,
        location: {},
      }),
    );
  }
  return out;
}

function numbering(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const seen = new Set<string>();
  const gaps: { h: HeadingInfo; missing: string }[] = [];
  const dupes: HeadingInfo[] = [];
  const zeros: HeadingInfo[] = [];
  const seps = { dot: 0, dash: 0, exampleDot: "", exampleDash: "" };
  for (const h of ctx.headings) {
    const n = h.numbering;
    if (!n) continue;
    const p = n.parts;
    const key = p.join(".");
    if (p.length >= 2) {
      if (/[.]/.test(n.raw) && !/[-–]/.test(n.raw)) {
        seps.dot++;
        seps.exampleDot ||= n.raw;
      } else if (/[-–]/.test(n.raw) && !/\./.test(n.raw)) {
        seps.dash++;
        seps.exampleDash ||= n.raw;
      }
      if (p.includes(0)) zeros.push(h);
      const last = p[p.length - 1];
      if (last > 1) {
        const prevKey = [...p.slice(0, -1), last - 1].join(".");
        if (!seen.has(prevKey)) {
          const sep = n.raw.match(/[.\-–]/)?.[0] ?? ".";
          const romanFirst = n.roman ? n.raw.split(/[.\-–]/)[0] : null;
          const shown = [romanFirst ?? String(p[0]), ...[...p.slice(1, -1), last - 1].map(String)].join(sep);
          gaps.push({ h, missing: shown });
        }
      }
      if (seen.has(key)) dupes.push(h);
    }
    seen.add(key);
  }
  if (gaps.length) {
    out.push(
      anomaly({
        key: "trous",
        rule: "numerotation-trou",
        category: "structure",
        severity: "mineure",
        title: `Numérotation des sections : ${plural(gaps.length, "numéro manquant", "numéros manquants")}`,
        detail: listSome(gaps.map((g) => `« ${g.missing} » absent avant « ${truncate(g.h.block.text, 60)} »`)) + ".",
        suggestion: "Renuméroter les sections (idéalement avec la numérotation automatique des styles Titre de Word) ou rétablir la section manquante.",
        location: blockLoc(ctx, gaps[0].h.index),
      }),
    );
  }
  if (dupes.length) {
    out.push(
      anomaly({
        key: "doublons",
        rule: "numerotation-doublon",
        category: "structure",
        severity: "mineure",
        title: `Numéros de section utilisés deux fois (${dupes.length})`,
        detail: listSome(dupes.map((d) => `« ${truncate(d.block.text, 60)} »`)) + ".",
        suggestion: "Renuméroter les sections concernées.",
        location: blockLoc(ctx, dupes[0].index),
      }),
    );
  }
  if (seps.dot >= 2 && seps.dash >= 2) {
    out.push(
      anomaly({
        key: "separateurs",
        rule: "numerotation-style",
        category: "structure",
        severity: "mineure",
        title: "Styles de numérotation mélangés",
        detail: `Le document utilise à la fois des points (« ${seps.exampleDot} », ${seps.dot} titres) et des tirets (« ${seps.exampleDash} », ${seps.dash} titres) dans la numérotation des sections.`,
        suggestion: "Harmoniser la numérotation (un seul séparateur) dans tout le document.",
        location: {},
      }),
    );
  }
  if (zeros.length) {
    out.push(
      anomaly({
        key: "zero",
        rule: "numerotation-zero",
        category: "structure",
        severity: "mineure",
        title: "Numéro de section contenant « 0 »",
        detail: listSome(zeros.map((z) => `« ${truncate(z.block.text, 60)} »`)) + " : un niveau intermédiaire manque dans la numérotation.",
        suggestion: "Ajouter le niveau manquant (par ex. « V.1 ») ou remonter ces sections d'un niveau.",
        location: blockLoc(ctx, zeros[0].index),
      }),
    );
  }
  return out;
}

function emptyAndSketchySections(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  // Page de garde : tout ce qui précède le premier titre stylé (ou, à
  // défaut, le premier vrai paragraphe).
  const firstExplicit = ctx.headings.find((h) => !h.block.inferred)?.index ?? -1;
  const firstContent = ctx.blocks.findIndex((b) => b.kind === "paragraph" && wordCount(b.text) >= 15);
  const coverEnd = firstExplicit >= 0 ? firstExplicit : firstContent;
  const imagePages = new Set(ctx.doc.pagesWithImages ?? []);
  ctx.headings.forEach((h, k) => {
    const t = norm(h.block.text);
    if (FRONT_MATTER_RE.test(t)) return;
    if (h.block.inferred && coverEnd >= 0 && h.index < coverEnd) return;
    const next = ctx.blocks[h.index + 1];
    const nextHeading = ctx.headings[k + 1];
    // Section vide : suivie directement d'un titre de même niveau ou supérieur.
    // Un titre déduit (paragraphe numéroté) sous un titre stylé est du
    // contenu : son niveau n'est pas comparable à celui des styles Word.
    // Un titre de partie en capitales (« PRESENTATION DES PROGRAMMES ») suivi
    // directement de ses chapitres de même niveau n'est pas une section vide.
    const partTitle = upperRatio(h.block.text) > 0.8 && next?.kind === "heading" && next.level === h.block.level;
    const nextIsSibling = !partTitle && next?.kind === "heading" && next.level <= h.block.level && (!next.inferred || h.block.inferred);
    if ((!next || nextIsSibling) && ctx.doc.format !== "sheet") {
      if (h.block.page !== undefined && imagePages.has(h.block.page) && ctx.doc.format === "pdf") return;
      out.push(
        anomaly({
          key: h.block.id,
          rule: "section-vide",
          category: "completude",
          severity: "majeure",
          title: "Section vide",
          detail: `La section « ${truncate(h.block.text, 80)} » n'a aucun contenu.`,
          suggestion: "Rédiger la section ou la supprimer (et mettre à jour le sommaire).",
          location: blockLoc(ctx, h.index),
        }),
      );
      return;
    }
    // Section restée à l'état de notes : que des lignes courtes, sans phrase.
    const end = nextHeading ? nextHeading.index : ctx.blocks.length;
    const content = ctx.blocks.slice(h.index + 1, end);
    if (content.length < 2 || content.some((b) => b.kind !== "paragraph")) return;
    const paras = content as { kind: "paragraph"; text: string; list: boolean }[];
    // Bloc d'identification (« SITE : … », « DATE : … », « CHEF DE MISSION : … »).
    const fields = paras.filter((p) => /^[\p{Lu}\s'’/-]{2,40}\s*:\s*\S/u.test(p.text)).length;
    if (fields / paras.length >= 0.5) return;
    const notes = paras.every((p) => !p.list && wordCount(p.text) <= 14 && !endsWithTerminal(p.text));
    if (notes && !/annexe/.test(t)) {
      // Une section de recommandations en lignes courtes est une liste mal
      // mise en forme ; un contexte ou une analyse en lignes courtes n'est
      // pas rédigé.
      const listLike = /recommandation|proposition|orientation|perspective|mesures|actions|objectifs/.test(t);
      out.push(
        anomaly({
          key: `${h.block.id}:notes`,
          rule: "section-notes",
          category: "completude",
          severity: listLike ? "mineure" : "majeure",
          title: "Section non rédigée (notes ou plan)",
          detail: `La section « ${truncate(h.block.text, 80)} » ne contient que ${plural(paras.length, "ligne courte", "lignes courtes")} sans phrase rédigée : ${listSome(
            paras.map((p) => `« ${truncate(p.text, 50)} »`),
            4,
          )}.`,
          suggestion: "Rédiger ces éléments en paragraphes (ou en liste à puces complète) ; s'il s'agit d'un plan provisoire, le compléter avant diffusion.",
          location: blockLoc(ctx, h.index),
        }),
      );
    }
  });
  return out;
}

function annexes(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const annexHeadings = ctx.headings.filter((h) => /^(\d+\.?\s*)?annexes?\b/.test(norm(h.title || h.block.text)));
  const main = annexHeadings.find((h) => /^(\d+\.?\s*)?annexes?\s*:?$/.test(norm(h.title || h.block.text))) ?? annexHeadings[0];
  if (main) {
    const content = ctx.blocks.slice(main.index + 1);
    const hasBody = content.some(
      (b) => b.kind === "table" || b.kind === "figure" || (b.kind === "paragraph" && wordCount(b.text) > 14) || (b.kind === "heading" && /annexe/i.test(b.text)),
    );
    if (!hasBody && content.length > 0) {
      out.push(
        anomaly({
          key: "annexes",
          rule: "annexes-absentes",
          category: "completude",
          severity: "majeure",
          title: "Annexes annoncées mais non jointes",
          detail: `La section « ${truncate(main.block.text, 60)} » se contente de lister ${plural(content.length, "annexe")} (${listSome(
            content.map((b) => (b.kind === "paragraph" || b.kind === "heading" ? `« ${truncate(b.text, 40)} »` : "")).filter(Boolean),
            4,
          )}) sans leur contenu.`,
          suggestion: "Joindre les annexes au document (ou en pièces jointes numérotées) ; sinon retirer la liste.",
          location: blockLoc(ctx, main.index),
        }),
      );
    }
  } else {
    // Renvoi à une annexe alors que le document n'en contient aucune.
    const ref = ctx.blocks.findIndex(
      (b) => b.kind === "paragraph" && /\b(en annexe|voir annexe|cf\.? annexe|\(annexe\s*\w*\))/i.test(b.text),
    );
    if (ref >= 0) {
      out.push(
        anomaly({
          key: "renvoi-annexe",
          rule: "annexe-introuvable",
          category: "completude",
          severity: "mineure",
          title: "Renvoi à une annexe absente",
          detail: "Le texte renvoie à une annexe, mais le document ne contient aucune section « Annexe ».",
          suggestion: "Ajouter l'annexe citée ou supprimer le renvoi.",
          excerpt: truncate((ctx.blocks[ref] as { text: string }).text, 160),
          location: blockLoc(ctx, ref),
        }),
      );
    }
  }
  return out;
}

function aboveBelow(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const isVisual = (i: number) => ctx.blocks[i]?.kind === "table" || ctx.blocks[i]?.kind === "figure";
  const around = (i: number, from: number, to: number) => {
    for (let k = from; k <= to; k++) if (k !== 0 && isVisual(i + k)) return true;
    return false;
  };
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    const m = /(tableau|graphique|figure|liste)\s+ci-(dessus|dessous)/i.exec(b.text);
    if (!m) return;
    const above = m[2].toLowerCase() === "dessus";
    const before = around(i, -4, -1);
    const after = around(i, 1, 4);
    if (above && !before && after) {
      out.push(
        anomaly({
          key: `${b.id}:ci`,
          rule: "renvoi-ci-dessus",
          category: "redaction",
          severity: "mineure",
          title: `« ${m[0]} » alors que l'élément est en dessous`,
          detail: "Le texte renvoie à un élément « ci-dessus », mais celui-ci est placé après le paragraphe.",
          suggestion: `Écrire « ${m[1]} ci-dessous » (ou mieux : citer son numéro, par ex. « le tableau 5 »).`,
          excerpt: excerpt(b.text, m.index, m[0].length, 60),
          location: blockLoc(ctx, i),
        }),
      );
    } else if (!before && !after && !ctx.tables.some((t) => Math.abs(t.index - i) <= 12)) {
      out.push(
        anomaly({
          key: `${b.id}:ci`,
          rule: "renvoi-ci-dessus",
          category: "completude",
          severity: "mineure",
          title: `« ${m[0]} » : élément introuvable`,
          detail: `Le texte annonce un ${m[1].toLowerCase()} ${above ? "au-dessus" : "en dessous"}, mais aucun tableau ni aucune figure ne se trouve à proximité.`,
          suggestion: `Insérer le ${m[1].toLowerCase()} annoncé ou corriger le renvoi (en citant son numéro).`,
          excerpt: excerpt(b.text, m.index, m[0].length, 60),
          location: blockLoc(ctx, i),
        }),
      );
    } else if (!above && !after && before) {
      out.push(
        anomaly({
          key: `${b.id}:ci`,
          rule: "renvoi-ci-dessus",
          category: "redaction",
          severity: "mineure",
          title: `« ${m[0]} » alors que l'élément est au-dessus`,
          detail: "Le texte renvoie à un élément « ci-dessous », mais celui-ci est placé avant le paragraphe.",
          suggestion: `Écrire « ${m[1]} ci-dessus » (ou citer son numéro).`,
          excerpt: excerpt(b.text, m.index, m[0].length, 60),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

const captionId = (s: string) => s.match(/^(tableau|table)\s*(n°\s*)?([\dIVXLC][\w.\-–]*)/i)?.[3].replace(/[.:\-–]+$/, "").toLowerCase() ?? null;

function tableList(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const listed = new Map<string, number>();
  ctx.tocBlocks.forEach((i) => {
    const b = ctx.blocks[i];
    if (b.kind !== "paragraph") return;
    const id = captionId(b.text.trim());
    if (id) listed.set(id, i);
  });
  const captions = new Map<string, number>();
  for (const t of ctx.tables) {
    const id = t.hasCaption ? captionId(t.title) : null;
    if (id) captions.set(id, t.index);
  }
  // Légendes numérotées simplement (Tableau 1, 2, 3…) : trous et doublons.
  const simple = ctx.tables
    .map((t) => (t.hasCaption ? t.title.match(/^tableau\s*(n°\s*)?(\d+)\b(?![.\-–]\d)/i) : null))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseInt(m[2], 10));
  if (simple.length >= 3) {
    const issues: string[] = [];
    const seenNums = new Set<number>();
    simple.forEach((n, k) => {
      if (seenNums.has(n)) issues.push(`Tableau ${n} utilisé deux fois`);
      else if (k > 0 && n > simple[k - 1] + 1) {
        const from = simple[k - 1] + 1;
        issues.push(n - 1 > from ? `Tableaux ${from} à ${n - 1} absents avant le Tableau ${n}` : `Tableau ${from} absent avant le Tableau ${n}`);
      }
      seenNums.add(n);
    });
    if (issues.length) {
      out.push(
        anomaly({
          key: "legendes",
          rule: "legendes-numerotation",
          category: "structure",
          severity: "mineure",
          title: "Numérotation des tableaux irrégulière",
          detail: listSome([...new Set(issues)]) + ".",
          suggestion: "Utiliser les légendes automatiques de Word (Références › Insérer une légende) pour une numérotation continue.",
          location: {},
        }),
      );
    }
  }
  if (listed.size >= 3) {
    const missing = [...listed.keys()].filter((id) => !captions.has(id));
    const unlisted = [...captions.keys()].filter((id) => !listed.has(id));
    if (missing.length) {
      out.push(
        anomaly({
          key: "liste-manquants",
          rule: "liste-tableaux",
          category: "structure",
          severity: "mineure",
          title: `Tableaux annoncés dans la liste mais introuvables (${missing.length})`,
          detail: `Entrées de la liste des tableaux sans tableau correspondant dans le corps du document : ${listSome(missing.map((m) => `Tableau ${m}`))}.`,
          suggestion: "Régénérer la liste des tableaux (clic droit › Mettre à jour les champs) après avoir vérifié les légendes.",
          location: blockLoc(ctx, listed.get(missing[0])!),
        }),
      );
    }
    if (unlisted.length) {
      out.push(
        anomaly({
          key: "liste-absents",
          rule: "liste-tableaux",
          category: "structure",
          severity: "mineure",
          title: `Tableaux absents de la liste des tableaux (${unlisted.length})`,
          detail: `Tableaux légendés dans le corps mais absents de la liste : ${listSome(unlisted.map((m) => `Tableau ${m}`))}.`,
          suggestion: "Régénérer la liste des tableaux pour qu'elle reflète le document final.",
          location: blockLoc(ctx, captions.get(unlisted[0])!),
        }),
      );
    }
  }
  // « Le Tableau 13 présente… » juste avant le Tableau 14.
  const wrongRefs: string[] = [];
  let firstWrong = -1;
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph" || ctx.captionBlocks.has(i)) return;
    const m = b.text.match(/\b(?:le|du|au)\s+tableau\s+(?:n°\s*)?(\d+)\s+(?:ci-dessous\s+)?(?:présente|presente|donne|récapitule|recapitule|montre|détaille|detaille|indique)\b/i);
    if (!m) return;
    const next = ctx.tables.find((t) => t.index > i && t.index <= i + 3 && t.hasCaption);
    const n = next?.title.match(/^tableau\s*(?:n°\s*)?(\d+)\b/i)?.[1];
    if (!next || !n || n === m[1]) return;
    wrongRefs.push(`« ${truncate(m[0], 40)} » annonce le tableau ${m[1]}, mais le tableau qui suit est le tableau ${n} (« ${truncate(next.title, 60)} »)`);
    if (firstWrong < 0) firstWrong = i;
  });
  if (wrongRefs.length) {
    out.push(
      anomaly({
        key: "renvois-tableaux",
        rule: "renvoi-mauvais-tableau",
        category: "redaction",
        severity: "mineure",
        title: `Renvoi au mauvais numéro de tableau (${wrongRefs.length})`,
        detail: listSome(wrongRefs, 4) + ".",
        suggestion: "Corriger le numéro cité, ou mieux : insérer un renvoi automatique Word (Références › Renvoi) vers la légende du tableau.",
        location: blockLoc(ctx, firstWrong),
      }),
    );
  }

  // Légende saisie deux fois dans le même paragraphe.
  ctx.blocks.forEach((b, i) => {
    if (b.kind !== "paragraph") return;
    const m = b.text.match(/\b(Figure|Tableau|Graphique)\s+(\d+)\b/g);
    if (m && m.length >= 2 && new Set(m).size < m.length && CAPTION_RE.test(b.text.replace(/^figure|^graphique/i, "Tableau"))) {
      out.push(
        anomaly({
          key: `${b.id}:legende`,
          rule: "legende-dupliquee",
          category: "redaction",
          severity: "mineure",
          title: "Légende répétée",
          detail: `La légende « ${m[0]} » apparaît deux fois dans le même paragraphe.`,
          suggestion: "Supprimer la répétition.",
          excerpt: truncate(b.text, 140),
          location: blockLoc(ctx, i),
        }),
      );
    }
  });
  return out;
}

const ISSUER_RE =
  /(^|[^\p{L}])(minist[eè]re|direction|bureau|service|cellule|inspection|universit[eé]|institut|coordination|unit[eé] de gestion|secr[ée]tariat|cabinet|commission|comit[eé]|agence|office|programme)(?![\p{L}])/iu;
const SIGNATURE_RE = /^(le|la)\s+(directeur|directrice|ministre|chef|coordonnat|secr[ée]taire|pr[ée]sident|recteur|inspecteur|responsable)/i;

function dateAndIssuer(ctx: DocContext): Anomaly[] {
  const profile = profileOf(ctx.kind);
  const out: Anomaly[] = [];
  const texts = (from: number, to: number) =>
    ctx.blocks
      .slice(from, to)
      .map((b) => (b.kind === "heading" || b.kind === "paragraph" ? b.text : b.kind === "table" ? b.rows.slice(0, 3).flat().join(" ") : ""))
      .join(" \n ");
  const head = texts(0, 25);
  const tail = texts(Math.max(0, ctx.blocks.length - 12), ctx.blocks.length);
  if (profile.requiresDate && !hasDate(head) && !hasDate(tail)) {
    out.push(
      anomaly({
        key: "date",
        rule: "document-non-date",
        category: "completude",
        severity: "majeure",
        title: "Document non daté",
        detail: "Aucune date (mois et année, ou date complète) n'a été trouvée en page de garde ni à la signature.",
        suggestion: "Indiquer la date d'établissement du document (et la période couverte pour un rapport) en page de garde.",
        location: {},
      }),
    );
  }
  if (profile.requiresIssuer && !ISSUER_RE.test(head) && !ctx.blocks.slice(-12).some((b) => b.kind === "paragraph" && SIGNATURE_RE.test(b.text.trim())) && !/\b[A-Z]{3,}\b/.test(head.slice(0, 400))) {
    out.push(
      anomaly({
        key: "emetteur",
        rule: "emetteur-absent",
        category: "completude",
        severity: "mineure",
        title: "Structure émettrice non identifiée",
        detail: "Ni la structure qui produit le document ni un signataire n'ont été trouvés.",
        suggestion: "Indiquer en en-tête le ministère et la direction émettrice, et faire figurer le signataire (nom, fonction).",
        location: {},
      }),
    );
  }
  return out;
}

export function structureRules(ctx: DocContext): Anomaly[] {
  if (ctx.doc.format === "sheet") return [];
  return [
    ...requiredSections(ctx),
    ...numbering(ctx),
    ...emptyAndSketchySections(ctx),
    ...annexes(ctx),
    ...aboveBelow(ctx),
    ...tableList(ctx),
    ...dateAndIssuer(ctx),
  ];
}
