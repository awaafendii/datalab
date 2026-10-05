// Traduction d'un ChartConfig en figure Plotly (données + mise en page).
// Fonction pure : aucune dépendance au DOM, réutilisée pour l'aperçu à
// l'écran (thème clair ou sombre) et pour l'export d'images (thème clair).

import type { Data, Layout, LayoutAxis } from "plotly.js";
import type { CellValue, Dataset } from "../types";
import { isEmpty, toNumber } from "../stats";
import type { ChartConfig, ChartTheme, ColumnInfo, ColumnKind, RoleKey } from "./types";
import { autoTitle, chartDef, measureLabel } from "./catalog";
import {
  AFRICA_BOUNDS,
  GEOJSON_URL,
  GEO_SOURCES,
  GUINEA_BOUNDS,
  MAP_LEVELS,
  detectMapLevel,
  matchZone,
  zonesOf,
  type MapLevel,
  type MapZone,
} from "./geo";
import {
  contrastText,
  getPalette,
  lighten,
  resolveColorscale,
  withAlpha,
} from "./palettes";
import {
  autoUnit,
  axisKey,
  d3Format,
  ecdf,
  fitTrend,
  flows,
  formatNumber,
  hierarchy,
  histogramBins,
  isoDate,
  kde,
  numericGroups,
  parseDate,
  pearsonPairs,
  pivot,
  rawPoints,
  sortedUnique,
  unitInfo,
  type NumberFormat,
  type Pivot,
} from "./data";

export interface BuildContext {
  dataset: Dataset;
  columns: ColumnInfo[];
  theme: ChartTheme;
  exporting?: boolean; // fond opaque pour les images exportées
}

// Élément coloriable dans le panneau « Couleurs » : série, catégorie,
// hausse / baisse…
export interface LegendItem {
  key: string;
  color: string;
}

export interface BuiltFigure {
  data: Data[];
  layout: Partial<Layout>;
  legend: LegendItem[];
  missing: string[]; // rôles obligatoires non renseignés
  warnings: string[];
  empty: boolean;
}

const TRANSPARENT = "rgba(0,0,0,0)";
const MAX_CATEGORIES = 500;
const MAX_POINTS = 20000;

