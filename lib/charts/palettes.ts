// Palettes de couleurs et échelles continues proposées dans le panneau
// « Format ». Les palettes catégorielles reprennent les thèmes par défaut des
// outils que les utilisateurs connaissent (Excel, Power BI, Tableau,
// Matplotlib, Seaborn, Plotly) pour retrouver des rendus familiers.

export interface Palette {
  id: string;
  label: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  {
    id: "datalab",
    label: "DataLab",
    colors: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  },
  {
    id: "office",
    label: "Excel / Office",
    colors: ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"],
  },
  {
    id: "powerbi",
    label: "Power BI",
    colors: ["#118dff", "#12239e", "#e66c37", "#6b007b", "#e044a7", "#744ec2", "#d9b300", "#d64550", "#197278", "#1aab40"],
  },
  {
    id: "tableau",
    label: "Tableau 10",
    colors: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"],
  },
  {
    id: "matplotlib",
    label: "Matplotlib (tab10)",
    colors: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"],
  },
  {
    id: "seaborn",
    label: "Seaborn (deep)",
    colors: ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3", "#937860", "#da8bc3", "#8c8c8c", "#ccb974", "#64b5cd"],
  },
  {
    id: "plotly",
    label: "Plotly",
    colors: ["#636efa", "#ef553b", "#00cc96", "#ab63fa", "#ffa15a", "#19d3f3", "#ff6692", "#b6e880", "#ff97ff", "#fecb52"],
  },
  {
    id: "pastel",
    label: "Pastel",
    colors: ["#a1c9f4", "#ffb482", "#8de5a1", "#ff9f9b", "#d0bbff", "#debb9b", "#fab0e4", "#cfcfcf", "#fffea3", "#b9f2f0"],
  },
  {
    id: "guinee",
    label: "Rouge · jaune · vert",
    colors: ["#ce1126", "#fcd116", "#009460", "#7a0a17", "#a88a00", "#005c3b", "#e8737f", "#66bf97"],
  },
  {
    id: "viridis",
    label: "Viridis",
    colors: ["#440154", "#482878", "#3e4a89", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  },
  {
    id: "blues",
    label: "Camaïeu de bleus",
    colors: ["#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#c6dbef"],
  },
  {
    id: "earth",
    label: "Terre",
    colors: ["#8c510a", "#bf812d", "#dfc27d", "#80cdc1", "#35978f", "#01665e", "#543005", "#003c30"],
  },
  {
    id: "mono",
    label: "Gris",
    colors: ["#252525", "#525252", "#737373", "#969696", "#bdbdbd", "#d9d9d9"],
  },
];

export const DEFAULT_PALETTE = "datalab";

export function getPalette(id: string): string[] {
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).colors;
}

// Échelles continues : noms natifs Plotly (mêmes noms qu'en Python), plus
// « custom » pour un dégradé à deux couleurs choisies par l'utilisateur.
export interface Colorscale {
  id: string;
  label: string;
  // Aperçu, de la valeur la plus basse à la plus haute (sens affiché).
  preview: string[];
  // Échelles que Plotly définit du foncé (bas) vers le clair (haut) : on les
  // inverse par défaut pour que les fortes valeurs soient les plus foncées,
  // comme dans Excel ou Power BI.
  flip?: boolean;
}

