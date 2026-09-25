import type { Anomaly } from "../types";
import type { DocContext, TableInfo } from "../structure";
import { fmt, norm, plural } from "../text";
import { anomaly, listSome, rowLabel, tableLoc } from "./util";
import { isMoneyTable } from "./tables";

// Tableaux pluriannuels (CDMT, budget-programme, programme indicatif,
// plans de financement) : variations d'une année sur l'autre, dotations qui
// tombent à zéro, montants négatifs, dépassement de plafond, totaux d'une
// même année différents d'un tableau à l'autre.

const GROWTH_LIMIT = 0.5; // ±50 % d'une année sur l'autre : à justifier

function yearLabel(t: TableInfo, k: number): string {
  const y = t.yearCols[k];
  return y.relative ? (y.year === 0 ? "N" : `N+${y.year}`) : String(y.year);
}

// `seen` évite de signaler dix fois la même ligne reprise dans plusieurs
// tableaux (un programme figure dans la synthèse, le tableau par nature,
// le plan d'actions…).
interface Jump {
  text: string;
  weight: number;
  t: TableInfo;
}

function multiYear(ctx: DocContext, t: TableInfo, budgetDoc: boolean, seen: Set<string>, allJumps: Jump[]): Anomaly[] {
  const out: Anomaly[] = [];
  const years = [...t.yearCols].sort((a, b) => a.year - b.year);
  if (years.length < 2) return out;
  t.yearCols = years;
  const drops: string[] = [];
  const negatives: string[] = [];
  const ceiling: string[] = [];
  const plafondRow = t.body.findIndex((row) => /^(plafond|enveloppe|cadrage)/.test(norm(row[t.labelCol] ?? "")));
  const totalRow = t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop();

  t.body.forEach((_, r) => {
    if (r === plafondRow) return;
    for (let k = 0; k < years.length; k++) {
      const v = t.nums[r][years[k].col];
      if (v && v.value < 0) negatives.push(`${rowLabel(t, r)} (${yearLabel(t, k)} : ${fmt(v.value)})`);
      if (k === 0) continue;
      const prev = t.nums[r][years[k - 1].col];
      if (!prev || !v || prev.value <= 0) continue;
      const sig = `${norm(rowLabel(t, r))}|${years[k].year}|${prev.value}|${v.value}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (v.value === 0) drops.push(`${rowLabel(t, r)} : ${fmt(prev.value)} en ${yearLabel(t, k - 1)} → 0 en ${yearLabel(t, k)}`);
      else {
        const g = (v.value - prev.value) / prev.value;
        // Variation significative : au-delà du seuil, et d'un montant d'au moins
        // 1 % du total de l'année (sinon, le détail d'une petite ligne).
        const yearTotal = totalRow !== undefined ? t.nums[totalRow][years[k].col]?.value ?? 0 : 0;
        if (Math.abs(g) > GROWTH_LIMIT && (!yearTotal || Math.abs(v.value - prev.value) >= 0.01 * yearTotal)) {
          allJumps.push({
            text: `${rowLabel(t, r)} : ${fmt(prev.value)} → ${fmt(v.value)} (${g > 0 ? "+" : ""}${fmt(g * 100, 0)} % entre ${yearLabel(t, k - 1)} et ${yearLabel(t, k)})`,
            weight: Math.abs(v.value - prev.value),
            t,
          });
        }
      }
    }
  });
  if (plafondRow >= 0 && totalRow !== undefined) {
    years.forEach((y, k) => {
      const cap = t.nums[plafondRow][y.col];
      const tot = t.nums[totalRow][y.col];
      if (cap && tot && tot.value > cap.value * 1.0005) {
        ceiling.push(`${yearLabel(t, k)} : total ${fmt(tot.value)} pour un plafond de ${fmt(cap.value)} (dépassement ${fmt(tot.value - cap.value)})`);
      }
    });
  }
  const loc = tableLoc(ctx, t);
  if (ceiling.length) {
    out.push(
      anomaly({
        key: `${t.block.id}:plafond`,
        rule: "depassement-plafond",
        category: "budget",
        severity: "bloquante",
        title: "Dépassement du plafond",
        detail: listSome(ceiling) + ".",
        suggestion: "Ramener les allocations dans l'enveloppe notifiée (arbitrage entre programmes ou actions) ou justifier une demande de relèvement du plafond.",
        location: loc,
      }),
    );
  }
  if (negatives.length) {
    out.push(
      anomaly({
        key: `${t.block.id}:negatif`,
        rule: "montant-negatif",
        category: "budget",
        severity: budgetDoc ? "bloquante" : "majeure",
        title: `Montants négatifs (${negatives.length})`,
        detail: listSome(negatives) + ".",
        suggestion: "Une dotation ne peut pas être négative : corriger la saisie (signe ou formule).",
        location: loc,
      }),
    );
  }
  if (drops.length) {
    out.push(
      anomaly({
        key: `${t.block.id}:zero`,
        rule: "dotation-nulle",
        category: "budget",
        severity: "majeure",
        title: `Dotations qui tombent à zéro (${drops.length})`,
        detail: listSome(drops) + ".",
        suggestion: "Vérifier s'il s'agit d'une action achevée (le préciser en note) ou d'un oubli de projection.",
        location: loc,
      }),
    );
  }
  return out;
}

// Le total d'une même année doit être identique dans le tableau par
// programme et dans le tableau par nature économique.
function crossTableTotals(ctx: DocContext): Anomaly[] {
  const byYear = new Map<number, { t: TableInfo; value: number }[]>();
  for (const t of ctx.tables) {
    const totalRow = t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop();
    if (totalRow === undefined) continue;
    for (const y of t.yearCols) {
      if (y.relative || !t.money[y.col]) continue;
      const v = t.nums[totalRow][y.col];
      if (!v) continue;
      const list = byYear.get(y.year) ?? [];
      list.push({ t, value: v.value });
      byYear.set(y.year, list);
    }
  }
  const issues: string[] = [];
  let first: TableInfo | null = null;
  for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length < 2) continue;
    const values = [...new Set(list.map((x) => x.value))];
    if (values.length < 2) continue;
    const max = Math.max(...values);
    const min = Math.min(...values);
    // Écart très faible : arrondi. Écart très fort : tableaux de périmètres
    // différents (un programme, les seuls investissements…), pas une erreur.
    if ((max - min) / max <= 0.005 || (max - min) / max > 0.2) continue;
    issues.push(`${year} : ${list.map((x) => `${fmt(x.value)} (« ${x.t.title.slice(0, 50)} »)`).join(" / ")}`);
    first ??= list[0].t;
  }
  if (!issues.length || !first) return [];
  return [
    anomaly({
      key: "totaux-annuels",
      rule: "totaux-annuels-divergents",
      category: "budget",
      severity: "majeure",
      title: `Totaux annuels différents selon les tableaux (${plural(issues.length, "année")})`,
      detail: listSome(issues, 4) + ".",
      suggestion:
        "Rapprocher les tableaux (par programme, par nature économique, par source de financement) : pour une même année et une même unité, ils doivent aboutir au même total, sinon expliquer le périmètre de chacun.",
      location: tableLoc(ctx, first),
    }),
  ];
}

// Projection « mécanique » : toutes les lignes augmentent du même taux d'une
// année sur l'autre (+10 % par an, par exemple). Ce n'est pas une erreur,
// mais une projection qui ne reflète pas le coût réel des actions prévues.
function uniformGrowth(ctx: DocContext): Anomaly[] {
  const rates = new Map<string, { n: number; tables: Set<string>; first: TableInfo }>();
  let checked = 0;
  for (const t of ctx.tables) {
    if (t.empty || !isMoneyTable(t)) continue;
    const years = t.yearCols.filter((y) => !y.relative).sort((a, b) => a.year - b.year);
    for (let k = 2; k < years.length; k++) {
      t.body.forEach((_, r) => {
        const prev = t.nums[r][years[k - 1].col];
        const cur = t.nums[r][years[k].col];
        if (!prev || !cur || prev.value <= 0) return;
        checked++;
        const key = ((cur.value / prev.value - 1) * 100).toFixed(1);
        const e = rates.get(key) ?? { n: 0, tables: new Set<string>(), first: t };
        e.n++;
        e.tables.add(t.title);
        rates.set(key, e);
      });
    }
  }
  if (checked < 10) return [];
  const [rate, e] = [...rates.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? [];
  if (!e || e.n / checked < 0.8) return [];
  return [
    anomaly({
      key: "croissance-uniforme",
      rule: "projection-uniforme",
      category: "budget",
      severity: "info",
      title: `Projections à taux uniforme (${rate} % par an)`,
      detail: `${e.n} montants sur ${checked} progressent exactement de ${rate} % d'une année sur l'autre à partir de la deuxième année de projection (${plural(e.tables.size, "tableau")}).`,
      suggestion:
        "Vérifier que les années N+1 et N+2 reflètent le coût réel des actions (démarrage ou fin de projets, recrutements, investissements ponctuels) plutôt qu'une indexation automatique ; justifier le taux retenu (cadrage macroéconomique, lettre de cadrage).",
      location: tableLoc(ctx, e.first),
    }),
  ];
}

export function budgetRules(ctx: DocContext): Anomaly[] {
  const budgetDoc = ["cdmt", "cahier-charges", "tdr"].includes(ctx.kind);
  const out: Anomaly[] = [];
  // Les tableaux d'indicateurs (valeurs en %, en nombre) ont leurs propres contrôles.
  const seen = new Set<string>();
  const jumps: Jump[] = [];
  for (const t of ctx.tables) if (!t.empty && t.yearCols.length >= 2 && isMoneyTable(t)) out.push(...multiYear(ctx, t, budgetDoc, seen, jumps));
  if (jumps.length) {
    jumps.sort((a, b) => b.weight - a.weight);
    out.push(
      anomaly({
        key: "variations",
        rule: "variation-forte",
        category: "budget",
        severity: "mineure",
        title: `Variations annuelles supérieures à ${GROWTH_LIMIT * 100} % (${jumps.length})`,
        detail: `Plus fortes variations en montant : ${listSome(jumps.map((j) => j.text), 6)}.`,
        suggestion:
          "Justifier chaque forte variation (nouveau projet, fin de projet, investissement ponctuel, réaffectation) dans le texte du programme concerné, ou corriger la projection.",
        location: tableLoc(ctx, jumps[0].t),
      }),
    );
  }
  out.push(...crossTableTotals(ctx), ...uniformGrowth(ctx));
  return out;
}