// Les textes Plotly acceptent un pseudo-HTML (<b>, <br>…) : on neutralise
// les chevrons des noms de colonnes et titres saisis.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Texte inséré dans un hovertemplate : « %{ » y ouvrirait une variable.
function tpl(s: string): string {
  return esc(s).replace(/%\{/g, "%&#123;");
}

const STATUS_COLORS = {
  Hausse: "#1baf7a",
  Baisse: "#e34948",
  Total: "#2a78d6",
  "Zone basse": "#e34948",
  "Zone intermédiaire": "#eda100",
  "Zone haute": "#1baf7a",
};

type Roles = Record<RoleKey, string[]>;

class FigureBuilder {
  data: Data[] = [];
  legend: LegendItem[] = [];
  warnings: string[] = [];
  layout: Partial<Layout>;
  palette: string[];
  nf: NumberFormat;
  div: number;
  unitLabel: string;
  text: string;
  grid: string;
  surface: string;
  byName: Map<string, ColumnInfo>;

  constructor(
    public cfg: ChartConfig,
    public ctx: BuildContext,
    public roles: Roles,
  ) {
    this.palette = getPalette(cfg.palette);
    this.nf = { decimals: cfg.decimals, unit: cfg.unit, prefix: cfg.prefix, suffix: cfg.suffix };
    const u = unitInfo(cfg.unit);
    this.div = u.div;
    this.unitLabel = u.label;
    this.byName = new Map(ctx.columns.map((c) => [c.name, c]));
    const custom = cfg.background === "custom";
    this.text = custom ? contrastText(cfg.bgColor) : ctx.theme.text;
    this.grid = custom ? withAlpha(this.text === "#1a1f2e" ? "#1a1f2e" : "#f3f4f6", 0.15) : ctx.theme.grid;
    this.surface = custom ? cfg.bgColor : ctx.theme.surface;
    this.layout = this.baseLayout();
  }

  // ------------------------------------------------------------ utilitaires

  kind(col: string): ColumnKind {
    return this.byName.get(col)?.kind ?? "category";
  }

  fmt = (v: number | null | undefined) => formatNumber(v, this.nf);
  sv = (v: number | null) => (v === null ? null : v / this.div);

  // Unité « automatique » : fixée d'après les valeurs effectivement tracées,
  // avant la création des étiquettes et des axes.
  resolveUnit(values: Iterable<number | null | undefined>) {
    if (this.nf.unit !== "auto") return;
    let max = 0;
    for (const v of values) if (v !== null && v !== undefined && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
    this.setUnit(autoUnit(max));
  }

  setUnit(unit: ChartConfig["unit"]) {
    this.nf = { ...this.nf, unit };
    const u = unitInfo(unit);
    this.div = u.div;
    this.unitLabel = u.label;
  }

  // Unité propre à un axe X numérique (nuages) quand l'unité est automatique.
  xUnit(values: number[]): { div: number; label: string } {
    if (this.cfg.unit !== "auto") return { div: 1, label: "" };
    let max = 0;
    for (const v of values) if (Number.isFinite(v)) max = Math.max(max, Math.abs(v));
    return unitInfo(autoUnit(max));
  }

  color(key: string, index: number): string {
    return this.cfg.colors[key] ?? this.palette[index % this.palette.length];
  }

  statusColor(key: keyof typeof STATUS_COLORS): string {
    return this.cfg.colors[key] ?? STATUS_COLORS[key];
  }

  addLegend(key: string, color: string) {
    if (!this.legend.some((l) => l.key === key)) this.legend.push({ key, color });
  }

  warn(msg: string) {
    this.warnings.push(msg);
  }

  scale() {
    const cfg = this.cfg;
    return resolveColorscale(cfg.colorscale, cfg.reverseScale, cfg.scaleFrom, cfg.scaleTo);
  }

  title(value: string | null, auto: string): string {
    return value === null ? auto : value;
  }

  baseLayout(): Partial<Layout> {
    const { cfg, ctx } = this;
    const bg = cfg.background === "custom" ? cfg.bgColor : ctx.exporting ? ctx.theme.surface : TRANSPARENT;
    const title = cfg.title.trim() || autoTitle(cfg);
    const hasTitle = cfg.showTitle && title !== "";
    const legendTop = cfg.legend === "top";
    const titleSize = cfg.fontSize + 4;
    return {
      autosize: true,
      height: cfg.height,
      paper_bgcolor: bg,
      plot_bgcolor: bg,
      font: { family: cfg.fontFamily, size: cfg.fontSize, color: this.text },
      title: hasTitle
        ? {
            text: `<b>${esc(title)}</b>`,
            x: cfg.titleAlign === "center" ? 0.5 : 0,
            xanchor: cfg.titleAlign === "center" ? "center" : "left",
            xref: cfg.titleAlign === "center" ? "paper" : "container",
            y: 1,
            yref: "container",
            yanchor: "top",
            pad: { t: 12, l: 12 },
            font: { size: titleSize },
          }
        : undefined,
      margin: {
        l: 16,
        r: 16,
        t: (hasTitle ? titleSize + 30 : 14) + (legendTop ? cfg.fontSize + 14 : 0),
        b: 16,
        pad: 2,
      },
      separators: ", ",
      colorway: this.palette,
      showlegend: cfg.legend === "hidden" ? false : undefined,
      legend: this.legendLayout(),
      hoverlabel: { font: { family: cfg.fontFamily } },
      hovermode: "closest",
      // Lu par PlotlyChart pour écarter une légende sur plusieurs lignes du
      // titre ou des libellés de l'axe X.
      meta: { legend: cfg.legend },
      uirevision: `${cfg.type}|${JSON.stringify(cfg.roles)}|${cfg.agg}|${cfg.dateBucket}|${cfg.horizontal}`,
    };
  }

  legendLayout(): Partial<Layout>["legend"] {
    const font = { size: this.cfg.fontSize - 1 };
    switch (this.cfg.legend) {
      case "bottom":
        return { orientation: "h", x: 0, xanchor: "left", y: 0, yanchor: "bottom", yref: "container", font };
      case "left":
        return { orientation: "v", x: 0, xanchor: "left", xref: "container", y: 1, yanchor: "top", font };
      case "right":
        return { orientation: "v", x: 1.02, xanchor: "left", y: 1, yanchor: "top", font };
      default:
        return { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font };
    }
  }

  axis(
    title: string,
    o: { value?: boolean; type?: LayoutAxis["type"]; angle?: boolean; reversed?: boolean } = {},
  ): Partial<LayoutAxis> {
    const cfg = this.cfg;
    const ax: Partial<LayoutAxis> = {
      title: title ? { text: esc(title), standoff: 8 } : { text: "" },
      automargin: true,
      showgrid: cfg.grid && Boolean(o.value),
      gridcolor: this.grid,
      zerolinecolor: this.grid,
      linecolor: this.grid,
      showline: !o.value,
      zeroline: Boolean(o.value),
    };
    if (o.type) ax.type = o.type;
    if (o.angle && cfg.xAngle !== null) ax.tickangle = cfg.xAngle;
    if (o.reversed) ax.autorange = "reversed";
    if (o.value) {
      ax.tickformat = d3Format(this.nf);
      ax.tickprefix = cfg.prefix;
      ax.ticksuffix = this.unitLabel + cfg.suffix;
      if (cfg.yLog) ax.type = "log";
      if (!cfg.yLog && (cfg.yMin !== null || cfg.yMax !== null)) {
        if (cfg.yMin !== null && cfg.yMax !== null) ax.range = [cfg.yMin, cfg.yMax];
        else if (cfg.yMin !== null) {
          ax.range = [cfg.yMin, null];
          ax.autorange = "max";
        } else {
          ax.range = [null, cfg.yMax];
          ax.autorange = "min";
        }
      }
    }
    return ax;
  }

  labelPosition(): "inside" | "outside" | "auto" | "none" {
    if (!this.cfg.labels) return "none";
    return this.cfg.labelPosition;
  }

  // Colonnes de valeurs (rôle y) et nom de chaque série d'un tableau croisé.
  pivot(xCol: string, opts: { forceSort?: ChartConfig["sort"]; noGroup?: boolean; single?: boolean; maxSeries?: number } = {}): Pivot {
    const { cfg, roles } = this;
    const group = opts.noGroup ? null : (roles.group[0] ?? null);
    const values = opts.single ? roles.y.slice(0, 1) : roles.y;
    const p = pivot(this.ctx.dataset, {
      x: xCol,
      xKind: this.kind(xCol),
      values,
      group,
      groupKind: group ? this.kind(group) : "category",
      agg: cfg.agg === "none" ? "sum" : cfg.agg,
      bucket: cfg.dateBucket,
      sort: opts.forceSort ?? cfg.sort,
      topN: cfg.topN,
      others: cfg.others,
      maxCategories: MAX_CATEGORIES,
      maxSeries: opts.maxSeries,
    });
    if (p.hiddenCategories) {
      this.warn(
        `${p.hiddenCategories.toLocaleString("fr-FR")} catégorie(s) non affichée(s) : seules les ${MAX_CATEGORIES} plus importantes sont tracées. Réglez « Top N » pour choisir.`,
      );
    }
    if (p.hiddenSeries) {
      this.warn(`${p.hiddenSeries} série(s) de légende non affichée(s) (25 au maximum).`);
    }
    this.resolveUnit(p.series.flatMap((s) => s.values));
    // Noms de séries
    p.series.forEach((s) => {
      if (group) return;
      s.name = values.length > 1 ? s.name : measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, values[0] ?? null);
    });
    return p;
  }

  measureTitle(): string {
    const ys = this.roles.y;
    if (ys.length > 1) return "";
    return measureLabel(this.cfg.agg === "none" ? "sum" : this.cfg.agg, ys[0] ?? null);
  }

  // Axe de catégories : continu (date, nombre) pour les courbes, discret
  // sinon, pour que « 2024 » reste une catégorie et non une graduation.
  continuousX(xCol: string): boolean {
    const k = this.kind(xCol);
    return (k === "date" && this.cfg.dateBucket === "none") || k === "number";
  }

  // ------------------------------------------------------------- comparaison

  bars() {
    const { cfg } = this;
    const horizontal = cfg.type === "bar";
    const x = this.roles.x[0];
    const p = this.pivot(x);
    if (p.categories.length === 0) return;
    const cats = p.categories.map((c) => c.label);
    const single = p.series.length === 1;
    p.series.forEach((s, i) => {
      const color = this.color(s.name, i);
      const vary = single && cfg.varyColors;
      const colors = vary ? cats.map((c, j) => this.color(c, j)) : color;
      if (vary) cats.forEach((c, j) => this.addLegend(c, this.color(c, j)));
      else this.addLegend(s.name, color);
      const vals = s.values.map(this.sv);
      const formatted = s.values.map(this.fmt);
      this.data.push({
        type: "bar",
        name: esc(s.name),
        x: horizontal ? vals : cats,
        y: horizontal ? cats : vals,
        orientation: horizontal ? "h" : "v",
        marker: { color: colors, opacity: cfg.opacity },
        customdata: formatted,
        hovertemplate: `${horizontal ? "%{y}" : "%{x}"}<br>%{customdata}<extra>%{fullData.name}</extra>`,
        text: cfg.labels ? formatted : undefined,
        textposition: this.labelPosition(),
        cliponaxis: false,
      });
    });
    const percent = cfg.barMode === "percent";
    this.layout.barmode = cfg.barMode === "percent" ? "stack" : cfg.barMode;
    this.layout.barnorm = percent ? "percent" : "";
    this.layout.bargap = cfg.barGap;
    this.layout.barcornerradius = cfg.cornerRadius;
    const valueAxis = this.axis(this.title(cfg.yTitle, percent ? "Part (%)" : this.measureTitle()), { value: true });
    if (percent) {
      valueAxis.ticksuffix = " %";
      valueAxis.tickprefix = "";
      valueAxis.tickformat = ",~f";
    }
    const catAxis = this.axis(this.title(cfg.xTitle, x), { type: "category", angle: true, reversed: horizontal });
    this.layout.xaxis = horizontal ? valueAxis : catAxis;
    this.layout.yaxis = horizontal ? catAxis : valueAxis;
  }

  lollipop() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x);
    if (p.categories.length === 0) return;
    const cats = p.categories.map((c) => c.label);
    const single = p.series.length === 1;
    p.series.forEach((s, i) => {
      const color = this.color(s.name, i);
      const vary = single && cfg.varyColors;
      if (vary) cats.forEach((c, j) => this.addLegend(c, this.color(c, j)));
      else this.addLegend(s.name, color);
      const vals = s.values.map(this.sv);
      const formatted = s.values.map(this.fmt);
      this.data.push({
        type: "scatter",
        mode: cfg.labels ? "text+markers" : "markers",
        name: esc(s.name),
        x: cats,
        y: vals,
        marker: {
          color: vary ? cats.map((c, j) => this.color(c, j)) : color,
          size: cfg.markerSize,
          symbol: cfg.markerSymbol,
          line: { width: 0 },
        },
        // La tige est une barre d'erreur asymétrique qui descend (ou monte)
        // jusqu'à zéro.
        error_y: {
          type: "data",
          symmetric: false,
          array: vals.map((v) => (v !== null && v < 0 ? -v : 0)),
          arrayminus: vals.map((v) => (v !== null && v > 0 ? v : 0)),
          width: 0,
          thickness: Math.max(1.5, cfg.lineWidth),
          color,
        },
        text: cfg.labels ? formatted : undefined,
        textposition: "top center",
        customdata: formatted,
        hovertemplate: "%{x}<br>%{customdata}<extra>%{fullData.name}</extra>",
        cliponaxis: false,
      });
    });
    if (p.series.length > 1) this.layout.scattermode = "group";
    this.layout.xaxis = this.axis(this.title(cfg.xTitle, x), { type: "category", angle: true });
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, this.measureTitle()), { value: true });
  }

  pareto() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x, { forceSort: "value-desc", noGroup: true, single: true });
    if (p.categories.length === 0) return;
    const cats = p.categories.map((c) => c.label);
    const s = p.series[0];
    const total = s.values.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0);
    let run = 0;
    const cum = s.values.map((v) => {
      run += Math.max(0, v ?? 0);
      return total ? (run / total) * 100 : 0;
    });
    const barColor = this.color(s.name, 0);
    const lineColor = this.color("Cumul (%)", 1);
    this.addLegend(s.name, barColor);
    this.addLegend("Cumul (%)", lineColor);
    const formatted = s.values.map(this.fmt);
    this.data.push(
      {
        type: "bar",
        name: esc(s.name),
        x: cats,
        y: s.values.map(this.sv),
        marker: { color: barColor, opacity: cfg.opacity },
        customdata: formatted,
        hovertemplate: "%{x}<br>%{customdata}<extra>%{fullData.name}</extra>",
        text: cfg.labels ? formatted : undefined,
        textposition: this.labelPosition(),
        cliponaxis: false,
      },
      {
        type: "scatter",
        mode: cfg.markers ? "lines+markers" : "lines",
        name: "Cumul (%)",
        x: cats,
        y: cum,
        yaxis: "y2",
        line: { color: lineColor, width: cfg.lineWidth, dash: cfg.dash, shape: cfg.lineShape === "spline" ? "spline" : "linear" },
        marker: { color: lineColor, size: Math.max(4, cfg.markerSize - 2), symbol: cfg.markerSymbol },
        hovertemplate: "%{x}<br>Cumul : %{y:.1f} %<extra></extra>",
      },
    );
    this.layout.bargap = cfg.barGap;
    this.layout.barcornerradius = cfg.cornerRadius;
    this.layout.xaxis = this.axis(this.title(cfg.xTitle, x), { type: "category", angle: true });
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, s.name), { value: true });
    this.layout.yaxis2 = {
      ...this.axis(this.title(cfg.y2Title, "Cumul (%)")),
      overlaying: "y",
      side: "right",
      range: [0, 105],
      tickmode: "linear",
      tick0: 0,
      dtick: 20,
      ticksuffix: " %",
      showgrid: false,
      showline: false,
      zeroline: false,
    };
    this.layout.shapes = [
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y2",
        y0: 80,
        y1: 80,
        line: { color: this.ctx.theme.muted, width: 1, dash: "dot" },
      },
    ];
  }

  combo() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x, { noGroup: true });
    if (p.categories.length === 0) return;
    const continuous = this.continuousX(x);
    const xs = p.categories.map((c) => (continuous ? c.value : c.label));
    const y1: string[] = [];
    const y2: string[] = [];
    const axisOf = (name: string, i: number) => cfg.seriesAxis[name] ?? (i === 0 ? "y" : "y2");
    // Chaque axe a sa propre unité (montants en Md à gauche, effectifs à droite…).
    const unitFor = (axis: "y" | "y2") => {
      if (cfg.unit !== "auto") return cfg.unit;
      const vals = p.series.filter((s, i) => axisOf(s.name, i) === axis).flatMap((s) => s.values);
      return autoUnit(vals.reduce<number>((m, v) => (v === null ? m : Math.max(m, Math.abs(v))), 0));
    };
    const units = { y: unitFor("y"), y2: unitFor("y2") };
    p.series.forEach((s, i) => {
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      const render = cfg.seriesRender[s.name] ?? (i === 0 ? "bar" : "line");
      const axis = axisOf(s.name, i);
      (axis === "y2" ? y2 : y1).push(s.name);
      const nf = { ...this.nf, unit: units[axis] };
      const div = unitInfo(units[axis]).div;
      const formatted = s.values.map((v) => formatNumber(v, nf));
      const common = {
        name: esc(s.name),
        x: xs,
        y: s.values.map((v) => (v === null ? null : v / div)),
        yaxis: axis,
        customdata: formatted,
        hovertemplate: "%{x}<br>%{customdata}<extra>%{fullData.name}</extra>",
        text: cfg.labels ? formatted : undefined,
      };
      if (render === "bar") {
        this.data.push({
          type: "bar",
          ...common,
          marker: { color, opacity: cfg.opacity },
          textposition: this.labelPosition(),
          cliponaxis: false,
          offsetgroup: axis,
        });
      } else {
        this.data.push({
          type: "scatter",
          ...common,
          mode: (cfg.markers ? "lines+markers" : "lines") + (cfg.labels ? "+text" : ""),
          textposition: "top center",
          line: { color, width: cfg.lineWidth, dash: cfg.dash, shape: cfg.lineShape },
          marker: { color, size: cfg.markerSize, symbol: cfg.markerSymbol },
          fill: render === "area" ? "tozeroy" : "none",
          fillcolor: withAlpha(color, Math.min(0.5, cfg.opacity * 0.4)),
          connectgaps: true,
        });
      }
    });
    this.layout.barmode = "group";
    this.layout.bargap = cfg.barGap;
    this.layout.barcornerradius = cfg.cornerRadius;
    this.layout.xaxis = this.axis(this.title(cfg.xTitle, x), {
      type: continuous ? (this.kind(x) === "date" ? "date" : "linear") : "category",
      angle: true,
    });
    this.setUnit(units.y);
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, y1.join(", ")), { value: true });
    if (y2.length) {
      this.setUnit(units.y2);
      this.layout.yaxis2 = {
        ...this.axis(this.title(cfg.y2Title, y2.join(", ")), { value: true }),
        overlaying: "y",
        side: "right",
        showgrid: false,
        // Plotly aligne sinon les graduations sur l'axe principal (valeurs non rondes).
        tickmode: "auto",
      };
    }
  }

  // --------------------------------------------------------------- évolution

  lines() {
    const { cfg } = this;
    const area = cfg.type === "area";
    const x = this.roles.x[0];
    const continuous = this.continuousX(x);
    let xs: (string | number)[];
    let series: { name: string; values: (number | null)[] }[];
    if (cfg.agg === "none") {
      if (this.roles.group.length) this.warn("La légende n'est pas utilisée avec des valeurs brutes : choisissez un calcul (somme, moyenne…).");
      if (this.roles.y.length === 0) {
        this.warn("Choisissez une colonne de valeurs pour tracer des valeurs brutes.");
        return;
      }
      const raw = rawPoints(this.ctx.dataset, x, this.kind(x), this.roles.y);
      if (raw.x.length > MAX_POINTS) this.warn(`${raw.x.length.toLocaleString("fr-FR")} points tracés : un regroupement (somme par mois…) serait plus lisible.`);
      xs = raw.x;
      series = raw.series.map((s) => ({ name: s.name, values: s.y }));
      this.resolveUnit(series.flatMap((s) => s.values));
    } else {
      const p = this.pivot(x);
      xs = p.categories.map((c) => (continuous ? c.value : c.label));
      series = p.series;
    }
    if (xs.length === 0) return;
    const stacked = area && (cfg.barMode === "stack" || cfg.barMode === "percent");
    series.forEach((s, i) => {
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      const formatted = s.values.map(this.fmt);
      this.data.push({
        type: xs.length > MAX_POINTS ? "scattergl" : "scatter",
        name: esc(s.name),
        x: xs,
        y: s.values.map(this.sv),
        mode: (cfg.markers ? "lines+markers" : "lines") + (cfg.labels ? "+text" : ""),
        line: { color, width: cfg.lineWidth, dash: cfg.dash, shape: cfg.lineShape },
        marker: { color, size: cfg.markerSize, symbol: cfg.markerSymbol },
        text: cfg.labels ? formatted : undefined,
        textposition: "top center",
        customdata: formatted,
        hovertemplate: "%{x}<br>%{customdata}<extra>%{fullData.name}</extra>",
        connectgaps: true,
        ...(area
          ? stacked
            ? {
                stackgroup: "one",
                groupnorm: cfg.barMode === "percent" ? ("percent" as const) : ("" as const),
                fillcolor: withAlpha(color, cfg.opacity),
              }
            : { fill: "tozeroy" as const, fillcolor: withAlpha(color, cfg.opacity * 0.6) }
          : {}),
      } as Data);
    });
    const kind = this.kind(x);
    this.layout.xaxis = this.axis(this.title(cfg.xTitle, x), {
      type: continuous ? (kind === "date" ? "date" : "linear") : "category",
      angle: true,
    });
    const percent = area && cfg.barMode === "percent";
    const yAxis = this.axis(this.title(cfg.yTitle, percent ? "Part (%)" : this.measureTitle()), { value: true });
    if (percent) {
      yAxis.ticksuffix = " %";
      yAxis.tickprefix = "";
      yAxis.tickformat = ",~f";
    }
    this.layout.yaxis = yAxis;
    this.layout.hovermode = "x unified";
  }

  waterfall() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x, { noGroup: true, single: true });
    if (p.categories.length === 0) return;
    const s = p.series[0];
    const labels = p.categories.map((c) => c.label);
    const values = s.values.map((v) => v ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const up = this.statusColor("Hausse");
    const down = this.statusColor("Baisse");
    const tot = this.statusColor("Total");
    this.addLegend("Hausse", up);
    this.addLegend("Baisse", down);
    if (cfg.showTotal) this.addLegend("Total", tot);
    const formatted = values.map((v) => (v > 0 ? "+" : "") + this.fmt(v));
    const xs = cfg.showTotal ? [...labels, "Total"] : labels;
    this.data.push({
      type: "waterfall",
      name: esc(s.name),
      x: xs,
      y: [...values.map((v) => v / this.div), ...(cfg.showTotal ? [0] : [])],
      measure: [...values.map(() => "relative"), ...(cfg.showTotal ? ["total"] : [])],
      text: cfg.labels ? [...formatted, ...(cfg.showTotal ? [this.fmt(total)] : [])] : undefined,
      textposition: this.labelPosition() === "auto" ? "outside" : this.labelPosition(),
      customdata: [...formatted, ...(cfg.showTotal ? [this.fmt(total)] : [])],
      hovertemplate: "%{x}<br>%{customdata}<extra></extra>",
      connector: { line: { color: this.ctx.theme.muted, width: 1, dash: "dot" } },
      increasing: { marker: { color: up } },
      decreasing: { marker: { color: down } },
      totals: { marker: { color: tot } },
      cliponaxis: false,
    });
    this.layout.showlegend = false;
    this.layout.waterfallgap = cfg.barGap;
    this.layout.xaxis = this.axis(this.title(cfg.xTitle, x), { type: "category", angle: true });
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, s.name), { value: true });
  }

  candlestick() {
    const { cfg, roles } = this;
    const x = roles.x[0];
    const kind = this.kind(x);
    const groups = new Map<string, { k: ReturnType<typeof axisKey>; o: number | null; h: number; l: number; c: number | null }>();
    for (const r of this.ctx.dataset.rows) {
      const k = axisKey(r[x], kind, cfg.dateBucket);
      if (!k) continue;
      const o = toNumber(r[roles.open[0]]);
      const h = toNumber(r[roles.high[0]]);
      const l = toNumber(r[roles.low[0]]);
      const c = toNumber(r[roles.close[0]]);
      let g = groups.get(k.key);
      if (!g) groups.set(k.key, (g = { k, o: null, h: -Infinity, l: Infinity, c: null }));
      if (g.o === null && o !== null) g.o = o;
      if (c !== null) g.c = c;
      if (h !== null) g.h = Math.max(g.h, h);
      if (l !== null) g.l = Math.min(g.l, l);
    }
    const rows = Array.from(groups.values())
      .filter((g) => g.o !== null && g.c !== null && Number.isFinite(g.h) && Number.isFinite(g.l))
      .sort((a, b) => {
        const sa = a.k!.sort;
        const sb = b.k!.sort;
        return typeof sa === "number" && typeof sb === "number" ? sa - sb : String(sa).localeCompare(String(sb), "fr", { numeric: true });
      });
    if (rows.length === 0) return;
    this.resolveUnit(rows.map((g) => g.h));
    const continuous = this.continuousX(x);
    const up = this.statusColor("Hausse");
    const down = this.statusColor("Baisse");
    this.addLegend("Hausse", up);
    this.addLegend("Baisse", down);
    this.data.push({
      type: "candlestick",
      name: "Cours",
      x: rows.map((g) => (continuous ? g.k!.value : g.k!.label)),
      open: rows.map((g) => g.o! / this.div),
      high: rows.map((g) => g.h / this.div),
      low: rows.map((g) => g.l / this.div),
      close: rows.map((g) => g.c! / this.div),
      increasing: { line: { color: up }, fillcolor: up },
      decreasing: { line: { color: down }, fillcolor: down },
    });
    this.layout.xaxis = {
      ...this.axis(this.title(cfg.xTitle, x), { type: continuous ? (kind === "date" ? "date" : "linear") : "category", angle: true }),
      rangeslider: { visible: false },
    };
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, roles.close[0]), { value: true });
  }

  gantt() {
    const { cfg, roles } = this;
    const task = roles.x[0];
    const group = roles.group[0] ?? null;
    const frDate = (d: Date) => d.toLocaleDateString("fr-FR");
    type Row = { task: string; start: Date; end: Date; group: string };
    const rows: Row[] = [];
    let invalid = 0;
    for (const r of this.ctx.dataset.rows) {
      const t = axisKey(r[task], this.kind(task), "none");
      const s = parseDate(r[roles.start[0]]);
      const e = parseDate(r[roles.end[0]]);
      if (!t || !s || !e) continue;
      if (e < s) {
        invalid++;
        continue;
      }
      const g = group ? (axisKey(r[group], this.kind(group), "none")?.label ?? "(vide)") : "";
      rows.push({ task: t.label, start: s, end: e, group: g });
    }
    if (invalid) this.warn(`${invalid} ligne(s) ignorée(s) : date de fin antérieure à la date de début.`);
    if (rows.length > 300) {
      this.warn(`${rows.length} tâches : seules les 300 premières (par date de début) sont affichées.`);
    }
    rows.sort((a, b) => a.start.getTime() - b.start.getTime());
    const shown = rows.slice(0, 300);
    if (shown.length === 0) return;
    const groups = Array.from(new Set(shown.map((r) => r.group)));
    groups.forEach((g, i) => {
      const name = g || "Tâches";
      const color = this.color(name, i);
      this.addLegend(name, color);
      const sub = shown.filter((r) => r.group === g);
      const DAY = 86400000;
      this.data.push({
        type: "bar",
        orientation: "h",
        name: esc(name),
        y: sub.map((r) => r.task),
        base: sub.map((r) => isoDate(r.start)),
        x: sub.map((r) => Math.max(r.end.getTime() - r.start.getTime(), DAY / 2)),
        marker: { color, opacity: cfg.opacity },
        customdata: sub.map((r) => [frDate(r.start), frDate(r.end), String(Math.round((r.end.getTime() - r.start.getTime()) / DAY))]),
        hovertemplate: "<b>%{y}</b><br>Du %{customdata[0]} au %{customdata[1]}<br>%{customdata[2]} jour(s)<extra>%{fullData.name}</extra>",
        text: cfg.labels ? sub.map((r) => `${Math.round((r.end.getTime() - r.start.getTime()) / DAY)} j`) : undefined,
        textposition: cfg.labels ? "inside" : "none",
      });
    });
    if (groups.length === 1 && !group) this.layout.showlegend = false;
    this.layout.barmode = "overlay";
    this.layout.bargap = cfg.barGap;
    this.layout.barcornerradius = cfg.cornerRadius;
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, "")), type: "date", showgrid: cfg.grid };
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, ""), { type: "category", reversed: true });
  }

  // ------------------------------------------------- répartition & hiérarchie

  pie() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x, { noGroup: true, single: true, forceSort: cfg.sort === "auto" ? "value-desc" : cfg.sort });
    const s = p.series[0];
    const items = p.categories
      .map((c, j) => ({ label: c.label, v: s?.values[j] ?? null }))
      .filter((it) => it.v !== null && it.v > 0);
    if (p.categories.some((_, j) => (s?.values[j] ?? 0) < 0)) {
      this.warn("Les valeurs négatives ne peuvent pas figurer dans un graphique en secteurs : elles sont ignorées.");
    }
    if (items.length === 0) return;
    const colors = items.map((it, j) => this.color(it.label, j));
    items.forEach((it, j) => this.addLegend(it.label, colors[j]));
    const formatted = items.map((it) => this.fmt(it.v));
    const template: Record<ChartConfig["pieText"], string> = {
      percent: "%{percent}",
      value: "%{customdata}",
      label: "%{label}",
      "label+percent": "%{label}<br>%{percent}",
      "label+value": "%{label}<br>%{customdata}",
    };
    this.data.push({
      type: "pie",
      name: esc(s.name),
      labels: items.map((it) => it.label),
      values: items.map((it) => it.v!),
      hole: cfg.hole,
      sort: false,
      direction: "clockwise",
      marker: { colors, line: { color: this.surface, width: 1.5 } },
      customdata: formatted,
      texttemplate: cfg.labels ? template[cfg.pieText] : "",
      textinfo: cfg.labels ? undefined : "none",
      textposition: "auto",
      insidetextorientation: "horizontal",
      hovertemplate: "%{label}<br>%{customdata} · %{percent}<extra></extra>",
      opacity: cfg.opacity,
    });
    this.layout.uniformtext = { mode: "hide", minsize: Math.max(8, cfg.fontSize - 3) };
    if (cfg.hole >= 0.35) {
      const total = items.reduce((a, it) => a + (it.v ?? 0), 0);
      this.layout.annotations = [
        {
          text: `<b>${esc(this.fmt(total))}</b><br><span style="font-size:${cfg.fontSize - 1}px">Total</span>`,
          showarrow: false,
          x: 0.5,
          y: 0.5,
          xref: "paper",
          yref: "paper",
          font: { size: cfg.fontSize + 6, color: this.text },
        },
      ];
    }
  }

  hierarchyChart() {
    const { cfg, roles } = this;
    const path = roles.path.map((c) => ({ col: c, kind: this.kind(c) }));
    const value = roles.y[0] ?? null;
    const h = hierarchy(this.ctx.dataset, path, value, cfg.agg);
    if (h.truncated) this.warn("Hiérarchie très détaillée : seuls les 3 000 éléments les plus importants sont affichés.");
    if (h.ids.length === 0) return;
    const ROOT = "\u0001total"; // identifiant hors de portée des libellés réels
    const tops = h.parents.reduce((n, p) => n + (p === "" ? 1 : 0), 0);
    if (tops > 1) {
      const total = h.values.reduce((s, v, i) => s + (h.parents[i] === "" ? v : 0), 0);
      h.parents = h.parents.map((p) => (p === "" ? ROOT : p));
      h.ids.unshift(ROOT);
      h.labels.unshift("Total");
      h.parents.unshift("");
      h.values.unshift(total);
      h.rootOf.unshift("");
    }
    // Unité choisie d'après les éléments, pas d'après le total général.
    this.resolveUnit(h.values.filter((_, i) => h.ids[i] !== ROOT));
    const formatted = h.values.map(this.fmt);
    const byValue = cfg.varyColors;
    let marker: Record<string, unknown>;
    if (byValue) {
      const sc = this.scale();
      marker = { colors: h.values, ...sc, showscale: true, colorbar: { title: { text: esc(measureLabel(cfg.agg, value)) }, tickformat: d3Format(this.nf) } };
    } else {
      const rootColor = new Map(h.roots.map((r, i) => [r, this.color(r, i)]));
      h.roots.forEach((r) => this.addLegend(r, rootColor.get(r)!));
      marker = {
        colors: h.ids.map((id, i) =>
          id === ROOT ? this.grid : lighten(rootColor.get(h.rootOf[i])!, (id.split(" › ").length - 1) * 0.18),
        ),
      };
    }
    const trace = {
      type: cfg.type as "treemap" | "sunburst" | "icicle",
      ids: h.ids,
      labels: h.labels,
      parents: h.parents,
      values: h.values,
      branchvalues: "total" as const,
      marker: { ...marker, line: { color: this.surface, width: 1 } },
      customdata: formatted,
      texttemplate: cfg.labels ? "%{label}<br>%{customdata}" : "%{label}",
      hovertemplate: "<b>%{label}</b><br>%{customdata}<br>%{percentRoot:.1%} du total<extra></extra>",
      sort: true,
      opacity: cfg.opacity,
    };
    this.data.push(trace as Data);
    this.layout.showlegend = false;
    this.layout.margin = { ...this.layout.margin, l: 8, r: 8, b: 8 };
  }

  funnel() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x, { noGroup: true, single: true });
    const s = p.series[0];
    if (!s || p.categories.length === 0) return;
    const cats = p.categories.map((c) => c.label);
    const color = this.color(s.name, 0);
    const colors = cfg.varyColors ? cats.map((c, j) => this.color(c, j)) : color;
    if (cfg.varyColors) cats.forEach((c, j) => this.addLegend(c, this.color(c, j)));
    else this.addLegend(s.name, color);
    const formatted = s.values.map(this.fmt);
    this.data.push({
      type: "funnel",
      name: esc(s.name),
      y: cats,
      x: s.values.map(this.sv),
      marker: { color: colors },
      opacity: cfg.opacity,
      customdata: formatted,
      texttemplate: cfg.labels ? "%{customdata}<br>%{percentInitial:.0%}" : "",
      textinfo: cfg.labels ? undefined : "none",
      textposition: "inside",
      hovertemplate: "%{y}<br>%{customdata}<br>%{percentInitial:.1%} de la 1re étape<br>%{percentPrevious:.1%} de l'étape précédente<extra></extra>",
      connector: { fillcolor: withAlpha(Array.isArray(colors) ? colors[0] : color, 0.15), line: { width: 0 } },
    });
    this.layout.showlegend = false;
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, ""), { type: "category" });
    this.layout.xaxis = { ...this.axis(""), visible: false };
  }

  // -------------------------------------------------------------- distribution

  numericSeries(maxGroups = 20) {
    const { roles } = this;
    const group = roles.group[0] ? { col: roles.group[0], kind: this.kind(roles.group[0]) } : null;
    const cat = roles.x[0] && ["box", "violin", "strip"].includes(this.cfg.type) ? { col: roles.x[0], kind: this.kind(roles.x[0]) } : null;
    if (roles.y.length > 1 || !group) {
      if (roles.y.length > 1 && group) this.warn("Avec plusieurs variables, la couleur suit la variable : la légende par sous-groupe est ignorée.");
      return roles.y.map((col) => {
        const g = numericGroups(this.ctx.dataset, col, null, cat).groups[0];
        return { name: col, values: g?.values ?? [], cats: g?.cats };
      });
    }
    const res = numericGroups(this.ctx.dataset, roles.y[0], group, cat, maxGroups);
    if (res.hidden) this.warn(`${res.hidden} sous-groupe(s) non affiché(s) (${maxGroups} au maximum).`);
    return res.groups;
  }

  // Variables numériques mises à l'échelle (k, M, Md) pour l'axe des valeurs
  // des histogrammes, densités et ECDF.
  scaledNumericSeries() {
    const raw = this.numericSeries();
    const vu = this.xUnit(raw.flatMap((s) => s.values));
    const series = vu.div === 1 ? raw : raw.map((s) => ({ ...s, values: s.values.map((v) => v / vu.div) }));
    return { series, suffix: vu.label };
  }

  histogram() {
    const { cfg } = this;
    const { series, suffix } = this.scaledNumericSeries();
    const all = series.flatMap((s) => s.values);
    const bins = histogramBins(all, cfg.bins);
    if (!bins || all.length === 0) return;
    const horizontal = cfg.horizontal;
    const norm = cfg.histNorm === "percent" ? "percent" : cfg.histNorm === "density" ? "probability density" : "";
    series.forEach((s, i) => {
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      this.data.push({
        type: "histogram",
        name: esc(s.name),
        ...(horizontal ? { y: s.values, ybins: bins } : { x: s.values, xbins: bins }),
        histnorm: norm,
        cumulative: { enabled: cfg.cumulative },
        marker: { color, opacity: cfg.opacity, line: { color: this.surface, width: 0.5 } },
        texttemplate: cfg.labels ? (cfg.histNorm === "count" ? "%{value}" : "%{value:.1f}") : undefined,
        textposition: cfg.labels ? "outside" : undefined,
        cliponaxis: false,
      } as Data);
      if (cfg.kde && !cfg.cumulative && s.values.length > 1) {
        const d = kde(s.values, cfg.bandwidth);
        const factor = cfg.histNorm === "density" ? 1 : cfg.histNorm === "percent" ? 100 * bins.size : s.values.length * bins.size;
        const ys = d.y.map((v) => v * factor);
        this.data.push({
          type: "scatter",
          mode: "lines",
          name: `Densité — ${esc(s.name)}`,
          ...(horizontal ? { x: ys, y: d.x } : { x: d.x, y: ys }),
          line: { color, width: cfg.lineWidth, shape: "spline" },
          hoverinfo: "skip",
          showlegend: false,
        });
      }
    });
    this.layout.barmode = cfg.barMode === "percent" ? "stack" : cfg.barMode;
    this.layout.bargap = cfg.barGap;
    const yLabel = cfg.cumulative ? "Effectif cumulé" : cfg.histNorm === "percent" ? "% des observations" : cfg.histNorm === "density" ? "Densité" : "Effectif";
    const valueName = series.length === 1 || this.roles.y.length === 1 ? this.roles.y[0] : "Valeur";
    const countAxis = { ...this.axis(this.title(cfg.yTitle, yLabel), { value: true }), tickprefix: "", ticksuffix: cfg.histNorm === "percent" ? " %" : "", tickformat: ",~f" };
    const varAxis = { ...this.axis(this.title(cfg.xTitle, valueName)), showgrid: false, tickformat: ",~f", ticksuffix: suffix };
    this.layout.xaxis = horizontal ? countAxis : varAxis;
    this.layout.yaxis = horizontal ? varAxis : countAxis;
  }

  boxLike() {
    const { cfg } = this;
    const series = this.numericSeries();
    if (series.every((s) => s.values.length === 0)) return;
    const horizontal = cfg.horizontal;
    const hasCats = Boolean(this.roles.x[0]);
    const pointsMode = cfg.boxPoints === "none" ? false : cfg.boxPoints === "all" ? "all" : "outliers";
    let sampled = false;
    this.resolveUnit(series.flatMap((s) => s.values));
    series.forEach((s, i) => {
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      let values = s.values;
      let cats = s.cats;
      if (cfg.type === "strip" && values.length > 5000) {
        sampled = true;
        const step = values.length / 5000;
        const idx = Array.from({ length: 5000 }, (_, k) => Math.floor(k * step));
        values = idx.map((k) => s.values[k]);
        cats = s.cats ? idx.map((k) => s.cats![k]) : undefined;
      }
      const pos = hasCats ? cats : undefined;
      const scaled = this.div === 1 ? values : values.map((v) => v / this.div);
      const xy = horizontal ? { x: scaled, y: pos } : { y: scaled, x: pos };
      if (cfg.type === "violin") {
        this.data.push({
          type: "violin",
          name: esc(s.name),
          ...xy,
          orientation: horizontal ? "h" : "v",
          line: { color },
          fillcolor: withAlpha(color, 0.35 * cfg.opacity + 0.1),
          marker: { color, opacity: cfg.opacity },
          box: { visible: true, width: 0.15 },
          meanline: { visible: cfg.showMean },
          points: pointsMode,
          spanmode: "soft",
          scalegroup: s.name,
        });
      } else if (cfg.type === "strip") {
        this.data.push({
          type: "box",
          name: esc(s.name),
          ...xy,
          orientation: horizontal ? "h" : "v",
          boxpoints: "all",
          jitter: 0.6,
          pointpos: 0,
          fillcolor: TRANSPARENT,
          line: { width: 0, color: TRANSPARENT },
          marker: { color, size: cfg.markerSize, opacity: cfg.opacity, symbol: cfg.markerSymbol },
          hoveron: "points",
        });
      } else {
        this.data.push({
          type: "box",
          name: esc(s.name),
          ...xy,
          orientation: horizontal ? "h" : "v",
          boxpoints: pointsMode,
          jitter: 0.35,
          pointpos: cfg.boxPoints === "all" ? -1.6 : 0,
          boxmean: cfg.showMean,
          notched: cfg.notched,
          line: { color },
          fillcolor: withAlpha(color, 0.35 * cfg.opacity + 0.1),
          marker: { color, opacity: cfg.opacity, size: 5 },
        });
      }
    });
    if (sampled) this.warn("Plus de 5 000 points par série : un échantillon régulier de 5 000 points est affiché.");
    if (hasCats && series.length > 1) {
      if (cfg.type === "violin") this.layout.violinmode = "group";
      else this.layout.boxmode = "group";
    }
    const valueTitle = this.roles.y.length === 1 ? this.roles.y[0] : "Valeur";
    const valueAxis = this.axis(this.title(cfg.yTitle, valueTitle), { value: true });
    const catAxis = this.axis(this.title(cfg.xTitle, this.roles.x[0] ?? ""), { type: "category", angle: true });
    this.layout.xaxis = horizontal ? valueAxis : catAxis;
    this.layout.yaxis = horizontal ? catAxis : valueAxis;
    if (!hasCats && series.length === 1) this.layout.showlegend = false;
  }

  density() {
    const { cfg } = this;
    const { series, suffix } = this.scaledNumericSeries();
    let any = false;
    series.forEach((s, i) => {
      const d = kde(s.values, cfg.bandwidth);
      if (d.x.length === 0) return;
      any = true;
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      this.data.push({
        type: "scatter",
        mode: "lines",
        name: esc(s.name),
        x: d.x,
        y: d.y,
        line: { color, width: cfg.lineWidth, dash: cfg.dash, shape: "spline" },
        fill: cfg.fill ? "tozeroy" : "none",
        fillcolor: withAlpha(color, cfg.opacity),
        hovertemplate: "%{x:,.4~g}<br>densité : %{y:.3~g}<extra>%{fullData.name}</extra>",
      });
    });
    if (!any) return;
    const valueTitle = this.roles.y.length === 1 ? this.roles.y[0] : "Valeur";
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, valueTitle)), tickformat: ",~f", ticksuffix: suffix };
    this.layout.yaxis = { ...this.axis(this.title(cfg.yTitle, "Densité"), { value: true }), tickformat: ".2~g", tickprefix: "", ticksuffix: "" };
  }

  ecdfChart() {
    const { cfg } = this;
    const { series, suffix } = this.scaledNumericSeries();
    let any = false;
    series.forEach((s, i) => {
      const d = ecdf(s.values);
      if (d.x.length === 0) return;
      any = true;
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      this.data.push({
        type: "scatter",
        mode: "lines",
        name: esc(s.name),
        x: d.x,
        y: d.y,
        line: { color, width: cfg.lineWidth, dash: cfg.dash, shape: cfg.lineShape === "spline" ? "spline" : cfg.lineShape },
        hovertemplate: "≤ %{x:,.4~g} : %{y:.1f} %<extra>%{fullData.name}</extra>",
      });
    });
    if (!any) return;
    const valueTitle = this.roles.y.length === 1 ? this.roles.y[0] : "Valeur";
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, valueTitle)), tickformat: ",~f", ticksuffix: suffix };
    this.layout.yaxis = { ...this.axis(this.title(cfg.yTitle, "Part cumulée (%)"), { value: true }), range: [0, 101], autorange: false, ticksuffix: " %", tickprefix: "", tickformat: ",~f" };
  }

  // ---------------------------------------------------------------- relations

  // Points (x, y[, taille, z]) d'un nuage, découpés par couleur.
  points(ys: string[], extra: { size?: string; z?: string } = {}) {
    const { roles, ctx } = this;
    const x = roles.x[0];
    const xKind = this.kind(x);
    const group = roles.group[0] ?? null;
    const groupKind = group ? this.kind(group) : "category";
    const numericColor = group !== null && groupKind === "number";
    type S = { name: string; x: (number | string)[]; xNum: number[]; y: number[]; size: number[]; z: number[]; color: number[] };
    const series = new Map<string, S>();
    const order: string[] = [];
    const get = (name: string) => {
      let s = series.get(name);
      if (!s) {
        series.set(name, (s = { name, x: [], xNum: [], y: [], size: [], z: [], color: [] }));
        order.push(name);
      }
      return s;
    };
    for (const r of ctx.dataset.rows) {
      let xv: number | string;
      let xn: number;
      if (xKind === "date") {
        const d = parseDate(r[x]);
        if (!d) continue;
        xv = isoDate(d);
        xn = d.getTime();
      } else {
        const n = toNumber(r[x]);
        if (n === null) continue;
        xv = xn = n;
      }
      const size = extra.size ? toNumber(r[extra.size]) : 0;
      const z = extra.z ? toNumber(r[extra.z]) : 0;
      if (size === null || z === null) continue;
      let gName = "";
      let cval = 0;
      if (group) {
        if (isEmpty(r[group])) continue;
        if (numericColor) {
          const n = toNumber(r[group]);
          if (n === null) continue;
          cval = n;
        } else {
          gName = axisKey(r[group], groupKind, "none")?.label ?? "";
        }
      }
      for (const col of ys) {
        const yv = toNumber(r[col]);
        if (yv === null) continue;
        const key = ys.length > 1 ? col : group && !numericColor ? gName : col;
        const s = get(key);
        s.x.push(xv);
        s.xNum.push(xn);
        s.y.push(yv);
        s.size.push(size);
        s.z.push(z);
        s.color.push(cval);
      }
    }
    let list = order.map((k) => series.get(k)!);
    if (group && !numericColor && ys.length === 1) {
      list.sort((a, b) => b.y.length - a.y.length);
      if (list.length > 20) {
        this.warn(`${list.length - 20} modalité(s) de couleur non affichée(s) (20 au maximum).`);
        list = list.slice(0, 20);
      }
    }
    return { list, numericColor, group, xKind };
  }

  scatter() {
    const { cfg, roles } = this;
    const bubble = cfg.type === "bubble";
    const ys = bubble ? roles.y.slice(0, 1) : roles.y;
    const sizeCol = bubble ? roles.size[0] : undefined;
    const { list, numericColor, group, xKind } = this.points(ys, { size: sizeCol });
    const total = list.reduce((a, s) => a + s.y.length, 0);
    if (total === 0) return;
    this.resolveUnit(list.flatMap((s) => s.y));
    const xu = xKind === "date" ? { div: 1, label: "" } : this.xUnit(list.flatMap((s) => s.xNum));
    const gl = total > 5000 && !bubble;
    const maxSize = Math.max(1, ...list.flatMap((s) => s.size.map(Math.abs)));
    const sc = this.scale();
    list.forEach((s, i) => {
      const color = this.color(s.name, i);
      if (!numericColor) this.addLegend(s.name, color);
      const marker: Record<string, unknown> = {
        color: numericColor ? s.color : color,
        size: bubble ? s.size.map(Math.abs) : cfg.markerSize,
        symbol: cfg.markerSymbol,
        opacity: cfg.opacity,
        line: { width: bubble ? 1 : 0.5, color: this.surface },
      };
      if (bubble) {
        marker.sizemode = "area";
        marker.sizeref = (2 * maxSize) / Math.pow(cfg.maxBubble, 2);
        marker.sizemin = 3;
      }
      if (numericColor) {
        Object.assign(marker, sc, { showscale: i === 0, colorbar: { title: { text: esc(group!) }, thickness: 14 } });
      }
      const formatted = cfg.labels ? s.y.map(this.fmt) : undefined;
      this.data.push({
        type: gl ? "scattergl" : "scatter",
        mode: cfg.labels ? "text+markers" : "markers",
        name: esc(s.name),
        x: xKind === "date" ? s.x : s.xNum.map((v) => v / xu.div),
        y: s.y.map((v) => v / this.div),
        marker,
        text: formatted,
        textposition: "top center",
        customdata: bubble ? s.size.map(this.fmt) : undefined,
        hovertemplate: bubble ? `%{x}<br>%{y}<br>${tpl(sizeCol ?? "")} : %{customdata}<extra>%{fullData.name}</extra>` : undefined,
      } as Data);
      if (cfg.trend !== "none" && !bubble) {
        const t = fitTrend(s.xNum, s.y, cfg.trend, cfg.movingWindow);
        if (t) {
          this.data.push({
            type: "scatter",
            mode: "lines",
            name: `${list.length > 1 ? esc(s.name) + " — " : "Tendance : "}${esc(t.label)}`,
            x: xKind === "date" ? t.x.map((v) => isoDate(new Date(v))) : t.x.map((v) => v / xu.div),
            y: t.y.map((v) => v / this.div),
            line: { color: numericColor ? this.ctx.theme.text : color, width: Math.max(1.5, cfg.lineWidth), dash: "dash" },
            hoverinfo: "skip",
          });
        }
      }
    });
    if (list.length === 1 && cfg.trend === "none" && !numericColor) this.layout.showlegend = false;
    const yTitle = ys.length === 1 ? ys[0] : "";
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, roles.x[0])), showgrid: cfg.grid, ...(xKind === "date" ? { type: "date" as const } : { tickformat: ",~f", ticksuffix: xu.label }) };
    this.layout.yaxis = this.axis(this.title(cfg.yTitle, yTitle), { value: true });
  }

  heatmap() {
    const { cfg, roles } = this;
    const x = roles.x[0];
    const p = pivot(this.ctx.dataset, {
      x,
      xKind: this.kind(x),
      values: roles.y.slice(0, 1),
      group: roles.group[0],
      groupKind: this.kind(roles.group[0]),
      agg: cfg.agg === "none" ? "sum" : cfg.agg,
      bucket: cfg.dateBucket,
      sort: cfg.sort === "auto" ? "label-asc" : cfg.sort,
      topN: cfg.topN,
      others: cfg.others,
      maxCategories: 60,
      maxSeries: 60,
    });
    if (p.hiddenCategories || p.hiddenSeries) this.warn("Carte limitée à 60 colonnes × 60 lignes (les plus fréquentes).");
    if (p.categories.length === 0 || p.series.length === 0) return;
    const rows = [...p.series].sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
    this.resolveUnit(rows.flatMap((s) => s.values));
    const z = rows.map((s) => s.values.map(this.sv));
    const text = rows.map((s) => s.values.map(this.fmt));
    const measure = measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, roles.y[0] ?? null);
    this.data.push({
      type: "heatmap",
      x: p.categories.map((c) => c.label),
      y: rows.map((s) => s.name),
      z,
      text,
      texttemplate: cfg.labels ? "%{text}" : "",
      hovertemplate: "%{x} · %{y}<br>%{text}<extra></extra>",
      ...this.scale(),
      xgap: 1,
      ygap: 1,
      colorbar: { title: { text: esc(measure) }, thickness: 14, tickformat: d3Format(this.nf), ticksuffix: this.unitLabel },
    });
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, x), { type: "category", angle: true }), showline: false };
    this.layout.yaxis = { ...this.axis(this.title(cfg.yTitle, roles.group[0]), { type: "category", reversed: true }), showline: false };
  }

  correlation() {
    const { cfg, roles, ctx } = this;
    const dims = roles.dims;
    const cols = dims.map((d) => ctx.dataset.rows.map((r) => toNumber(r[d])));
    const n = dims.length;
    const z: (number | null)[][] = [];
    const text: string[][] = [];
    const dec = cfg.decimals >= 0 ? cfg.decimals : 2;
    for (let i = 0; i < n; i++) {
      z.push([]);
      text.push([]);
      for (let j = 0; j < n; j++) {
        const hide = cfg.triangle && j > i;
        const r = hide ? null : i === j ? 1 : pearsonPairs(cols[i], cols[j]);
        z[i].push(r);
        text[i].push(r === null ? "" : r.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
      }
    }
    this.data.push({
      type: "heatmap",
      x: dims,
      y: dims,
      z,
      text,
      texttemplate: cfg.labels ? "%{text}" : "",
      hovertemplate: "%{y} × %{x}<br>r = %{text}<extra></extra>",
      zmin: -1,
      zmax: 1,
      ...this.scale(),
      xgap: 2,
      ygap: 2,
      colorbar: { title: { text: "r" }, thickness: 14 },
    });
    this.layout.xaxis = { ...this.axis("", { type: "category", angle: true }), showline: false, showgrid: false };
    this.layout.yaxis = { ...this.axis("", { type: "category", reversed: true }), showline: false, showgrid: false };
    this.layout.plot_bgcolor = TRANSPARENT;
  }

  density2d() {
    const { cfg, roles } = this;
    const { list } = this.points(roles.y.slice(0, 1));
    const s = list[0];
    if (!s || s.y.length === 0) return;
    const sc = this.scale();
    const common = { x: s.x, y: s.y, ...sc, colorbar: { title: { text: "Effectif" }, thickness: 14 }, ...(cfg.bins > 0 ? { nbinsx: cfg.bins, nbinsy: cfg.bins } : {}) };
    if (cfg.contour) {
      this.data.push({ type: "histogram2dcontour", ...common, ncontours: 18, contours: { coloring: "fill", showlines: true }, line: { width: 0.5, color: withAlpha(this.text === "#1a1f2e" ? "#1a1f2e" : "#f3f4f6", 0.3) } });
    } else {
      this.data.push({ type: "histogram2d", ...common, xgap: 1, ygap: 1 });
    }
    if (cfg.markers) {
      this.data.push({
        type: s.y.length > 5000 ? "scattergl" : "scatter",
        mode: "markers",
        x: s.x,
        y: s.y,
        marker: { color: this.text, size: cfg.markerSize, opacity: 0.35 },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
    this.layout.showlegend = false;
    this.layout.xaxis = { ...this.axis(this.title(cfg.xTitle, roles.x[0])), tickformat: ",~f" };
    this.layout.yaxis = { ...this.axis(this.title(cfg.yTitle, roles.y[0]), { value: true }), tickformat: ",~f", tickprefix: "", ticksuffix: "" };
  }

  // Lignes complètes (toutes les dimensions numériques renseignées).
  completeRows(dims: string[], max: number) {
    const rows: { values: number[]; group: CellValue }[] = [];
    const group = this.roles.group[0];
    for (const r of this.ctx.dataset.rows) {
      const vals = dims.map((d) => toNumber(r[d]));
      if (vals.some((v) => v === null)) continue;
      if (group && isEmpty(r[group])) continue;
      rows.push({ values: vals as number[], group: group ? r[group] : null });
    }
    if (rows.length > max) {
      this.warn(`${rows.length.toLocaleString("fr-FR")} lignes : un échantillon régulier de ${max.toLocaleString("fr-FR")} lignes est affiché.`);
      const step = rows.length / max;
      return Array.from({ length: max }, (_, k) => rows[Math.floor(k * step)]);
    }
    return rows;
  }

  splom() {
    const { cfg, roles } = this;
    const dims = roles.dims.slice(0, 8);
    const rows = this.completeRows(dims, 5000);
    if (rows.length === 0) return;
    const group = roles.group[0] ?? null;
    const groupKind = group ? this.kind(group) : "category";
    const numericColor = group !== null && groupKind === "number";
    const parts = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = group && !numericColor ? (axisKey(r.group, groupKind, "none")?.label ?? "") : "";
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key)!.push(r);
    }
    const sc = this.scale();
    Array.from(parts.entries())
      .slice(0, 20)
      .forEach(([name, sub], i) => {
        const color = this.color(name || "Observations", i);
        if (!numericColor) this.addLegend(name || "Observations", color);
        this.data.push({
          type: "splom",
          name: esc(name || "Observations"),
          dimensions: dims.map((d, k) => ({ label: esc(d), values: sub.map((r) => r.values[k]) })),
          marker: numericColor
            ? { color: sub.map((r) => toNumber(r.group) ?? 0), ...sc, showscale: true, size: cfg.markerSize, opacity: cfg.opacity, colorbar: { title: { text: esc(group!) }, thickness: 14 } }
            : { color, size: cfg.markerSize, opacity: cfg.opacity, symbol: cfg.markerSymbol, line: { width: 0.3, color: this.surface } },
          // Moitié inférieure seule (comme sns.pairplot(corner=True)). Avec
          // deux variables, il ne resterait qu'une case et Plotly échoue : on
          // garde alors la matrice complète.
          diagonal: { visible: false },
          showupperhalf: dims.length <= 2,
        });
      });
    const axisStyle = { showgrid: cfg.grid, gridcolor: this.grid, zerolinecolor: this.grid, linecolor: this.grid, automargin: true, tickfont: { size: Math.max(8, cfg.fontSize - 3) } };
    const layout = this.layout as Record<string, unknown>;
    dims.forEach((_, k) => {
      layout[`xaxis${k === 0 ? "" : k + 1}`] = { ...axisStyle };
      layout[`yaxis${k === 0 ? "" : k + 1}`] = { ...axisStyle };
    });
    this.layout.dragmode = "select";
    if (parts.size <= 1 && !numericColor) this.layout.showlegend = false;
  }

  parallel() {
    const { cfg, roles } = this;
    const dims = roles.dims;
    const rows = this.completeRows(dims, 5000);
    if (rows.length === 0) return;
    const group = roles.group[0] ?? null;
    const groupKind = group ? this.kind(group) : "category";
    const sc = this.scale();
    const dimensions: Record<string, unknown>[] = dims.map((d, k) => ({
      label: esc(d),
      values: rows.map((r) => r.values[k]),
      tickformat: ",~f",
    }));
    let line: Record<string, unknown> = { color: this.palette[0] };
    if (group && groupKind === "number") {
      line = { color: rows.map((r) => toNumber(r.group) ?? 0), ...sc, showscale: true, colorbar: { title: { text: esc(group) }, thickness: 14 } };
    } else if (group) {
      const labels = rows.map((r) => axisKey(r.group, groupKind, "none")?.label ?? "");
      const uniq = sortedUnique(labels, groupKind).slice(0, 20);
      const code = new Map(uniq.map((u, i) => [u, i]));
      const colors = uniq.map((u, i) => this.color(u, i));
      uniq.forEach((u, i) => this.addLegend(u, colors[i]));
      const n = Math.max(uniq.length - 1, 1);
      line = {
        color: labels.map((l) => code.get(l) ?? 0),
        colorscale: uniq.length === 1 ? [[0, colors[0]], [1, colors[0]]] : colors.flatMap((c, i) => [[Math.max(0, (i - 0.5) / n), c], [Math.min(1, (i + 0.5) / n), c]]),
        cmin: 0,
        cmax: n,
      };
      dimensions.unshift({
        label: esc(group),
        values: labels.map((l) => code.get(l) ?? 0),
        tickvals: uniq.map((_, i) => i),
        ticktext: uniq.map(esc),
      });
    }
    this.data.push({
      type: "parcoords",
      line,
      dimensions,
      labelfont: { size: cfg.fontSize, color: this.text },
      tickfont: { size: Math.max(8, cfg.fontSize - 2), color: this.text },
      rangefont: { size: Math.max(8, cfg.fontSize - 3), color: this.ctx.theme.muted },
    } as Data);
    this.layout.margin = { ...this.layout.margin, l: 60, r: 60, b: 30, t: (this.layout.margin?.t ?? 40) + 20 };
  }

  // ------------------------------------------------------ flux, polaire & 3D

  sankey() {
    const { cfg, roles } = this;
    const path = roles.path.map((c) => ({ col: c, kind: this.kind(c) }));
    const value = roles.y[0] ?? null;
    const f = flows(this.ctx.dataset, path, value, cfg.agg);
    if (f.truncated) this.warn("Flux très nombreux : seuls les 400 liens les plus importants sont affichés.");
    if (f.links.length === 0) return;
    this.resolveUnit(f.links.map((l) => l.value));
    const nodeColors = f.nodes.map((n, i) => this.color(n.label, i));
    f.nodes.forEach((n, i) => {
      if (n.level === 0) this.addLegend(n.label, nodeColors[i]);
    });
    this.data.push({
      type: "sankey",
      arrangement: "snap",
      valueformat: d3Format(this.nf),
      valuesuffix: this.unitLabel + cfg.suffix,
      node: {
        label: f.nodes.map((n) => esc(n.label)),
        color: nodeColors,
        pad: 16,
        thickness: 16,
        line: { color: this.surface, width: 0.5 },
        hovertemplate: "%{label}<br>%{value}<extra></extra>",
      },
      link: {
        source: f.links.map((l) => l.source),
        target: f.links.map((l) => l.target),
        value: f.links.map((l) => l.value / this.div),
        color: f.links.map((l) => withAlpha(nodeColors[l.source], cfg.opacity)),
        customdata: f.links.map((l) => this.fmt(l.value)),
        hovertemplate: "%{source.label} → %{target.label}<br>%{customdata}<extra></extra>",
      },
    } as Data);
    this.layout.showlegend = false;
  }

  // L'axe radial est placé entre les deux premières catégories pour ne pas
  // masquer le libellé du haut.
  polarAxes(n: number): Partial<Layout>["polar"] {
    const cfg = this.cfg;
    const angle = 90 - 180 / Math.max(n, 1);
    return {
      bgcolor: TRANSPARENT,
      radialaxis: {
        visible: true,
        gridcolor: this.grid,
        linecolor: this.grid,
        tickformat: d3Format(this.nf),
        tickprefix: cfg.prefix,
        ticksuffix: this.unitLabel + cfg.suffix,
        angle,
        tickangle: angle,
        nticks: 5,
        tickfont: { size: Math.max(8, cfg.fontSize - 3), color: this.ctx.theme.muted },
      },
      angularaxis: { gridcolor: this.grid, linecolor: this.grid, direction: "clockwise", rotation: 90 },
    };
  }

  radar() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x);
    if (p.categories.length < 3) {
      if (p.categories.length > 0) this.warn("Un radar demande au moins 3 catégories.");
      if (p.categories.length === 0) return;
    }
    const theta = p.categories.map((c) => c.label);
    p.series.forEach((s, i) => {
      const color = this.color(s.name, i);
      this.addLegend(s.name, color);
      const formatted = s.values.map(this.fmt);
      this.data.push({
        type: "scatterpolar",
        name: esc(s.name),
        r: [...s.values.map(this.sv), this.sv(s.values[0] ?? null)],
        theta: [...theta, theta[0]],
        mode: cfg.markers ? "lines+markers" : "lines",
        fill: cfg.fill ? "toself" : "none",
        fillcolor: withAlpha(color, cfg.opacity),
        line: { color, width: cfg.lineWidth, dash: cfg.dash, shape: cfg.lineShape === "spline" ? "spline" : "linear" },
        marker: { color, size: cfg.markerSize, symbol: cfg.markerSymbol },
        customdata: [...formatted, formatted[0]],
        hovertemplate: "%{theta}<br>%{customdata}<extra>%{fullData.name}</extra>",
      });
    });
    this.layout.polar = this.polarAxes(theta.length);
  }

  polarBar() {
    const { cfg } = this;
    const x = this.roles.x[0];
    const p = this.pivot(x);
    if (p.categories.length === 0) return;
    const theta = p.categories.map((c) => c.label);
    const single = p.series.length === 1;
    p.series.forEach((s, i) => {
      const color = this.color(s.name, i);
      const vary = single && cfg.varyColors;
      if (vary) theta.forEach((c, j) => this.addLegend(c, this.color(c, j)));
      else this.addLegend(s.name, color);
      this.data.push({
        type: "barpolar",
        name: esc(s.name),
        r: s.values.map(this.sv),
        theta,
        marker: { color: vary ? theta.map((c, j) => this.color(c, j)) : color, opacity: cfg.opacity, line: { color: this.surface, width: 1 } },
        customdata: s.values.map(this.fmt),
        hovertemplate: "%{theta}<br>%{customdata}<extra>%{fullData.name}</extra>",
      });
    });
    this.layout.polar = { ...this.polarAxes(theta.length), barmode: "stack", bargap: cfg.barGap };
  }

  scatter3d() {
    const { cfg, roles } = this;
    const sizeCol = roles.size[0];
    const { list, numericColor, group } = this.points(roles.y.slice(0, 1), { z: roles.z[0], size: sizeCol });
    const total = list.reduce((a, s) => a + s.y.length, 0);
    if (total === 0) return;
    if (total > MAX_POINTS) this.warn(`${total.toLocaleString("fr-FR")} points : l'affichage 3D peut être lent.`);
    const maxSize = Math.max(1, ...list.flatMap((s) => s.size.map(Math.abs)));
    const sc = this.scale();
    // Une unité automatique par axe (k, M, Md) pour des graduations lisibles.
    const ux = this.xUnit(list.flatMap((s) => s.xNum));
    const uy = this.xUnit(list.flatMap((s) => s.y));
    const uz = this.xUnit(list.flatMap((s) => s.z));
    list.forEach((s, i) => {
      const color = this.color(s.name, i);
      if (!numericColor) this.addLegend(s.name, color);
      this.data.push({
        type: "scatter3d",
        mode: "markers",
        name: esc(s.name),
        x: s.xNum.map((v) => v / ux.div),
        y: s.y.map((v) => v / uy.div),
        z: s.z.map((v) => v / uz.div),
        marker: {
          size: sizeCol ? s.size.map((v) => 3 + (Math.abs(v) / maxSize) * cfg.markerSize * 3) : cfg.markerSize,
          color: numericColor ? s.color : color,
          opacity: cfg.opacity,
          symbol: (["circle", "square", "diamond", "cross", "x"].includes(cfg.markerSymbol) ? cfg.markerSymbol : "circle") as "circle",
          ...(numericColor ? { ...sc, showscale: i === 0, colorbar: { title: { text: esc(group!) }, thickness: 14 } } : {}),
        },
      } as Data);
    });
    const ax = (title: string, suffix: string) => ({
      title: { text: esc(title) },
      ticksuffix: suffix,
      gridcolor: this.grid,
      zerolinecolor: this.grid,
      backgroundcolor: TRANSPARENT,
      showbackground: false,
      tickformat: ",~f",
    });
    this.layout.scene = {
      xaxis: ax(this.title(cfg.xTitle, roles.x[0]), ux.label),
      yaxis: ax(this.title(cfg.yTitle, roles.y[0]), uy.label),
      zaxis: ax(roles.z[0], uz.label),
      bgcolor: TRANSPARENT,
    };
    if (list.length === 1 && !numericColor) this.layout.showlegend = false;
  }

  // -------------------------------------------------------------- indicateurs

  // Agrégat sur toutes les lignes : tableau croisé à une seule catégorie.
  aggregateAll(col: string | null): number | null {
    const rows = this.ctx.dataset.rows.map((r) => ({ ...r, "\u0000": "Total" }));
    const q = pivot({ ...this.ctx.dataset, rows }, {
      x: "\u0000",
      xKind: "category",
      values: col ? [col] : [],
      group: null,
      groupKind: "category",
      agg: this.cfg.agg === "none" ? "sum" : this.cfg.agg,
      bucket: "none",
      sort: "none",
      topN: 0,
      others: false,
    });
    return q.series[0]?.values[0] ?? null;
  }

  // Format d3 d'un indicateur : décimales choisies, ou adaptées à la valeur
  // affichée (2,19 Md plutôt que 2,193515 Md).
  indicatorFormat(v: number): string {
    if (this.nf.decimals >= 0) return `,.${this.nf.decimals}f`;
    const a = Math.abs(v / this.div);
    return a >= 100 ? ",.0f" : a >= 10 ? ",.1f" : a >= 1 ? ",.2f" : ",.3~f";
  }

  kpi() {
    const { cfg, roles } = this;
    const cols: (string | null)[] = roles.y.length ? roles.y : [null];
    const n = cols.length;
    let any = false;
    cols.forEach((col, i) => {
      const v = this.aggregateAll(col);
      if (v === null) return;
      any = true;
      // Chaque carte a sa propre unité automatique (montant en Md, effectif…).
      if (cfg.unit === "auto") this.setUnit(autoUnit(Math.abs(v)));
      const name = measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, col);
      const color = this.color(name, i);
      this.addLegend(name, color);
      const hasTarget = cfg.target !== null;
      this.data.push({
        type: "indicator",
        mode: hasTarget ? "number+delta" : "number",
        value: v / this.div,
        number: {
          valueformat: this.indicatorFormat(v),
          prefix: cfg.prefix,
          suffix: this.unitLabel + cfg.suffix,
          font: { color, size: Math.round(cfg.fontSize * (n > 3 ? 2.6 : 3.6)) },
        },
        delta: hasTarget
          ? {
              reference: cfg.target! / this.div,
              valueformat: this.indicatorFormat(v - cfg.target!),
              increasing: { color: this.statusColor("Hausse") },
              decreasing: { color: this.statusColor("Baisse") },
            }
          : undefined,
        title: {
          text:
            `<span style="font-size:${cfg.fontSize + 1}px">${esc(name)}</span>` +
            (hasTarget ? `<br><span style="font-size:${cfg.fontSize - 1}px;color:${this.ctx.theme.muted}">Objectif : ${esc(this.fmt(cfg.target))}</span>` : ""),
        },
        domain: { row: 0, column: i },
      });
    });
    if (!any) return;
    this.layout.grid = { rows: 1, columns: n, pattern: "independent" };
    if (!cfg.title.trim()) this.layout.title = undefined;
    this.layout.margin = { l: 10, r: 10, t: cfg.title.trim() && cfg.showTitle ? 60 : 20, b: 10 };
  }

  gauge() {
    const { cfg, roles } = this;
    const col = roles.y[0] ?? null;
    const v = this.aggregateAll(col);
    if (v === null) return;
    const name = measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, col);
    const barColor = this.color(name, 0);
    this.addLegend(name, barColor);
    const target = cfg.target;
    const lo = cfg.gaugeMin ?? Math.min(0, v);
    const autoMax = Math.max(v, target ?? 0, lo + 1) * 1.2;
    const p10 = Math.pow(10, Math.floor(Math.log10(Math.abs(autoMax) || 1)));
    const hi = cfg.gaugeMax ?? Math.ceil(autoMax / p10) * p10;
    this.resolveUnit([v, hi, target]);
    const d = (x: number) => x / this.div;
    const steps = cfg.gaugeBands
      ? (["Zone basse", "Zone intermédiaire", "Zone haute"] as const).map((k, i) => {
          const c = this.statusColor(k);
          this.addLegend(k, c);
          const bounds = [0, 0.5, 0.8, 1];
          return { range: [d(lo + (hi - lo) * bounds[i]), d(lo + (hi - lo) * bounds[i + 1])] as [number, number], color: withAlpha(c, 0.28) };
        })
      : [];
    this.data.push({
      type: "indicator",
      mode: target !== null ? "gauge+number+delta" : "gauge+number",
      value: d(v),
      number: { valueformat: this.indicatorFormat(v), prefix: cfg.prefix, suffix: this.unitLabel + cfg.suffix, font: { size: cfg.fontSize * 3 } },
      delta: target !== null ? { reference: d(target), valueformat: this.indicatorFormat(v - target), increasing: { color: this.statusColor("Hausse") }, decreasing: { color: this.statusColor("Baisse") } } : undefined,
      title: { text: cfg.title.trim() ? "" : esc(name) },
      gauge: {
        shape: cfg.gaugeShape,
        axis: { range: [d(lo), d(hi)], tickformat: ",~f", ticksuffix: this.unitLabel, tickcolor: this.text },
        bar: { color: barColor, thickness: cfg.gaugeShape === "bullet" ? 0.45 : 0.3 },
        bgcolor: TRANSPARENT,
        borderwidth: 0,
        steps,
        threshold: target !== null ? { line: { color: this.text, width: 3 }, thickness: 0.85, value: d(target) } : undefined,
      },
    });
    if (!cfg.title.trim()) this.layout.title = undefined;
    this.layout.margin = { l: 55, r: 55, t: cfg.title.trim() && cfg.showTitle ? 70 : 40, b: 20 };
  }

  // ------------------------------------------------------------------ cartes

  // Fond de carte choisi, ou détecté d'après les valeurs de la colonne.
  mapLevelFor(col: string | undefined): MapLevel {
    if (this.cfg.mapLevel !== "auto") return this.cfg.mapLevel;
    if (!col) return "world";
    return detectMapLevel(this.ctx.dataset.rows.map((r) => r[col]))?.level ?? "world";
  }

  // Valeur agrégée par zone, après rapprochement des libellés (accents,
  // « Région de… », codes ISO) avec les zones du fond de carte.
  zonePivot(col: string, level: MapLevel, withGroup: boolean) {
    const ZONE = "\u0002zone";
    const cache = new Map<string, MapZone | null>();
    const unmatched = new Set<string>();
    const rows = this.ctx.dataset.rows.map((r) => {
      const raw = r[col];
      if (isEmpty(raw)) return { ...r, [ZONE]: null };
      const k = String(raw).trim();
      let z = cache.get(k);
      if (z === undefined) {
        z = matchZone(level, k);
        cache.set(k, z);
      }
      if (!z) unmatched.add(k);
      return { ...r, [ZONE]: z ? z.code : null };
    });
    if (unmatched.size) {
      const list = Array.from(unmatched);
      const levelLabel = MAP_LEVELS.find((l) => l.id === level)?.label ?? level;
      this.warn(
        `${list.length} valeur(s) non reconnue(s) sur le fond « ${levelLabel} » : ${list.slice(0, 6).join(", ")}${list.length > 6 ? "…" : ""}. Vérifiez l'orthographe ou changez de fond de carte.`,
      );
    }
    const group = withGroup ? (this.roles.group[0] ?? null) : null;
    const p = pivot(
      { ...this.ctx.dataset, rows },
      {
        x: ZONE,
        xKind: "category",
        values: this.roles.y.slice(0, 1),
        group,
        groupKind: group ? this.kind(group) : "category",
        agg: this.cfg.agg === "none" ? "sum" : this.cfg.agg,
        bucket: "none",
        sort: "none",
        topN: 0,
        others: false,
        maxSeries: 20,
      },
    );
    if (p.hiddenSeries) this.warn(`${p.hiddenSeries} série(s) de couleur non affichée(s) (20 au maximum).`);
    const zones = new Map(zonesOf(level).map((z) => [z.code, z]));
    return { p, zones, group };
  }

  darkCanvas(): boolean {
    return this.cfg.background === "custom" ? contrastText(this.cfg.bgColor) !== "#1a1f2e" : this.ctx.theme.dark;
  }

  landColor(): string {
    return this.darkCanvas() ? "#262b37" : "#eef1f6";
  }

  borderColor(): string {
    return this.darkCanvas() ? "#5b6170" : "#ffffff";
  }

  geoLayout(level: MapLevel, fit: boolean): Partial<Layout>["geo"] {
    const lines = this.darkCanvas() ? "#5b6170" : "#b8c0cc";
    return {
      scope: level === "world" ? "world" : "africa",
      resolution: level === "world" ? 110 : 50,
      projection: { type: level === "world" ? "natural earth" : "mercator" },
      fitbounds: fit ? "locations" : false,
      showland: true,
      landcolor: this.landColor(),
      showcountries: true,
      countrycolor: lines,
      countrywidth: 0.6,
      showcoastlines: true,
      coastlinecolor: lines,
      coastlinewidth: 0.6,
      showocean: false,
      showlakes: false,
      showrivers: false,
      showframe: false,
      showsubunits: false,
      bgcolor: TRANSPARENT,
    };
  }

  // Contours de toutes les zones de Guinée, en gris : les zones sans donnée
  // restent visibles et la carte est cadrée sur le pays.
  zoneOutlines(level: MapLevel): Data | null {
    const geojson = GEOJSON_URL[level];
    if (!geojson) return null;
    const all = zonesOf(level);
    const land = this.landColor();
    return {
      type: "choropleth",
      geojson,
      featureidkey: "properties.id",
      locations: all.map((z) => z.code),
      z: all.map(() => 0),
      text: all.map((z) => z.name),
      colorscale: [
        [0, land],
        [1, land],
      ],
      showscale: false,
      marker: { line: { color: this.borderColor(), width: 0.8 } },
      hovertemplate: "<b>%{text}</b><br>Aucune donnée<extra></extra>",
      showlegend: false,
    } as Data;
  }

  // Source des fonds de carte (licence d'attribution), en bas à droite.
  mapSource(level: MapLevel) {
    this.layout.annotations = [
      ...(this.layout.annotations ?? []),
      {
        text: esc(GEO_SOURCES[level]),
        showarrow: false,
        xref: "paper",
        yref: "paper",
        x: 1,
        y: 0,
        xanchor: "right",
        yanchor: "top",
        yshift: -2,
        font: { size: 9, color: this.ctx.theme.muted },
      },
    ];
    this.layout.margin = { ...this.layout.margin, l: 8, r: 8, b: 22 };
  }

  mapLabels(points: { lat: number; lon: number; text: string }[]): Data {
    return {
      type: "scattergeo",
      mode: "text",
      lat: points.map((p) => p.lat),
      lon: points.map((p) => p.lon),
      text: points.map((p) => p.text),
      textfont: { size: Math.max(8, this.cfg.fontSize - 2), color: this.text, shadow: "auto" },
      hoverinfo: "skip",
      showlegend: false,
    } as Data;
  }

  choropleth() {
    const { cfg, roles } = this;
    const x = roles.x[0];
    const level = this.mapLevelFor(x);
    const { p, zones } = this.zonePivot(x, level, false);
    const s = p.series[0];
    if (!s || p.categories.length === 0) return;
    this.resolveUnit(s.values);
    const codes = p.categories.map((c) => c.key);
    const zoneList = codes.map((c) => zones.get(c));
    const names = codes.map((c, i) => zoneList[i]?.name ?? c);
    const formatted = s.values.map(this.fmt);
    const geojson = GEOJSON_URL[level];
    const outlines = this.zoneOutlines(level);
    if (outlines) this.data.push(outlines);
    this.data.push({
      type: "choropleth",
      ...(geojson ? { geojson, featureidkey: "properties.id" } : { locationmode: "ISO-3" as const }),
      locations: codes,
      z: s.values.map(this.sv),
      text: names,
      customdata: formatted,
      hovertemplate: "<b>%{text}</b><br>%{customdata}<extra></extra>",
      ...this.scale(),
      marker: { line: { color: this.borderColor(), width: geojson ? 0.8 : 0.4 }, opacity: cfg.opacity },
      colorbar: {
        title: { text: esc(measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, roles.y[0] ?? null)) },
        thickness: 14,
        tickformat: d3Format(this.nf),
        ticksuffix: this.unitLabel,
      },
    } as Data);
    if (cfg.labels) {
      this.data.push(
        this.mapLabels(
          zoneList
            .map((z, i) =>
              z && Number.isFinite(z.lat) ? { lat: z.lat, lon: z.lon, text: `${esc(z.name)}<br>${esc(formatted[i])}` } : null,
            )
            .filter((v): v is { lat: number; lon: number; text: string } => v !== null),
        ),
      );
    }
    this.layout.geo = this.geoLayout(level, Boolean(geojson));
    this.layout.showlegend = false;
    this.mapSource(level);
  }

  mapBubble() {
    const { cfg, roles } = this;
    type Bubbles = { name: string; lat: number[]; lon: number[]; size: (number | null)[]; text: string[]; color: number[] };
    let level: MapLevel;
    let series: Bubbles[] = [];
    let numericColor = false;
    let colorTitle = "";
    const sized = roles.y.length > 0 || Boolean(roles.x[0]);

    if (roles.x[0]) {
      level = this.mapLevelFor(roles.x[0]);
      const { p, zones, group } = this.zonePivot(roles.x[0], level, true);
      this.resolveUnit(p.series.flatMap((s) => s.values));
      const single = measureLabel(cfg.agg === "none" ? "sum" : cfg.agg, roles.y[0] ?? null);
      series = p.series.map((s) => {
        const pts = p.categories
          .map((c, j) => ({ z: zones.get(c.key), v: s.values[j] }))
          .filter((o) => o.z && o.v !== null && Number.isFinite(o.z.lat));
        return {
          name: group ? s.name : single,
          lat: pts.map((o) => o.z!.lat),
          lon: pts.map((o) => o.z!.lon),
          size: pts.map((o) => o.v),
          text: pts.map((o) => o.z!.name),
          color: [],
        };
      });
    } else {
      const latCol = roles.lat[0];
      const lonCol = roles.lon[0];
      const val = roles.y[0];
      const group = roles.group[0];
      numericColor = Boolean(group) && this.kind(group) === "number";
      colorTitle = group ?? "";
      const byName = new Map<string, Bubbles>();
      let invalid = 0;
      for (const r of this.ctx.dataset.rows) {
        const la = toNumber(r[latCol]);
        const lo = toNumber(r[lonCol]);
        if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) {
          invalid++;
          continue;
        }
        const v = val ? toNumber(r[val]) : 1;
        if (v === null) continue;
        let name = "Points";
        let cval = 0;
        if (group) {
          if (isEmpty(r[group])) continue;
          if (numericColor) cval = toNumber(r[group]) ?? 0;
          else name = axisKey(r[group], this.kind(group), "none")?.label ?? "";
        }
        let s = byName.get(name);
        if (!s) byName.set(name, (s = { name, lat: [], lon: [], size: [], text: [], color: [] }));
        s.lat.push(la);
        s.lon.push(lo);
        s.size.push(v);
        s.text.push(
          `${la.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ; ${lo.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}`,
        );
        s.color.push(cval);
      }
      if (invalid) this.warn(`${invalid} ligne(s) ignorée(s) : coordonnées absentes ou hors limites.`);
      series = Array.from(byName.values()).sort((a, b) => b.lat.length - a.lat.length);
      if (series.length > 20) {
        this.warn(`${series.length - 20} modalité(s) de couleur non affichée(s) (20 au maximum).`);
        series = series.slice(0, 20);
      }
      const total = series.reduce((n, s) => n + s.lat.length, 0);
      if (total > 5000) this.warn(`${total.toLocaleString("fr-FR")} points : l'affichage peut être lent.`);
      if (val) this.resolveUnit(series.flatMap((s) => s.size));
      const lats = series.flatMap((s) => s.lat);
      const lons = series.flatMap((s) => s.lon);
      const within = (b: typeof GUINEA_BOUNDS) =>
        lats.every((la) => la >= b.latMin && la <= b.latMax) && lons.every((lo) => lo >= b.lonMin && lo <= b.lonMax);
      level =
        cfg.mapLevel !== "auto"
          ? cfg.mapLevel
          : within(GUINEA_BOUNDS)
            ? "gn-regions"
            : within(AFRICA_BOUNDS)
              ? "africa"
              : "world";
    }
    if (series.every((s) => s.lat.length === 0)) return;
    // Les plus grosses bulles d'abord : les petites restent visibles par-dessus.
    const peak = (s: Bubbles) => s.size.reduce<number>((m, v) => Math.max(m, Math.abs(v ?? 0)), 0);
    series.sort((a, b) => peak(b) - peak(a));

    const outlines = this.zoneOutlines(level);
    if (outlines) this.data.push(outlines);
    const maxSize = Math.max(1e-9, ...series.flatMap((s) => s.size.map((v) => Math.abs(v ?? 0))));
    const sc = this.scale();
    // Beaucoup de points : bulles plus petites pour limiter les recouvrements.
    const points = series.reduce((n, s) => n + s.lat.length, 0);
    const bubbleMax = points > 40 ? cfg.maxBubble * 0.55 : cfg.maxBubble;
    series.forEach((s, i) => {
      const color = this.color(s.name, i);
      if (!numericColor) this.addLegend(s.name, color);
      const formatted = s.size.map(this.fmt);
      const marker: Record<string, unknown> = {
        color: numericColor ? s.color : color,
        opacity: cfg.opacity,
        line: { width: 0.8, color: this.surface },
      };
      if (sized) {
        marker.size = s.size.map((v) => Math.abs(v ?? 0));
        marker.sizemode = "area";
        marker.sizeref = (2 * maxSize) / Math.pow(bubbleMax, 2);
        marker.sizemin = 3;
      } else {
        marker.size = cfg.markerSize;
      }
      if (numericColor) {
        Object.assign(marker, sc, { showscale: i === 0, colorbar: { title: { text: esc(colorTitle) }, thickness: 14 } });
      }
      this.data.push({
        type: "scattergeo",
        mode: cfg.labels ? "markers+text" : "markers",
        name: esc(s.name),
        lat: s.lat,
        lon: s.lon,
        text: s.text.map(esc),
        textposition: "top center",
        textfont: { size: Math.max(8, cfg.fontSize - 2), color: this.text },
        customdata: sized ? formatted : undefined,
        hovertemplate: sized
          ? "<b>%{text}</b><br>%{customdata}<extra>%{fullData.name}</extra>"
          : "<b>%{text}</b><extra>%{fullData.name}</extra>",
        marker,
      } as Data);
    });
    // Guinée : cadrage sur les contours ; coordonnées : sur les points.
    this.layout.geo = this.geoLayout(level, Boolean(GEOJSON_URL[level]) || !roles.x[0]);
    if (series.length <= 1 || numericColor) this.layout.showlegend = false;
    this.mapSource(level);
  }

  // ------------------------------------------------------------------ routage

  build() {
    switch (this.cfg.type) {
      case "column":
      case "bar":
        return this.bars();
      case "lollipop":
        return this.lollipop();
      case "pareto":
        return this.pareto();
      case "combo":
        return this.combo();
      case "line":
      case "area":
        return this.lines();
      case "waterfall":
        return this.waterfall();
      case "candlestick":
        return this.candlestick();
      case "gantt":
        return this.gantt();
      case "pie":
      case "donut":
        return this.pie();
      case "treemap":
      case "sunburst":
      case "icicle":
        return this.hierarchyChart();
      case "funnel":
        return this.funnel();
      case "histogram":
        return this.histogram();
      case "box":
      case "violin":
      case "strip":
        return this.boxLike();
      case "density":
        return this.density();
      case "ecdf":
        return this.ecdfChart();
      case "scatter":
      case "bubble":
        return this.scatter();
      case "heatmap":
        return this.heatmap();
      case "correlation":
        return this.correlation();
      case "density2d":
        return this.density2d();
      case "splom":
        return this.splom();
      case "parallel":
        return this.parallel();
      case "sankey":
        return this.sankey();
      case "radar":
        return this.radar();
      case "polarBar":
        return this.polarBar();
      case "scatter3d":
        return this.scatter3d();
      case "kpi":
        return this.kpi();
      case "gauge":
        return this.gauge();
      case "choropleth":
        return this.choropleth();
      case "mapBubble":
        return this.mapBubble();
    }
  }
}

