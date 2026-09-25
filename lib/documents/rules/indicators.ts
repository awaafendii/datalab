import type { Anomaly, DepartmentMatch, IndicatorRecord } from "../types";
import type { DocContext, TableInfo } from "../structure";
import { DECREASING_INDICATOR, DEPARTMENTS, FUNDING_SOURCES, indicatorType, SIGLES } from "../referentiel";
import { parseNumber } from "../numbers";
import { excerpt, fmt, monthsIn, norm, plural, truncate, yearsIn } from "../text";
import { anomaly, blockLoc, listSome, tableLoc } from "./util";

// Indicateurs et gestion axée sur les résultats, pour toutes les directions :
// matrices de suivi (CAP, PTA, plans d'action), indicateurs cités dans les
// rapports, résultats non chiffrés, recommandations non actionnables.

type Role =
  | "quarter"
  | "rate"
  | "verification"
  | "funding"
  | "reference"
  | "target"
  | "owner"
  | "participants"
  | "period"
  | "achieved"
  | "results"
  | "objective"
  | "budget"
  | "indicator"
  | "activity";

const ROLE_PATTERNS: [Role, RegExp][] = [
  ["quarter", /^(t[1-4]|q[1-4]|trim(estre)?\.?\s*[1-4]|[1-4](er|e|eme|ème)?\s*trim)/],
  ["rate", /taux (de )?(realisation|execution|d.atteinte)|% (de )?realisation|niveau (de )?realisation|ecart/],
  ["verification", /source(s)? de verification|moyens? de verification|justificatifs?|preuves?/],
  ["funding", /source(s)? de financement|financement|bailleurs?/],
  ["reference", /reference|situation de (base|depart)|baseline|valeur (initiale|de base)|^base$/],
  ["target", /cibles?|valeur cible|previsions?|prevue?s?|objectif chiffre|target/],
  ["owner", /responsab|porteurs?|structures? (responsable|chargee)|acteurs?|executant/],
  ["participants", /participants?|beneficiaires?/],
  ["period", /periode|echeance|delai|calendrier|chronogramme|date/],
  ["achieved", /realise|realisation|atteinte?|valeur (actuelle|obtenue)|obtenue?|execute/],
  ["results", /resultats?|observations?|commentaires?/],
  ["objective", /objectifs?/],
  ["budget", /couts?|budget|montants?/],
  ["indicator", /indicateurs?|libelle/],
  ["activity", /activites?|actions?|taches?|interventions?/],
];

function roleOf(header: string): Role | null {
  const parts = header.split(" > ").map(norm);
  const last = parts[parts.length - 1];
  for (const [role, re] of ROLE_PATTERNS) if (re.test(last)) return role;
  const full = parts.join(" ");
  for (const [role, re] of ROLE_PATTERNS) if (role !== "indicator" && re.test(full)) return role;
  return parts.some((p) => /indicateurs?/.test(p)) ? "indicator" : null;
}

function mark(v: string): boolean {
  return /^(x|✓|✔|oui|1|•|v)$/i.test(v.trim());
}

const QUALITATIVE_RESULT =
  /succes|realise|effectue|organise|tenue?|en cours|fait|ok|termine|satisfaisant|bon deroulement|conforme|acheve|execute/;

function departmentFor(owner: string | undefined, fallback: DepartmentMatch[]): string | undefined {
  if (owner) {
    const up = owner.toUpperCase();
    const fam = DEPARTMENTS.find((d) => d.sigles.some((s) => new RegExp(`(^|[^A-Z])${s.replace(/[-/]/g, "\\$&")}([^A-Z]|$)`).test(up)));
    if (fam) return `${owner} (${fam.label})`;
    return owner;
  }
  return fallback[0]?.label;
}

function suggestionsFor(label: string, departments: DepartmentMatch[]): string {
  const t = norm(label);
  const fam =
    DEPARTMENTS.find((d) => d.keywords.some((re) => re.test(t))) ??
    DEPARTMENTS.find((d) => d.id === departments[0]?.id);
  return fam ? ` Exemples pour « ${fam.label} » : ${fam.indicators.slice(0, 3).join(" ; ")}.` : "";
}

// Lignes de structure d'un cadre de performance (« PROGRAMME N° 001 »,
// « OBJECTIF STRATEGIQUE : … », « Indicateur 1 : … » de niveau programme,
// en-têtes d'action « 0011 – … | Objectif spécifique : … ») : ce ne sont pas
// des lignes d'indicateur à contrôler une à une.
const STRUCTURE_ROW = /^(programme\b|sous-programme\b|objectif|axe\b|resultat strategique|effet\b)/;
const ACTION_CODE = /^(\d{3,5})\s*[-–—]\s*(.+)$/;