export const COLORSCALES: Colorscale[] = [
  { id: "Viridis", label: "Viridis", preview: ["#440154", "#31688e", "#35b779", "#fde725"] },
  { id: "Cividis", label: "Cividis", preview: ["#00204c", "#575c6d", "#a59c74", "#ffe945"] },
  { id: "Blues", label: "Bleus", preview: ["#dcdcdc", "#6a89f7", "#283cbe", "#050aac"], flip: true },
  { id: "Greens", label: "Verts", preview: ["#f7fcf5", "#c7e9c0", "#41ab5d", "#00441b"], flip: true },
  { id: "Reds", label: "Rouges", preview: ["#dcdcdc", "#f5c39d", "#f5a069", "#b20a1c"] },
  { id: "YlOrRd", label: "Jaune → rouge", preview: ["#ffffcc", "#feb24c", "#fc4e2a", "#800026"], flip: true },
  { id: "YlGnBu", label: "Jaune → bleu", preview: ["#ffffd9", "#41b6c4", "#225ea8", "#081d58"], flip: true },
  { id: "RdBu", label: "Bleu ↔ rouge (divergent)", preview: ["#050aac", "#6a89f7", "#bebebe", "#e6915a", "#b20a1c"] },
  { id: "Portland", label: "Portland", preview: ["#0c3383", "#0a88ba", "#f2d338", "#f28f38", "#d91e1e"] },
  { id: "Picnic", label: "Picnic", preview: ["#0000ff", "#66ccff", "#ffffff", "#ff6666", "#ff0000"] },
  { id: "Hot", label: "Chaleur", preview: ["#000000", "#e60000", "#ffd200", "#ffffff"] },
  { id: "Electric", label: "Électrique", preview: ["#000000", "#781e64", "#e6a000", "#fffadc"] },
  { id: "Earth", label: "Terre", preview: ["#000082", "#00b4b4", "#28d228", "#e6e632", "#ffffff"] },
  { id: "Jet", label: "Arc-en-ciel (Jet)", preview: ["#000083", "#003caa", "#05ffff", "#ffff00", "#fa0000", "#800000"] },
  { id: "Greys", label: "Gris", preview: ["#ffffff", "#000000"], flip: true },
  { id: "custom", label: "Personnalisée (2 couleurs)", preview: [] },
];

export const DEFAULT_COLORSCALE = "Viridis";

// Attributs `colorscale` / `reversescale` à passer à Plotly.
export function resolveColorscale(
  id: string,
  reverse: boolean,
  from: string,
  to: string,
): { colorscale: string | [number, string][]; reversescale: boolean } {
  if (id === "custom") {
    return {
      colorscale: [
        [0, from],
        [1, to],
      ],
      reversescale: reverse,
    };
  }
  const scale = COLORSCALES.find((c) => c.id === id) ?? COLORSCALES[0];
  return { colorscale: scale.id, reversescale: reverse !== Boolean(scale.flip) };
}

// Trois couleurs (basse, médiane, haute) d'un dégradé, pour l'échelle de
// couleurs conditionnelle d'Excel.
export function colorscaleStops(id: string, reverse: boolean, from: string, to: string): [string, string, string] {
  let stops = id === "custom" ? [from, to] : [...(COLORSCALES.find((c) => c.id === id)?.preview ?? ["#ffffff", "#2a78d6"])];
  if (reverse) stops = stops.reverse();
  const mid = stops.length >= 3 ? stops[Math.floor(stops.length / 2)] : mixHex(stops[0], stops[stops.length - 1]);
  return [stops[0], mid, stops[stops.length - 1]];
}

function mixHex(a: string, b: string): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  return `#${pa.map((v, i) => Math.round((v + pb[i]) / 2).toString(16).padStart(2, "0")).join("")}`;
}

export function colorscalePreview(id: string, reverse: boolean, from: string, to: string): string {
  const stops = id === "custom" ? [from, to] : [...(COLORSCALES.find((c) => c.id === id)?.preview ?? [])];
  if (reverse) stops.reverse();
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export const FONT_FAMILIES: { id: string; label: string }[] = [
  { id: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif', label: "Segoe UI (application)" },
  { id: "Calibri, Carlito, Arial, sans-serif", label: "Calibri" },
  { id: "Arial, Helvetica, sans-serif", label: "Arial" },
  { id: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { id: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { id: '"Trebuchet MS", sans-serif', label: "Trebuchet MS" },
  { id: 'Georgia, "Times New Roman", serif', label: "Georgia" },
  { id: '"Times New Roman", Times, serif', label: "Times New Roman" },
  { id: '"Courier New", Courier, monospace', label: "Courier New" },
];

export const DEFAULT_FONT = FONT_FAMILIES[0].id;

// Couleur de texte lisible sur un fond donné (luminance relative WCAG).
export function contrastText(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return "#1a1f2e";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#1a1f2e" : "#f3f4f6";
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// Mélange une couleur avec du blanc (t = 0 : inchangée, t = 1 : blanc).
export function lighten(hex: string, t: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const k = Math.max(0, Math.min(1, t));
  const c = rgb.map((v) => Math.round(v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
