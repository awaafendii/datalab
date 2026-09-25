import type { Anomaly, Severity } from "../types";
import type { DocContext, TableInfo } from "../structure";
import type { NumberInfo } from "../numbers";
import { fmt, norm, plural } from "../text";
import { anomaly, colLabel, listSome, rowLabel, tableLoc } from "./util";

// Contrôles arithmétiques des tableaux : totaux en ligne et en colonne,
// pourcentages recalculés à partir des effectifs, quantité × prix unitaire,
// tableaux vides, décalés ou répétés.

const isTotalHeader = (h: string) => h.split(" > ").some((p) => /^total\b/i.test(p.trim()));

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function maxDecimals(values: (NumberInfo | null)[]): number {
  return Math.max(0, ...values.map((v) => v?.decimals ?? 0));
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

function unfilled(t: TableInfo): boolean {
  const labels = t.header.filter(Boolean);
  if (labels.length < 2 || labels.some((l) => l.length > 80)) return false;
  return t.body.every((row) => row.every((c, i) => i === 0 || c === ""));
}

// Tableau de montants (budget, coûts, ressources) : sa légende, ses en-têtes
// ou ses cellules parlent d'argent.
export function isMoneyTable(t: TableInfo): boolean {
  if (t.money.some(Boolean)) return true;
  const text = norm([t.title, ...t.preamble, ...t.header].join(" "));
  if (/indicateurs?/.test(text)) return false;
  return /\b(gnf|fg|usd|eur|fcfa)\b|€|montants?|couts?|budget|depenses|ressources|credits|financement|dotations?|plan d.actions?/.test(text);
}

// Nature d'une ligne de tableau budgétaire, d'après son libellé. L'ordre
// d'apparition de ces natures dans le tableau donne la hiérarchie (par ex.
// programme > nature économique > type de dépense, ou programme > action >
// activité), quelle que soit la façon dont chaque ministère les combine.
type RowKind = "programme" | "action" | "nature" | "type" | "autre";

export function rowKind(label: string): RowKind {
  const t = norm(label);
  // « PROGRAMME 002 — … », « Programme N° 3 », « 34002 - Programme 2 » ; mais
  // pas « Programme de financement de la formation… » (une activité).
  // Codes de programme de la loi de finances : « 21001-Pilotage et soutien ».
  if (/^(sous-)?programme\s*(n°|no)?\s*\d|^\d{5}\s*[-–—]\s*programme|^2[12]\d{3}\s*[-–—]\s*\D/.test(t)) return "programme";
  if (/^\d{3,4}\s*[-–—]/.test(t)) return "action";
  if (/^[1-6]\s+depenses?\b|^titre\s+[1-6]\b/.test(t)) return "nature";
  if (/^depenses? (courantes?|d.investissement|en capital)/.test(t)) return "type";
  return "autre";
}

// Contrôle des sous-totaux d'un tableau hiérarchique : chaque ligne parente
// doit égaler la somme de ses lignes filles directes, et le total général la
// somme des lignes de premier niveau. Renvoie null si le tableau n'est pas
// hiérarchique (le contrôle simple des totaux s'applique alors).
function hierarchyCheck(ctx: DocContext, t: TableInfo, budgetDoc: boolean): Anomaly[] | null {
  if (!isMoneyTable(t)) return null;
  const rows = t.body.map((_, r) => r).filter((r) => !t.totalRows.includes(r));
  const kinds = rows.map((r) => rowKind(rowLabel(t, r)));
  const order: RowKind[] = [];
  for (const k of kinds) if (k !== "autre" && !order.includes(k)) order.push(k);
  if (order.length === 0 || (order.length === 1 && !kinds.includes("autre"))) return null;
  order.push("autre");
  const rank = (i: number) => order.indexOf(kinds[i]);
  const cols = t.header.map((_, c) => c).filter((c) => t.kinds[c] === "count");
  const issues: string[] = [];
  let money = false;
  const tolFor = (v: number) => Math.max(0.5, Math.abs(v) * 1e-6);

  rows.forEach((r, i) => {
    const level = rank(i);
    if (level === order.length - 1) return; // feuille
    // Filles directes : lignes suivantes plus profondes, au niveau le plus haut présent.
    const below: number[] = [];
    for (let j = i + 1; j < rows.length && rank(j) > level; j++) below.push(j);
    if (!below.length) return;
    const childLevel = Math.min(...below.map(rank));
    const children = below.filter((j) => rank(j) === childLevel);
    for (const c of cols) {
      const parent = t.nums[r][c];
      if (!parent) continue;
      const vals = children.map((j) => t.nums[rows[j]][c]?.value ?? 0);
      const S = sum(vals);
      const tol = tolFor(parent.value);
      // Deux niveaux « autres » successifs (projet puis rubriques) : double comptage normal.
      if (Math.abs(S - parent.value) <= tol || (order[childLevel] === "autre" && Math.abs(S - 2 * parent.value) <= 2 * tol)) continue;
      issues.push(`« ${rowLabel(t, r)} », colonne « ${colLabel(t, c)} » : ${fmt(parent.value)} indiqué, somme des ${plural(children.length, "ligne")} détaillées = ${fmt(S)} (écart ${fmt(S - parent.value)})`);
      money ||= true;
      break; // une colonne suffit à signaler la ligne
    }
  });

  // Total général = somme des lignes de premier niveau.
  const top = rows.filter((_, i) => rank(i) === 0);
  for (const tr of t.totalRows.filter((x) => !t.subtotalRows.includes(x))) {
    for (const c of cols) {
      const T = t.nums[tr][c];
      if (!T) continue;
      const S = sum(top.map((r) => t.nums[r][c]?.value ?? 0));
      if (Math.abs(S - T.value) > tolFor(T.value)) {
        issues.push(`« ${rowLabel(t, tr)} », colonne « ${colLabel(t, c)} » : ${fmt(T.value)} indiqué, somme des ${plural(top.length, "ligne")} de premier niveau = ${fmt(S)}`);
        break;
      }
    }
  }
  if (!issues.length) return [];
  return [
    anomaly({
      key: `${t.block.id}:hierarchie`,
      rule: "sous-totaux",
      category: "budget",
      severity: budgetDoc || money ? "majeure" : "mineure",
      title: `Sous-totaux incohérents (${plural(issues.length, "ligne")})`,
      detail: listSome(issues, 5) + ".",
      suggestion:
        "Chaque ligne de regroupement (programme, action, nature de dépense) doit être la somme de ses lignes détaillées : corriger le montant du regroupement ou la ligne détaillée erronée, puis reporter la correction dans les autres tableaux du document.",
      location: tableLoc(ctx, t),
    }),
  ];
}

// Tableau dont les lignes ont glissé : la 1re colonne reprend le total de la
// ligne précédente (copier-coller décalé d'une ligne).
function shifted(t: TableInfo): boolean {
  const totalCol = t.header.findIndex((h, c) => c > 0 && t.kinds[c] === "count" && isTotalHeader(h));
  if (totalCol < 0 || t.kinds[0] !== "count") return false;
  let n = 0;
  let matches = 0;
  for (let r = 1; r < t.body.length; r++) {
    const v = t.nums[r][0];
    const prev = t.nums[r - 1][totalCol];
    if (!v || !prev) continue;
    n++;
    if (v.value === prev.value) matches++;
  }
  return n >= 3 && matches / n >= 0.6;
}

function verticalTotals(ctx: DocContext, t: TableInfo, budgetDoc: boolean): Anomaly[] {
  const out: Anomaly[] = [];
  for (const tr of t.totalRows) {
    const isSub = t.subtotalRows.includes(tr);
    const before = t.totalRows.filter((x) => x < tr);
    let items = range(before.length ? before[before.length - 1] + 1 : 0, tr);
    if (!isSub) {
      const subs = t.subtotalRows.filter((x) => x < tr);
      if (subs.length) items = subs;
    }
    const issues: { c: number; S: number; T: number; n: number; hint: string | null }[] = [];
    for (let c = 0; c < t.header.length; c++) {
      if (t.kinds[c] !== "count") continue;
      const T = t.nums[tr][c];
      if (!T) continue;
      const cells = items.map((r) => t.nums[r][c]);
      const vals = cells.filter((v): v is NumberInfo => v !== null);
      if (vals.length < 2) continue;
      const S = sum(vals.map((v) => v.value));
      const tol = Math.max(0.5 * Math.pow(10, -maxDecimals([...cells, T])) + 1e-9, Math.abs(T.value) * 1e-4);
      if (Math.abs(S - T.value) <= tol) continue;
      if (Math.abs(S - 2 * T.value) <= 2 * tol) continue; // groupes + détails : double comptage normal
      const gap = S - T.value;
      const culprit = items.find((r) => {
        const v = t.nums[r][c];
        return v !== null && Math.abs(Math.abs(gap) - Math.abs(v.value)) <= tol;
      });
      // Lignes du tableau sans valeur dans cette colonne (montant oublié).
      const blanks = items.filter((r) => t.nums[r][c] === null && t.body[r].some((v, k) => k !== c && v !== ""));
      const zeros = items.filter((r) => t.nums[r][c]?.value === 0);
      const hints: string[] = [];
      if (culprit !== undefined) hints.push(`l'écart correspond exactement à la ligne « ${rowLabel(t, culprit)} » (comptée en trop ou oubliée ?)`);
      if (blanks.length) hints.push(`${plural(blanks.length, "ligne n'a", "lignes n'ont")} pas de valeur (${listSome(blanks.map((r) => `« ${rowLabel(t, r)} »`), 3, ", ")})`);
      if (zeros.length) hints.push(`${plural(zeros.length, "ligne vaut", "lignes valent")} 0 (${listSome(zeros.map((r) => `« ${rowLabel(t, r)} »`), 3, ", ")})`);
      issues.push({ c, S, T: T.value, n: vals.length, hint: hints.length ? hints.join(" ; ") : null });
    }
    if (!issues.length) continue;
    const money = issues.some((i) => t.money[i.c]);
    const severity: Severity = money && budgetDoc ? "bloquante" : "majeure";
    out.push(
      anomaly({
        key: `${t.block.id}:r${tr}`,
        rule: "total-colonne",
        category: money ? "budget" : "calcul",
        severity,
        title: `Total incohérent${issues.length > 1 ? ` (${issues.length} colonnes)` : ""}`,
        detail:
          `Ligne « ${rowLabel(t, tr)} » : ` +
          issues
            .map(
              (i) =>
                `colonne « ${colLabel(t, i.c)} » — la somme des ${i.n} lignes donne ${fmt(i.S)}, le total indiqué est ${fmt(i.T)} (écart ${i.S - i.T > 0 ? "+" : ""}${fmt(i.S - i.T)})` +
                (i.hint ? ` ; ${i.hint}` : ""),
            )
            .join(" ; ") +
          ".",
        suggestion: issues
          .map((i) => `Remplacer ${fmt(i.T)} par ${fmt(i.S)} dans « ${colLabel(t, i.c)} » si les lignes sont justes, sinon corriger la ligne erronée`)
          .join(" ; ") + ". Recalculer ensuite les pourcentages qui en dépendent.",
        location: tableLoc(ctx, t, tr),
      }),
    );
  }
  return out;
}

function rowTotals(ctx: DocContext, t: TableInfo, budgetDoc: boolean): Anomaly[] {
  const out: Anomaly[] = [];
  let prevTotal = -1;
  t.header.forEach((h, c) => {
    if (t.kinds[c] !== "count") return;
    // Colonne de cumul d'une période (« 2026-2028 », « Total 2026-2028 ») :
    // somme des années de la période, hors année de référence (LFR/LFI N-1).
    const period = (h.split(" > ").pop() ?? h).match(/((?:19|20)\d{2})\s*[-–à]\s*((?:19|20)\d{2})\s*$/);
    let parts: number[];
    if (period) {
      const [from, to] = [parseInt(period[1], 10), parseInt(period[2], 10)];
      parts = t.yearCols.filter((y) => !y.relative && y.year >= from && y.year <= to && y.col !== c).map((y) => y.col);
    } else if (isTotalHeader(h)) {
      parts = range(prevTotal + 1, c).filter((p) => t.kinds[p] === "count" && !isTotalHeader(t.header[p]));
      prevTotal = c;
    } else return;
    if (parts.length < 2) return;
    const wrong: string[] = [];
    let maxGap = 0;
    t.body.forEach((row, r) => {
      const T = t.nums[r][c];
      if (!T) return;
      const cells = parts.map((p) => t.nums[r][p]);
      if (parts.some((p, k) => row[p] !== "" && cells[k] === null && !/^[-–—]$/.test(row[p]))) return;
      const vals = cells.filter((v): v is NumberInfo => v !== null);
      if (vals.length < 2) return;
      const S = sum(vals.map((v) => v.value));
      const tol = Math.max(0.5 * Math.pow(10, -maxDecimals([...cells, T])) + 1e-9, Math.abs(T.value) * 1e-4);
      if (Math.abs(S - T.value) <= tol) return;
      maxGap = Math.max(maxGap, Math.abs(S - T.value));
      wrong.push(`${rowLabel(t, r)} : ${vals.map((v) => fmt(v.value)).join(" + ")} = ${fmt(S)}, total indiqué ${fmt(T.value)}`);
    });
    if (!wrong.length) return;
    const money = t.money[c];
    out.push(
      anomaly({
        key: `${t.block.id}:c${c}`,
        rule: "total-ligne",
        category: money ? "budget" : "calcul",
        severity: money && budgetDoc ? "bloquante" : "majeure",
        title: `Totaux de ligne faux (${plural(wrong.length, "ligne")})`,
        detail: `La colonne « ${colLabel(t, c)} » ne correspond pas à la somme des colonnes ${parts.map((p) => `« ${colLabel(t, p)} »`).join(", ")} : ${listSome(wrong)}.`,
        suggestion:
          "Vérifier chaque ligne signalée : soit le total, soit l'une des valeurs détaillées est fausse. Une fois les effectifs corrigés, recalculer les pourcentages de la ligne.",
        location: tableLoc(ctx, t, undefined, c),
      }),
    );
  });
  return out;
}

type DenKind = "colonne" | "ligne" | "général";

function percentColumns(ctx: DocContext, t: TableInfo): Anomaly[] {
  const out: Anomaly[] = [];
  const grandRow = t.totalRows.filter((r) => !t.subtotalRows.includes(r)).pop();
  const totalCols = t.header.map((h, c) => (t.kinds[c] === "count" && isTotalHeader(h) ? c : -1)).filter((c) => c >= 0);
  const group = (h: string) => (h.includes(" > ") ? h.split(" > ")[0] : null);

  t.header.forEach((h, p) => {
    if (t.kinds[p] !== "percent") return;
    const counts = range(0, p).filter((c) => t.kinds[c] === "count");
    let countCol = [...counts].reverse().find((c) => group(t.header[c]) !== null && group(t.header[c]) === group(h));
    if (countCol === undefined) countCol = [...counts].reverse().find((c) => p - c <= 2);
    if (countCol === undefined) {
      const all = t.kinds.map((k, c) => (k === "count" ? c : -1)).filter((c) => c >= 0);
      if (all.length === 1) countCol = all[0];
    }
    const pctTotal = grandRow !== undefined ? t.nums[grandRow][p] : null;

    // Somme des pourcentages d'une répartition = 100 %.
    if (pctTotal && Math.abs(pctTotal.value - 100) <= 0.6) {
      const vals = t.body
        .map((_, r) => r)
        .filter((r) => !t.totalRows.includes(r))
        .map((r) => t.nums[r][p])
        .filter((v): v is NumberInfo => v !== null);
      const S = sum(vals.map((v) => v.value));
      if (vals.length >= 2 && !vals.every((v) => Math.abs(v.value - 100) < 0.01)) {
        const tol = Math.max(0.6, 0.05 * vals.length);
        if (Math.abs(S - 100) > tol) {
          out.push(
            anomaly({
              key: `${t.block.id}:sum${p}`,
              rule: "pourcentages-somme",
              category: "calcul",
              severity: "majeure",
              title: "Les pourcentages ne totalisent pas 100 %",
              detail: `Colonne « ${colLabel(t, p)} » : la somme des ${vals.length} pourcentages donne ${fmt(S)} % alors que la ligne de total affiche ${fmt(pctTotal.value)} %.`,
              suggestion: "Recalculer chaque pourcentage à partir des effectifs (effectif ÷ total × 100) et vérifier qu'aucune catégorie n'a été oubliée ou comptée deux fois.",
              location: tableLoc(ctx, t, undefined, p),
            }),
          );
        }
      }
    }

    if (countCol === undefined) return;
    const cc = countCol;
    const rows = t.body.map((_, r) => r).filter((r) => t.nums[r][p] && t.nums[r][cc]);
    if (rows.length < 2) return;
    const nonTotal = t.body.map((_, r) => r).filter((r) => !t.totalRows.includes(r));
    const colDen =
      grandRow !== undefined && t.nums[grandRow][cc]
        ? t.nums[grandRow][cc]!.value
        : sum(nonTotal.map((r) => t.nums[r][cc]?.value ?? 0));
    const rowTotalCol = totalCols.find((c) => c !== cc && c > cc) ?? (totalCols.includes(cc) ? cc : undefined);
    const dens: Record<DenKind, ((r: number) => number | null) | null> = {
      colonne: colDen > 0 ? () => colDen : null,
      ligne: rowTotalCol !== undefined ? (r) => t.nums[r][rowTotalCol]?.value ?? null : null,
      général:
        rowTotalCol !== undefined && grandRow !== undefined && t.nums[grandRow][rowTotalCol]
          ? () => t.nums[grandRow][rowTotalCol]!.value
          : null,
    };
    // Tolérance d'une unité sur la dernière décimale affichée : une valeur
    // tronquée au lieu d'être arrondie (57,6 pour 57,66) n'est pas signalée.
    const tolerance = (decimals: number) => Math.pow(10, -decimals) + 0.005;
    const check = (k: DenKind, r: number): { ok: boolean; calc: number; den: number } | null => {
      const f = dens[k];
      if (!f) return null;
      const den = f(r);
      if (!den) return null;
      const x = t.nums[r][cc]!.value;
      const y = t.nums[r][p]!;
      const calc = (x / den) * 100;
      return { ok: Math.abs(calc - y.value) <= tolerance(y.decimals), calc, den };
    };
    const kinds = (Object.keys(dens) as DenKind[]).filter((k) => dens[k]);
    if (!kinds.length) return;
    const score = (k: DenKind) => rows.filter((r) => check(k, r)?.ok).length;
    let best = kinds.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (score(best) === rows.length) return;
    if (score(best) < rows.length / 2) {
      best = pctTotal && Math.abs(pctTotal.value - 100) <= 0.6 && dens.colonne ? "colonne" : dens.ligne ? "ligne" : kinds[0];
    }
    const wrong: { r: number; calc: number; den: number; dev: number }[] = [];
    for (const r of rows) {
      const c = check(best, r);
      if (!c || c.ok) continue;
      wrong.push({ r, calc: c.calc, den: c.den, dev: Math.abs(c.calc - t.nums[r][p]!.value) });
    }
    if (!wrong.length) return;
    const maxDev = Math.max(...wrong.map((w) => w.dev));
    const decimals = Math.max(1, t.nums[rows[0]][p]!.decimals);
    const denLabel = best === "colonne" ? "total de la colonne" : best === "ligne" ? "total de la ligne" : "total général";
    out.push(
      anomaly({
        key: `${t.block.id}:pct${p}`,
        rule: "pourcentage-recalcul",
        category: "calcul",
        severity: maxDev <= 1 ? "mineure" : "majeure",
        title: `Pourcentages inexacts (${plural(wrong.length, "valeur")})`,
        detail:
          `Colonne « ${colLabel(t, p)} », recalculée sur la base « ${colLabel(t, cc)} ÷ ${denLabel} » : ` +
          listSome(
            wrong.map(
              (w) =>
                `${rowLabel(t, w.r)} : ${fmt(t.nums[w.r][p]!.value)} % indiqué, ${fmt(w.calc, decimals)} % calculé (${fmt(t.nums[w.r][cc]!.value)}/${fmt(w.den)})`,
            ),
          ) +
          ".",
        suggestion: `Remplacer par les valeurs recalculées : ${listSome(wrong.map((w) => `${rowLabel(t, w.r)} → ${fmt(w.calc, decimals)} %`))}. Si l'effectif est faux, le corriger d'abord.`,
        location: tableLoc(ctx, t, undefined, p),
      }),
    );
  });
  return out;
}

// Pas de \b après une lettre accentuée : en JavaScript, « é » n'est pas un
// caractère de mot et \b échouerait sur « Qtité ».
const QTY_RE = /^(qt[ée]?s?|qtit[ée]s?|quantit[ée]s?|nombre|nbre|nb)(?=$|[\s(.:])/i;
const PU_RE = /(^|\s|\()(p\.?\s?u\.?|prix unitaire|co[uû]t unitaire|montant unitaire)(\b|\s|\(|$)/i;
const PT_RE = /(^|\s|\()(p\.?\s?t\.?|prix total|co[uû]t total|montant total|montant)(\b|\s|\(|$)/i;

function qtyPrice(ctx: DocContext, t: TableInfo, budgetDoc: boolean): Anomaly[] {
  const last = (h: string) => h.split(" > ").pop() ?? h;
  const q = t.header.findIndex((h, c) => t.kinds[c] === "count" && QTY_RE.test(last(h)));
  const pu = t.header.findIndex((h, c) => t.kinds[c] === "count" && PU_RE.test(last(h)));
  const pt = t.header.findIndex((h, c) => c !== pu && t.kinds[c] === "count" && PT_RE.test(last(h)));
  if (q < 0 || pu < 0 || pt < 0) return [];
  const wrong: string[] = [];
  t.body.forEach((_, r) => {
    if (t.totalRows.includes(r)) return;
    const Q = t.nums[r][q];
    const P = t.nums[r][pu];
    const T = t.nums[r][pt];
    if (!Q || !P) return;
    const expected = Q.value * P.value;
    if (!T) {
      if (expected > 0) wrong.push(`${rowLabel(t, r)} : montant total absent (attendu ${fmt(expected)})`);
      return;
    }
    if (Math.abs(T.value - expected) > Math.max(0.5, expected * 0.001)) {
      wrong.push(`${rowLabel(t, r)} : ${fmt(Q.value)} × ${fmt(P.value)} = ${fmt(expected)}, montant indiqué ${fmt(T.value)}`);
    }
  });
  if (!wrong.length) return [];
  return [
    anomaly({
      key: `${t.block.id}:qpu`,
      rule: "quantite-prix",
      category: "budget",
      severity: budgetDoc ? "bloquante" : "majeure",
      title: `Montants ≠ quantité × prix unitaire (${plural(wrong.length, "ligne")})`,
      detail: listSome(wrong) + ".",
      suggestion: "Corriger le montant total de chaque ligne (quantité × prix unitaire), puis recalculer le total du tableau.",
      location: tableLoc(ctx, t),
    }),
  ];
}

export function tableRules(ctx: DocContext): Anomaly[] {
  const out: Anomaly[] = [];
  const budgetDoc = ["cdmt", "cahier-charges", "tdr"].includes(ctx.kind);
  const emptyNoCaption: TableInfo[] = [];
  const seen = new Map<string, TableInfo>();

  for (const t of ctx.tables) {
    if (t.empty) {
      if (t.hasCaption) {
        out.push(
          anomaly({
            key: t.block.id,
            rule: "tableau-vide",
            category: "completude",
            severity: "majeure",
            title: "Tableau vide",
            detail: `Le tableau « ${t.title} » ne contient aucune donnée.`,
            suggestion: "Renseigner le tableau ou le supprimer (ainsi que ses renvois dans le texte et la liste des tableaux).",
            location: tableLoc(ctx, t),
          }),
        );
      } else emptyNoCaption.push(t);
      continue;
    }
    if (unfilled(t)) {
      out.push(
        anomaly({
          key: t.block.id,
          rule: "tableau-non-rempli",
          category: "completude",
          severity: "majeure",
          title: "Tableau non rempli",
          detail: `Le tableau « ${t.title} » a des en-têtes (${listSome(t.header.filter(Boolean), 5, ", ")}) mais aucune valeur.`,
          suggestion: "Compléter les valeurs (montants, effectifs, sources) ou retirer le tableau s'il n'est plus d'actualité.",
          location: tableLoc(ctx, t),
        }),
      );
      continue;
    }
    if (t.body.length >= 2) {
      const sig = [t.header, ...t.body].map((r) => r.join("|")).join("\n");
      const prev = seen.get(sig);
      if (prev) {
        out.push(
          anomaly({
            key: t.block.id,
            rule: "tableau-duplique",
            category: "structure",
            severity: "mineure",
            title: "Tableau répété",
            detail: `Ce tableau est identique au tableau « ${prev.title} » situé plus haut.`,
            suggestion: "Supprimer le doublon ou, s'il devait présenter d'autres données, le mettre à jour.",
            location: tableLoc(ctx, t),
          }),
        );
      } else seen.set(sig, t);
    }
    if (shifted(t)) {
      out.push(
        anomaly({
          key: t.block.id,
          rule: "tableau-decale",
          category: "calcul",
          severity: "majeure",
          title: "Tableau décalé (lignes ou colonnes glissées)",
          detail:
            "La première colonne reprend, ligne après ligne, le total de la ligne précédente : le contenu a glissé d'une ligne lors d'un copier-coller. Les libellés, effectifs et totaux ne sont plus alignés, les calculs de ce tableau ne sont donc pas fiables.",
          suggestion: "Reconstruire le tableau depuis la source (fichier d'enquête ou Excel) puis revérifier les totaux et les pourcentages.",
          location: tableLoc(ctx, t),
        }),
      );
      continue;
    }
    const hierarchy = hierarchyCheck(ctx, t, budgetDoc);
    out.push(...(hierarchy ?? verticalTotals(ctx, t, budgetDoc)));
    out.push(...rowTotals(ctx, t, budgetDoc));
    out.push(...percentColumns(ctx, t));
    out.push(...qtyPrice(ctx, t, budgetDoc));
  }

  if (emptyNoCaption.length) {
    out.push(
      anomaly({
        key: "vides",
        rule: "tableaux-vides",
        category: "structure",
        severity: "mineure",
        title: `${plural(emptyNoCaption.length, "tableau entièrement vide", "tableaux entièrement vides")}`,
        detail: `Tableaux sans aucune donnée (résidus de mise en page ou tableaux jamais remplis) : ${listSome(
          emptyNoCaption.map((t) => (t.section ? `après « ${t.section.split(" › ").pop()} »` : `n°${t.ordinal}`)),
          5,
        )}.`,
        suggestion: "Supprimer ces tableaux vides ou y insérer les données prévues.",
        location: { section: emptyNoCaption[0].section || undefined, blockId: emptyNoCaption[0].block.id },
      }),
    );
  }
  return out;
}