// « Indicateur 2 : Taux d'exécution… » → « Taux d'exécution… ».
export function cleanIndicatorLabel(label: string): string {
  return label.replace(/^\s*indicateur\s*\d*\s*[:.-]\s*/i, "").replace(/[.;]\s*$/, "").trim();
}

export interface IndicatorSeries {
  table: string;
  label: string;
  values: string;
  owner: string;
}

function matrixRules(
  ctx: DocContext,
  t: TableInfo,
  departments: DepartmentMatch[],
  records: IndicatorRecord[],
  series: IndicatorSeries[],
  seenRows: Set<string>,
  seenStrategic: Set<string>,
): Anomaly[] {
  const roles = new Map<Role, number>();
  // Cadres de performance pluriannuels : une colonne de cible par année.
  let targetCols: number[] = [];
  const quarters: { col: number; q: number; year: number | null }[] = [];
  t.header.forEach((h, c) => {
    const role = roleOf(h);
    if (!role) return;
    if (role === "quarter") {
      const q = parseInt(norm(h.split(" > ").pop()!).match(/[1-4]/)?.[0] ?? "0", 10);
      const y = yearsIn(h)[0] ?? null;
      quarters.push({ col: c, q, year: y });
      return;
    }
    if (role === "target") targetCols.push(c);
    if (!roles.has(role)) roles.set(role, c);
  });
  const ind = roles.get("indicator");
  // Cadre de performance « à la CDMT » : années en colonnes (N-1 = référence,
  // N à N+2 = cibles), sans colonnes « référence » ni « cible » nommées.
  const years = t.yearCols.filter((y) => !y.relative).sort((a, b) => a.year - b.year);
  const yearMode = ind !== undefined && !roles.has("reference") && !roles.has("target") && years.length >= 2;
  if (yearMode) {
    roles.set("reference", years[0].col);
    targetCols = years.slice(1).map((y) => y.col);
    roles.set("target", targetCols[0]);
  }
  if (ind === undefined || !(roles.has("target") || roles.has("reference") || roles.has("activity"))) return [];
  // Un document de programmation (CDMT, stratégie) fixe des cibles : le
  // réalisé relève du rapport annuel de performance.
  const planning = yearMode || ctx.kind === "cdmt" || ctx.kind === "strategie";

  const out: Anomaly[] = [];
  const col = (r: Role) => roles.get(r);
  const cell = (row: string[], r: Role) => {
    const c = col(r);
    return c === undefined ? "" : row[c] ?? "";
  };

  // Colonnes indispensables au suivi de la performance.
  const missing: string[] = [];
  let severe = false;
  if (!roles.has("reference")) {
    missing.push("valeur de référence");
    severe = true;
  }
  if (!roles.has("target")) {
    missing.push("cible");
    severe = true;
  }
  if (!planning && !roles.has("achieved") && !roles.has("rate")) {
    missing.push("valeur réalisée / taux de réalisation");
    severe = true;
  }
  if (!planning && !roles.has("verification")) missing.push("source de vérification");
  if (!roles.has("owner")) missing.push("responsable");
  if (missing.length) {
    out.push(
      anomaly({
        key: `${t.block.id}:colonnes`,
        rule: "matrice-colonnes",
        category: "indicateurs",
        severity: severe ? "majeure" : "mineure",
        title: `Matrice d'indicateurs incomplète : ${missing.join(", ")}`,
        detail: `La matrice « ${t.title} » n'a pas de colonne ${missing.map((m) => `« ${m} »`).join(", ")}.${severe ? " Sans valeur réalisée confrontée à la cible, la performance ne peut pas être mesurée." : ""}`,
        suggestion:
          "Ajouter les colonnes manquantes au modèle commun à toutes les directions : Indicateur | Référence (année) | Cible | Réalisé | Taux de réalisation (%) | Source de vérification | Responsable.",
        location: tableLoc(ctx, t),
      }),
    );
  }

  const noIndicator: string[] = [];
  const noReference: string[] = [];
  const ndReference: string[] = [];
  const noTarget: string[] = [];
  const noVerification: string[] = [];
  const noAchieved: string[] = [];
  const vague: string[] = [];
  const qualitative: string[] = [];
  const outOfRange: string[] = [];
  const weakTarget: string[] = [];
  const zeroRef: string[] = [];
  const rateIssues: string[] = [];
  const periodIssues: string[] = [];
  const unknownFunding: string[] = [];
  const ruptures: string[] = [];
  const numbering: string[] = [];
  const seenActivities = new Map<string, number>();
  const dupActivities: string[] = [];
  // Indicateurs stratégiques (niveau programme) et indicateurs chiffrés du tableau.
  const strategic: { label: string; row: number }[] = [];
  const valued = new Set<string>();
  let action = "";
  const numbersInAction = new Map<string, number>();
  const targetValues = new Map<string, { label: string; value: string }[]>();
  const yearOf = (c: number) => yearsIn(t.header[c])[0] ?? "";

  t.body.forEach((row, r) => {
    if (t.totalRows.includes(r)) return;
    const rawLabel = cell(row, "indicator");
    const activity = cell(row, "activity").replace(/^[•\-–]\s*/, "");
    const firstRaw = row.find((c) => c !== "") ?? "";
    const first = norm(firstRaw);
    // Lignes de structure : programme, objectif stratégique, indicateur de
    // programme (contrôlé plus bas), en-tête d'action.
    if (STRUCTURE_ROW.test(first)) return;
    if (/^indicateur\s*\d*\s*:/.test(first) && !rawLabel) {
      strategic.push({ label: cleanIndicatorLabel(firstRaw), row: r });
      return;
    }
    const code = activity.match(ACTION_CODE);
    if (code && (!rawLabel || /^objectif/i.test(rawLabel))) {
      action = code[1];
      return;
    }
    if (!rawLabel && !activity) return;
    const label = cleanIndicatorLabel(rawLabel);
    const where = truncate(activity || label, 50);
    if (activity && !yearMode) {
      const k = norm(activity);
      if (seenActivities.has(k)) dupActivities.push(where);
      else seenActivities.set(k, r);
    }
    if (!label) {
      noIndicator.push(where);
      return;
    }
    // Numérotation « Indicateur n » au sein d'une même action.
    const num = rawLabel.match(/^\s*indicateur\s*(\d+)/i)?.[1];
    if (num) {
      const key = `${action}|${num}`;
      numbersInAction.set(key, (numbersInAction.get(key) ?? 0) + 1);
      if (numbersInAction.get(key) === 2 && !seenStrategic.has(`num:${key}`)) {
        seenStrategic.add(`num:${key}`);
        numbering.push(`${action ? `action ${action}` : "tableau"} : « Indicateur ${num} » utilisé deux fois`);
      }
    }
    const type = indicatorType(label);
    const refRaw = cell(row, "reference");
    const tgtRaw = cell(row, "target");
    const achRaw = cell(row, "achieved");
    const rateRaw = cell(row, "rate");
    const ref = parseNumber(refRaw);
    const tgt = parseNumber(tgtRaw);
    const ach = parseNumber(achRaw);
    const owner = cell(row, "owner");
    const refCol = roles.get("reference");
    const values = [...(refCol !== undefined ? [refCol] : []), ...targetCols].map((c) => row[c] ?? "").join(" | ");
    series.push({ table: t.title, label, values, owner });
    if ([refRaw, ...targetCols.map((c) => row[c])].some((v) => v && parseNumber(v))) valued.add(norm(label));
    // Ligne déjà contrôlée dans un tableau précédent (le CDMT reprend les mêmes
    // indicateurs dans la synthèse, le tableau du programme et l'annexe).
    const signature = `${norm(label)}|${values.replace(/\s/g, "")}`;
    if (seenRows.has(signature)) return;
    seenRows.add(signature);
    records.push({
      source: t.title,
      department: departmentFor(owner || t.block.sheet, departments),
      activity: activity || undefined,
      label,
      type,
      reference: refRaw || undefined,
      target: yearMode ? targetCols.map((c) => `${yearOf(c)} : ${row[c] || "—"}`).join(" · ") : tgtRaw || undefined,
      achieved: achRaw || undefined,
      rate: rateRaw || undefined,
      funding: cell(row, "funding") || undefined,
      owner: owner || undefined,
      verification: cell(row, "verification") || undefined,
      period: [quarters.filter((q) => mark(row[q.col])).map((q) => `T${q.q}`).join("+"), cell(row, "period")].filter(Boolean).join(" · ") || undefined,
    });

    if (roles.has("reference") && !refRaw) noReference.push(where);
    else if (/^(nd|n\/d|nc|n\/a)$/i.test(refRaw.trim())) ndReference.push(where);
    if (roles.has("target") && !targetCols.some((c) => row[c])) noTarget.push(where);
    if (roles.has("verification") && !cell(row, "verification")) noVerification.push(where);
    if (roles.has("achieved") && !achRaw && tgtRaw) noAchieved.push(where);
    if (type === "non-type" && !/frequence|redaction|dans les delais/.test(norm(label))) vague.push(`« ${truncate(label, 60)} »`);

    const checks: [string, ReturnType<typeof parseNumber>][] = [
      ["référence", ref],
      ...targetCols.map((c): [string, ReturnType<typeof parseNumber>] => [
        targetCols.length > 1 ? `cible ${yearOf(c)}`.trim() : "cible",
        parseNumber(row[c]),
      ]),
      ["réalisé", ach],
    ];
    for (const [name, v] of checks) {
      if (!v) continue;
      if (v.value < 0) outOfRange.push(`${where} : ${name} négative (${fmt(v.value)})`);
      else if (type === "pourcentage" && v.value > 100 && !/croissance|evolution|variation|progression/.test(norm(label)))
        outOfRange.push(`${where} : ${name} de ${fmt(v.value)} % pour un taux`);
      else if (type === "nombre" && !Number.isInteger(v.value)) outOfRange.push(`${where} : ${name} non entière (${fmt(v.value)}) pour un nombre`);
    }
    // Trajectoire des cibles : rupture brutale d'une année à l'autre.
    const trajectory = [...(refCol !== undefined ? [refCol] : []), ...targetCols];
    for (let k = 1; k < trajectory.length; k++) {
      const a = parseNumber(row[trajectory[k - 1]]);
      const b = parseNumber(row[trajectory[k]]);
      if (!a || !b || a.value <= 0) continue;
      const pct = a.percent || b.percent || type === "pourcentage";
      if (pct ? b.value - a.value >= 25 : b.value / a.value >= 3) {
        const unit = pct ? " %" : "";
        ruptures.push(`${where} : ${fmt(a.value)}${unit} en ${yearOf(trajectory[k - 1])} → ${fmt(b.value)}${unit} en ${yearOf(trajectory[k])}`);
      }
    }
    for (const c of targetCols) {
      const v = row[c];
      if (!v || !parseNumber(v)) continue;
      const key = `${c}|${v.replace(/\s/g, "")}`;
      const list = targetValues.get(key) ?? [];
      list.push({ label, value: v });
      targetValues.set(key, list);
    }
    if (ref && tgt && tgt.value <= ref.value && !DECREASING_INDICATOR.test(norm(label))) {
      weakTarget.push(`${where} : cible ${fmt(tgt.value)} ≤ référence ${fmt(ref.value)}`);
    }
    if (ref && ref.value === 0 && /\b(\d+)\s*(e|eme|ème|ieme|ième)\s+edition|\b\d+(e|ème)\s+édition|renouvel|reconduction|annuel/i.test(activity)) {
      zeroRef.push(`${where} (référence 0)`);
    }
    if (ach && tgt && tgt.value !== 0) {
      const expected = (ach.value / tgt.value) * 100;
      const rate = parseNumber(rateRaw);
      if (rate && Math.abs(rate.value - expected) > Math.max(0.6, 0.5 * Math.pow(10, -rate.decimals) + 0.05)) {
        rateIssues.push(`${where} : ${fmt(rate.value)} % indiqué, ${fmt(expected, 1)} % calculé (${fmt(ach.value)}/${fmt(tgt.value)})`);
      }
    }
    const results = cell(row, "results");
    if (results && !/\d/.test(results) && QUALITATIVE_RESULT.test(norm(results))) {
      qualitative.push(`${where} : « ${truncate(results, 40)} »`);
    }
    // Trimestres cochés ↔ dates de réalisation.
    const checked = quarters.filter((q) => mark(row[q.col]));
    const dateText = cell(row, "period");
    if (dateText) {
      const months = monthsIn(dateText);
      const qs = new Set(months.map((m) => Math.ceil(m / 3)));
      if (checked.length && qs.size && !checked.some((q) => qs.has(q.q))) {
        periodIssues.push(`${where} : trimestre coché ${checked.map((q) => `T${q.q}`).join("+")} mais réalisation « ${truncate(dateText, 40)} » (T${[...qs].join("+T")})`);
      }
      const yrs = yearsIn(dateText);
      const planYear = quarters.find((q) => q.year !== null)?.year ?? null;
      if (planYear && yrs.length && !yrs.includes(planYear)) {
        periodIssues.push(`${where} : réalisation datée de ${yrs.join(", ")} dans une matrice ${planYear}`);
      }
    } else if (quarters.length && !checked.length) {
      periodIssues.push(`${where} : aucune période renseignée`);
    }
    const funding = cell(row, "funding");
    if (funding && !FUNDING_SOURCES.some((f) => f.pattern.test(norm(funding))) && !SIGLES.some((s) => s.sigle === funding.trim())) {
      unknownFunding.push(`${where} : « ${truncate(funding, 30)} »`);
    }
  });

  // Une même cible (valeur non ronde) pour deux indicateurs différents : copier-coller probable.
  const copies: string[] = [];
  for (const list of targetValues.values()) {
    const labels = [...new Set(list.map((x) => norm(x.label)))];
    if (labels.length < 2 || !/[,.]\d*[1-9]/.test(list[0].value)) continue;
    const other = list.find((x) => norm(x.label) !== norm(list[0].label))!;
    copies.push(`${list[0].value} pour « ${truncate(list[0].label, 45)} » et « ${truncate(other.label, 45)} »`);
  }
  // Indicateurs stratégiques du programme repris nulle part avec des valeurs.
  const orphan = strategic.filter((s) => {
    if (seenStrategic.has(norm(s.label))) return false;
    seenStrategic.add(norm(s.label));
    return ![...valued].some((v) => sameIndicator(v, norm(s.label)));
  });

  const push = (key: string, rule: string, severity: Anomaly["severity"], title: string, detail: string, suggestion: string) =>
    out.push(anomaly({ key: `${t.block.id}:${key}`, rule, category: "indicateurs", severity, title, detail, suggestion, location: tableLoc(ctx, t) }));

  if (noIndicator.length)
    push("sans-indicateur", "activite-sans-indicateur", "majeure", `Activités sans indicateur (${noIndicator.length})`, listSome(noIndicator) + ".", "Associer à chaque activité au moins un indicateur mesurable, avec sa référence et sa cible.");
  if (orphan.length)
    push(
      "strategiques",
      "indicateur-strategique-sans-valeur",
      "majeure",
      `Indicateurs de programme sans valeurs (${orphan.length})`,
      `Indicateurs affichés au niveau du programme mais repris nulle part avec leur référence et leurs cibles : ${listSome(orphan.map((o) => `« ${truncate(o.label, 70)} »`), 4)}.`,
      "Donner à chaque indicateur de programme (objectif stratégique) sa valeur de référence et ses cibles annuelles, ou le rattacher explicitement à un indicateur d'action chiffré.",
    );
  if (noReference.length)
    push("sans-reference", "indicateur-sans-reference", "mineure", `Indicateurs sans valeur de référence (${noReference.length})`, listSome(noReference) + ".", "Renseigner la valeur de départ (situation de l'année précédente) ; à défaut, indiquer « nouvelle activité ».");
  if (ndReference.length)
    push(
      "reference-nd",
      "reference-non-disponible",
      "mineure",
      `Valeurs de référence « ND » (${ndReference.length})`,
      `Indicateurs dont la situation de départ n'est pas disponible : ${listSome(ndReference, 5)}.`,
      "Établir la valeur de référence (enquête, extraction de la base de données, rapport de l'année précédente) : sans elle, la progression vers la cible ne pourra pas être démontrée dans le rapport annuel de performance.",
    );
  if (noTarget.length)
    push("sans-cible", "indicateur-sans-cible", "majeure", `Indicateurs sans cible (${noTarget.length})`, listSome(noTarget) + ".", "Fixer une cible chiffrée et datée pour chaque indicateur (par ex. « 46 IES en 2025 »).");
  if (noAchieved.length)
    push("sans-realise", "realisation-non-renseignee", "info", `Réalisations non renseignées (${noAchieved.length})`, listSome(noAchieved) + ".", "Renseigner la valeur atteinte à chaque revue (trimestrielle ou annuelle), ou indiquer « non démarré » avec la raison.");
  if (noVerification.length)
    push("sans-verif", "indicateur-sans-verification", "mineure", `Indicateurs sans source de vérification (${noVerification.length})`, listSome(noVerification) + ".", "Préciser le document qui prouve la valeur (rapport, PV, liste de présence, base de données).");
  if (vague.length)
    push(
      "vague",
      "indicateur-non-mesurable",
      "mineure",
      `Indicateurs mal formulés (${vague.length})`,
      `Libellés qui ne disent pas ce qui est mesuré (nombre, taux, montant, délai…) : ${listSome(vague, 5)}.`,
      "Reformuler en indicateur mesurable commençant par « Nombre de… », « Taux de… », « Montant de… » ou « Délai de… »." + suggestionsFor(vague[0], departments),
    );
  if (outOfRange.length)
    push("bornes", "indicateur-valeur-impossible", "majeure", `Valeurs d'indicateur impossibles (${outOfRange.length})`, listSome(outOfRange) + ".", "Corriger la valeur ou le libellé de l'indicateur (un taux ne dépasse pas 100 %, un nombre est entier et positif).");
  if (copies.length)
    push(
      "copie",
      "cible-recopiee",
      "majeure",
      `Cible recopiée d'un autre indicateur (${copies.length})`,
      `Même valeur pour deux indicateurs différents : ${listSome(copies, 3)}.`,
      "Vérifier la saisie : la valeur a vraisemblablement été copiée depuis la ligne voisine. Reprendre la cible réelle de l'indicateur.",
    );
  if (ruptures.length)
    push(
      "rupture",
      "cible-en-rupture",
      "mineure",
      `Cibles en forte hausse d'une année sur l'autre (${ruptures.length})`,
      `Sauts importants : ${listSome(ruptures, 4)}.`,
      "Justifier la progression attendue (investissement, réforme, nouveau dispositif) dans le texte du programme, ou lisser la trajectoire des cibles.",
    );
  if (weakTarget.length)
    push(
      "cible-faible",
      "cible-inferieure-reference",
      "mineure",
      `Cibles inférieures ou égales à la référence (${weakTarget.length})`,
      listSome(weakTarget) + ".",
      "Vérifier le sens de l'indicateur : une cible doit marquer une progression (sauf indicateur à faire baisser : délais, abandons…) ; pour un flux annuel (nouveaux programmes, labos équipés), expliquer la baisse.",
    );
  if (numbering.length)
    push("numerotation", "indicateurs-numerotation", "mineure", `Numérotation des indicateurs (${numbering.length})`, listSome(numbering) + ".", "Renuméroter les indicateurs de l'action (1, 2, 3…).");
  if (zeroRef.length)
    push("ref-zero", "reference-nulle", "info", `Référence nulle pour une activité récurrente (${zeroRef.length})`, listSome(zeroRef) + ".", "Pour une activité reconduite (nième édition), reprendre comme référence la valeur réalisée lors de l'édition précédente.");
  if (rateIssues.length)
    push("taux", "taux-realisation", "majeure", `Taux de réalisation faux (${rateIssues.length})`, listSome(rateIssues) + ".", "Recalculer : taux de réalisation = réalisé ÷ cible × 100.");
  if (qualitative.length)
    push("qualitatif", "resultat-non-mesure", "mineure", `Résultats non mesurés (${qualitative.length})`, listSome(qualitative) + ".", "Exprimer le résultat avec la valeur atteinte de l'indicateur (par ex. « 38 IES sur 46 ciblées, soit 83 % »), puis l'écart à la cible.");
  if (periodIssues.length)
    push("periode", "periode-incoherente", "majeure", `Périodes incohérentes (${periodIssues.length})`, listSome(periodIssues) + ".", "Aligner le trimestre coché, la date de réalisation et l'année de la matrice.");
  if (unknownFunding.length)
    push("financement", "source-financement-inconnue", "info", `Sources de financement non standard (${unknownFunding.length})`, listSome(unknownFunding) + ".", "Utiliser les libellés harmonisés de la loi de finances : BND (ressources propres), contrepartie nationale, FINEX/PTF (ressources extérieures), BAS (FCE, FNDL, FIM, FODECCON), mixte.");
  if (dupActivities.length)
    push("doublons", "activite-dupliquee", "mineure", `Activités en double (${dupActivities.length})`, listSome(dupActivities) + ".", "Fusionner les lignes identiques ou préciser ce qui les distingue.");
  return out;
}

