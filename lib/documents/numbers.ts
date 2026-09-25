// Lecture des nombres tels qu'ils sont saisis dans les documents
// administratifs francophones : « 1 200 000 », « 63,14 % », « 25 000 € »,
// « 14 (12 + 2) », « 100000€ »…

export type Currency = "GNF" | "USD" | "EUR" | "XOF";

export interface NumberInfo {
  value: number;
  percent: boolean;
  decimals: number;
  currency: Currency | null;
}

const CURRENCY_RE =
  /\b(gnf|fg|fcfa|f\s?cfa|usd|eur|euros?|dollars?(?:\s+us)?|francs?\s+guin[ée]ens?)\b|[€$]/gi;

export function currencyOf(token: string): Currency | null {
  const t = token.toLowerCase().replace(/\s+/g, " ");
  if (t === "€" || t.startsWith("eur")) return "EUR";
  if (t === "$" || t.startsWith("usd") || t.startsWith("dollar")) return "USD";
  if (t.includes("cfa")) return "XOF";
  if (t === "gnf" || t === "fg" || t.startsWith("franc")) return "GNF";
  return null;
}

export function parseNumber(raw: string | number | null | undefined): NumberInfo | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw, percent: false, decimals: decimalsOf(raw), currency: null } : null;
  }
  let s = raw.replace(/[   ]/g, " ").trim();
  if (!s || s.length > 40) return null;
  // Précision entre parenthèses en fin de cellule : « 14 (12 + 2) » → 14.
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  let currency: Currency | null = null;
  s = s
    .replace(CURRENCY_RE, (m) => {
      currency = currencyOf(m);
      return " ";
    })
    .trim();
  let percent = false;
  if (/%$/.test(s)) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  let sign = 1;
  if (/^[-−–]\s*\d/.test(s)) {
    sign = -1;
    s = s.replace(/^[-−–]\s*/, "");
  } else if (/^\+\s*\d/.test(s)) {
    s = s.replace(/^\+\s*/, "");
  }
  let intPart: string;
  let decPart = "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,3}(?:[ .]\d{3})+)(?:,(\d+))?$/))) {
    intPart = m[1].replace(/[ .]/g, "");
    decPart = m[2] ?? "";
  } else if ((m = s.match(/^(\d+)(?:,(\d+))?$/))) {
    intPart = m[1];
    decPart = m[2] ?? "";
  } else if ((m = s.match(/^(\d+)\.(\d+)$/))) {
    intPart = m[1];
    decPart = m[2];
  } else if ((m = s.match(/^(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/))) {
    intPart = m[1].replace(/,/g, "");
    decPart = m[2] ?? "";
  } else {
    return null;
  }
  const value = sign * Number(intPart + (decPart ? "." + decPart : ""));
  if (!Number.isFinite(value)) return null;
  return { value, percent, decimals: decPart.length, currency };
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

export function isYear(s: string): number | null {
  const m = s.trim().match(/^(?:.*?\b)?((?:19|20)\d{2})$/);
  if (!m) return null;
  // L'en-tête doit être une année seule ou une année précédée d'un libellé
  // court (« LFI 2025 », « Montants2025 », « Projection 2026 »).
  const rest = s.trim().slice(0, s.trim().length - 4).trim();
  if (rest.length > 20 || /\d/.test(rest)) return null;
  return parseInt(m[1], 10);
}

// Tolérance d'arrondi pour une valeur affichée avec `decimals` décimales.
export function roundingTolerance(decimals: number): number {
  return 0.5 * Math.pow(10, -decimals) + 0.01;
}

export type Qualifier = "environ" | "plus" | "moins" | null;

export interface PercentMention {
  value: number;
  decimals: number;
  explicit: boolean; // suivi de « % » ou « pour cent »
  qualifier: Qualifier;
  index: number;
  raw: string;
}

// Pourcentages cités dans un texte : nombres suivis de « % », ou nombres à
// décimale (« 44,1 des répondants ») inférieurs à 100, qui dans ces
// documents sont presque toujours des pourcentages au signe oublié.
export function percentMentions(text: string): PercentMention[] {
  const out: PercentMention[] = [];
  // Pas de lookbehind (non pris en charge par les anciens Safari) : le
  // caractère précédent est capturé dans le groupe 1.
  const re = /(^|[^\d,.\-–/])(\d{1,3})(?:,(\d{1,2}))?(?![\d.,]\d)(\s?(?:%|pour\s?cent))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = m.index + m[1].length;
    const explicit = !!m[4];
    const dec = m[3] ?? "";
    if (!explicit && !dec) continue;
    const value = Number(m[2] + (dec ? "." + dec : ""));
    if (value > 100) continue;
    // Écarte les numéros de section ou de tableau (« II-2.1 », « 2,1,3 »).
    const before = text.slice(Math.max(0, index - 12), index);
    if (/(tableau|figure|graphique|article|section|annexe|p\.|page)\s*[\w.\-–]*\s*$/i.test(before)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (!explicit && /^\s*(milliards?|millions?|milliers?|mds?|km|kg|ha|tonnes?|ans?|mois|jours?|heures?|h\b|gnf|usd|€|\$|fcfa)/i.test(after)) continue;
    const q = before.toLowerCase();
    let qualifier: Qualifier = null;
    if (/(environ|pres de|près de|presque|approximativement|autour de|quelque|≈|~)\s*$/.test(q)) qualifier = "environ";
    else if (/(plus de|au moins|au-dela de|au-delà de|superieur a|supérieur à|plus du)\s*$/.test(q)) qualifier = "plus";
    else if (/(moins de|inferieur a|inférieur à|pas plus de|a peine|à peine)\s*$/.test(q)) qualifier = "moins";
    out.push({ value, decimals: dec.length, explicit, qualifier, index, raw: m[0].slice(m[1].length).trim() });
  }
  return out;
}
