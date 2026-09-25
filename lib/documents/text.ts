// Outils texte partagés par l'extraction et les règles de contrôle.

// Minuscules, sans accents, apostrophes et espaces normalisés : sert à
// comparer des libellés sans se soucier de la saisie.
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[   ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function clean(s: string): string {
  return s.replace(/[   \t]/g, " ").replace(/\s+/g, " ").trim();
}

const WORD_RE = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

export function words(s: string): string[] {
  return s.match(WORD_RE) ?? [];
}

export function wordCount(s: string): number {
  return words(s).length;
}

export const STOPWORDS = new Set(
  (
    "le la les l de des du d un une et en a au aux pour par sur dans avec sans ce cet cette ces " +
    "qui que qu quoi dont ou il elle ils elles on nous vous leur leurs son sa ses se ne pas plus " +
    "est sont ete etre avoir ont entre selon ainsi afin comme mais donc car si tout tous toute toutes " +
    "etc ci y lui meme aussi tres bien dont lors vers chez sous apres avant depuis pendant"
  ).split(" "),
);

// Mots significatifs (sans mots vides), normalisés.
export function keywords(s: string, minLen = 4): string[] {
  return words(norm(s)).filter((w) => w.length >= minLen && !STOPWORDS.has(w));
}

// Extrait lisible autour d'une position.
export function excerpt(text: string, index = 0, length = 0, radius = 80): string {
  const t = text.replace(/\s+/g, " ");
  if (t.length <= radius * 2 + length) return t.trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(t.length, index + length + radius);
  return (start > 0 ? "…" : "") + t.slice(start, end).trim() + (end < t.length ? "…" : "");
}

export function truncate(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Proportion de lettres majuscules parmi les lettres.
export function upperRatio(s: string): number {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  return upper.length / letters.length;
}

export function endsWithTerminal(s: string): boolean {
  // Un tiret parasite après le point (« technologie.- ») ne compte pas.
  return /[.!?…;:)»"”’']\s*$/.test(s.trim().replace(/[\s\-–—]+$/, ""));
}

// Distance de Damerau-Levenshtein (transpositions comprises), bornée : au-delà
// de `max`, renvoie max + 1 sans finir le calcul.
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

export function romanToInt(s: string): number | null {
  if (!/^[IVXLC]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 ? total : null;
}

const MONTHS = [
  "janvier",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
];

// Mois (1..12) cités dans un texte libre (« du 19 avril au 03 mai 2025 »,
// « 12/03/2025 »).
export function monthsIn(text: string): number[] {
  const t = norm(text);
  const out = new Set<number>();
  MONTHS.forEach((m, i) => {
    if (new RegExp(`\\b${m}\\b`).test(t)) out.add(i + 1);
  });
  const re = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) out.add(month);
  }
  return [...out].sort((a, b) => a - b);
}

export function yearsIn(text: string): number[] {
  return [...new Set((text.match(/\b(19[5-9]\d|20\d{2})\b/g) ?? []).map(Number))];
}

// Détecte une mention de date (mois + année, date numérique, « année 2024 »).
export function hasDate(text: string): boolean {
  const t = norm(text);
  if (/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(t)) return true;
  const monthYear = new RegExp(`\\b(${MONTHS.join("|")})\\s+(19|20)\\d{2}\\b`);
  if (monthYear.test(t)) return true;
  return /\b(annee|exercice|gestion|periode|date)\s*:?\s*(19|20)\d{2}\b/.test(t) || /\b(19|20)\d{2}\s*[-–/]\s*(19|20)\d{2}\b/.test(t);
}

// Formate un nombre à la française avec des espaces simples (les espaces
// fines insécables de toLocaleString s'affichent mal dans les exports PDF).
export function fmt(n: number, maxDecimals = 2): string {
  return n
    .toLocaleString("fr-FR", { maximumFractionDigits: maxDecimals })
    .replace(/[  ]/g, " ");
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? pluralForm ?? singular + "s" : singular}`;
}