// Deux libellés d'indicateur désignent-ils la même mesure ?
function sameIndicator(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = new Set(a.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const wb = b.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  if (!wa.size || !wb.length) return false;
  const inter = wb.filter((w) => wa.has(w)).length;
  return inter / Math.max(wa.size, wb.length) >= 0.8;
}

// Un même indicateur repris dans plusieurs tableaux (synthèse, tableau du
// programme, annexe) doit avoir partout les mêmes valeurs.
function indicatorConsistency(series: IndicatorSeries[]): Anomaly[] {
  const byLabel = new Map<string, IndicatorSeries[]>();
  for (const s of series) {
    const k = norm(s.label);
    const list = byLabel.get(k) ?? [];
    list.push(s);
    byLabel.set(k, list);
  }
  const issues: string[] = [];
  for (const list of byLabel.values()) {
    const distinct = new Map<string, IndicatorSeries>();
    for (const s of list) {
      const k = s.values.replace(/\s/g, "");
      if (!distinct.has(k)) distinct.set(k, s);
    }
    if (distinct.size > 1) {
      issues.push(`« ${truncate(list[0].label, 60)} » : ${[...distinct.values()].slice(0, 3).map((s) => `${s.values} (${truncate(s.table, 40)})`).join(" / ")}`);
    }
  }
  if (!issues.length) return [];
  return [
    anomaly({
      key: "indicateurs-divergents",
      rule: "indicateur-valeurs-divergentes",
      category: "indicateurs",
      severity: "majeure",
      title: `Indicateurs aux valeurs différentes d'un tableau à l'autre (${issues.length})`,
      detail: listSome(issues, 4) + ".",
      suggestion:
        "Arrêter une seule série de valeurs (référence et cibles) par indicateur et la reporter à l'identique dans le tableau de synthèse, le tableau du programme et l'annexe.",
      location: {},
    }),
  ];
}

// Indicateurs cités dans le texte (section « Indicateurs de performance »).
function textIndicators(ctx: DocContext, departments: DepartmentMatch[], records: IndicatorRecord[]): Anomaly[] {
  const out: Anomaly[] = [];
  ctx.headings.forEach((h, k) => {
    if (!/indicateur|performance/.test(norm(h.block.text))) return;
    const end = ctx.headings[k + 1]?.index ?? ctx.blocks.length;
    // Indicateurs présentés en tableau : c'est la règle des matrices qui s'applique.
    if (ctx.blocks.slice(h.index + 1, end).some((b) => b.kind === "table")) return;
    const items = ctx.blocks
      .slice(h.index + 1, end)
      .map((b, off) => ({ b, i: h.index + 1 + off }))
      .filter((x) => x.b.kind === "paragraph" && !ctx.captionBlocks.has(x.i) && /:/.test((x.b as { text: string }).text));
    if (!items.length) return;
    const sectionText = norm(items.map((x) => (x.b as { text: string }).text).join(" "));
    const impossible: string[] = [];
    for (const { b } of items) {
      const text = (b as { text: string }).text;
      const [labelRaw, ...rest] = text.split(":");
      const value = rest.join(":").trim().replace(/[;.]$/, "");
      const label = labelRaw.replace(/^[•\-–]\s*/, "").trim();
      const type = indicatorType(label);
      records.push({ source: truncate(h.block.text, 60), department: departments[0]?.label, label, type, achieved: value || undefined });
      const n = parseNumber(value.replace(/\s*%.*$/, " %").trim());
      if (n && type === "pourcentage" && n.value > 100) impossible.push(`${label} : ${value}`);
    }
    if (!/cible|objectif|prevu|reference|baseline|initial|attendu/.test(sectionText)) {
      out.push(
        anomaly({
          key: `${h.block.id}:indicateurs`,
          rule: "indicateurs-sans-cible",
          category: "indicateurs",
          severity: "majeure",
          title: "Indicateurs sans référence ni cible",
          detail: `La section « ${truncate(h.block.text, 60)} » donne ${plural(items.length, "indicateur")} sans valeur de référence ni cible : impossible de dire si la performance est bonne.`,
          suggestion:
            "Présenter les indicateurs en tableau : Indicateur | Référence (année N-1) | Cible (année N) | Réalisé | Taux de réalisation | Source de vérification.",
          excerpt: truncate((items[0].b as { text: string }).text, 140),
          location: blockLoc(ctx, h.index),
        }),
      );
    }
    if (impossible.length) {
      out.push(
        anomaly({
          key: `${h.block.id}:impossible`,
          rule: "indicateur-valeur-impossible",
          category: "indicateurs",
          severity: "majeure",
          title: "Taux supérieur à 100 %",
          detail: listSome(impossible) + ".",
          suggestion: "Vérifier le calcul du taux (numérateur ÷ dénominateur × 100).",
          location: blockLoc(ctx, h.index),
        }),
      );
    }
  });
  return out;
}

const MEASURE_WORD = /\b(taux|nombre|pourcentage|proportion|effectifs?|montant|niveau|ratio|volume)\b/;
const VAGUE_WORD =
  /significati|notable|considerable|largement|majorite|nettement|sensiblement|satisfaisant|avec succes|globalement|amelioration|progression|renforce|meilleure|bien maitrise/;

function vagueResults(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  ctx.headings.forEach((h, k) => {
    if (!/resultat|\bacquis\b|bilan des|realisations|performance/.test(norm(h.block.text)) || /attendu/.test(norm(h.block.text))) return;
    const end = ctx.headings[k + 1]?.index ?? ctx.blocks.length;
    const measured: string[] = [];
    const vague: string[] = [];
    for (let i = h.index + 1; i < end; i++) {
      const b = ctx.blocks[i];
      if (b.kind !== "paragraph" || /\d/.test(b.text)) continue;
      const t = norm(b.text);
      if (MEASURE_WORD.test(t)) measured.push(truncate(b.text, 90));
      else if (VAGUE_WORD.test(t)) vague.push(truncate(b.text, 90));
    }
    if (measured.length) {
      out.push(
        anomaly({
          key: `${h.block.id}:mesure`,
          rule: "resultat-sans-valeur",
          category: "indicateurs",
          severity: "majeure",
          title: `Résultats cités sans valeur (${measured.length})`,
          detail: `Des résultats évoquent un taux, un nombre ou un montant sans le chiffrer : ${listSome(measured.map((m) => `« ${m} »`), 3)}.`,
          suggestion: "Donner la valeur et sa comparaison (par ex. « le taux de décaissement est passé de 45 % en 2023 à 70 % en 2024, pour une cible de 75 % »).",
          location: blockLoc(ctx, h.index),
        }),
      );
    }
    if (vague.length) {
      out.push(
        anomaly({
          key: `${h.block.id}:vague`,
          rule: "resultat-vague",
          category: "indicateurs",
          severity: "mineure",
          title: `Résultats non chiffrés (${vague.length})`,
          detail: `Formulations qualitatives invérifiables : ${listSome(vague.map((m) => `« ${m} »`), 3)}.`,
          suggestion: "Étayer chaque résultat par un chiffre, une source ou un livrable vérifiable.",
          location: blockLoc(ctx, h.index),
        }),
      );
    }
  });
  return out;
}

const RESPONSIBLE_RE =
  /minist|direction|cabinet|service|cellule|\bdg\b|drh|daf|bsd|cpmp|responsable|comite|commission|ies\b|universit|institut|recteur|chef|coordination|secretariat|partenaires?|ptf|equipe|structure/;
const DEADLINE_RE =
  /\b(19|20)\d{2}\b|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|trimestre|semestre|d.ici|delai|immediat|urgence|court terme|moyen terme|long terme|echeance|avant (le|la|fin)|mois|semaines?|jours?/;
const COST_RE = /cout|gnf|usd|€|\$|fcfa|montant|budget|estimation|devis|financement/;

function recommendations(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  ctx.headings.forEach((h, k) => {
    if (!/recommandation/.test(norm(h.block.text))) return;
    const end = ctx.headings[k + 1]?.index ?? ctx.blocks.length;
    const items: string[] = [];
    let hasTable = false;
    for (let i = h.index + 1; i < end; i++) {
      const b = ctx.blocks[i];
      if (b.kind === "paragraph") items.push(b.text);
      if (b.kind === "table") hasTable = true;
    }
    if (items.length < 2 || hasTable) return;
    const text = norm(items.join(" "));
    const who = RESPONSIBLE_RE.test(text);
    const when = DEADLINE_RE.test(text);
    const cost = COST_RE.test(text);
    const inspection = ctx.kind === "rapport-inspection";
    const missing = [!who && "responsable", !when && "échéance", inspection && !cost && "coût estimatif"].filter(Boolean) as string[];
    if (!missing.length) return;
    out.push(
      anomaly({
        key: `${h.block.id}:reco`,
        rule: "recommandations-non-actionnables",
        category: "indicateurs",
        severity: !who && !when ? "majeure" : "mineure",
        title: `Recommandations sans ${missing.join(", ni ")}`,
        detail: `Les ${items.length} recommandations de « ${truncate(h.block.text, 50)} » ne précisent pas ${missing.join(", ni ")} : leur mise en œuvre ne pourra pas être suivie.`,
        suggestion: `Présenter les recommandations en tableau : Recommandation | Responsable | Échéance | Priorité${inspection ? " | Coût estimatif" : ""} | Indicateur de mise en œuvre.`,
        excerpt: excerpt(items[0], 0, 0, 120),
        location: blockLoc(ctx, h.index),
      }),
    );
  });
  return out;
}

export function indicatorRules(
  ctx: DocContext,
  departments: DepartmentMatch[],
): { anomalies: Anomaly[]; indicators: IndicatorRecord[] } {
  const records: IndicatorRecord[] = [];
  const anomalies: Anomaly[] = [];
  const series: IndicatorSeries[] = [];
  const seenRows = new Set<string>();
  const seenStrategic = new Set<string>();
  for (const t of ctx.tables) if (!t.empty) anomalies.push(...matrixRules(ctx, t, departments, records, series, seenRows, seenStrategic));
  anomalies.push(...indicatorConsistency(series));
  if (ctx.doc.format !== "sheet") {
    anomalies.push(...textIndicators(ctx, departments, records), ...vagueResults(ctx), ...recommendations(ctx));
  }
  return { anomalies, indicators: records };
}