export function buildFigure(cfg: ChartConfig, ctx: BuildContext): BuiltFigure {
  const def = chartDef(cfg.type);
  const byName = new Map(ctx.columns.map((c) => [c.name, c]));
  const roles = {} as Roles;
  for (const k of ["x", "y", "group", "size", "z", "path", "dims", "open", "high", "low", "close", "start", "end", "lat", "lon"] as RoleKey[]) {
    roles[k] = [];
  }
  for (const spec of def.roles) {
    const valid = (cfg.roles[spec.key] ?? []).filter((n) => {
      const c = byName.get(n);
      return c !== undefined && spec.accepts.includes(c.kind);
    });
    roles[spec.key] = spec.multiple ? valid.slice(0, spec.max ?? Infinity) : valid.slice(0, 1);
  }
  const missing = def.roles
    .filter((s) => s.required && roles[s.key].length < (s.multiple ? (s.min ?? 1) : 1))
    .map((s) => (s.multiple && (s.min ?? 1) > 1 ? `${s.label} (au moins ${s.min})` : s.label));
  if (def.requireAny && !def.requireAny.sets.some((set) => set.every((k) => roles[k].length > 0))) {
    missing.push(def.requireAny.label);
  }

  const b = new FigureBuilder(cfg, ctx, roles);
  if (missing.length) {
    return { data: [], layout: b.layout, legend: [], missing, warnings: [], empty: true };
  }
  try {
    b.build();
  } catch (e) {
    b.warn(`Le graphique n'a pas pu être construit : ${e instanceof Error ? e.message : String(e)}`);
    b.data = [];
  }
  return {
    data: b.data,
    layout: b.layout,
    legend: b.legend,
    missing: [],
    warnings: b.warnings,
    empty: b.data.length === 0,
  };
}
