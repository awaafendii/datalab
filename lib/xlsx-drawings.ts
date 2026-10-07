// Ajout de graphiques Excel natifs et d'images à un classeur .xlsx.
//
// ExcelJS écrit les données, les tableaux et les styles, mais pas les
// graphiques. On complète donc le paquet Open XML produit : pour chaque
// feuille concernée, un « dessin » (xl/drawings) qui ancre des graphiques
// (xl/charts, format DrawingML Chart) reliés aux cellules du tableau de
// données, et des images (xl/media). Les graphiques restent modifiables dans
// Excel (type, couleurs, données…).

import type { ExcelCell, NativeChart, NativeSeries } from "./charts/excel-types";

export interface TableRef {
  sheetName: string;
  headerRow: number; // ligne d'en-tête (1 = première ligne)
  firstCol: number; // colonne de la 1re colonne du tableau (1 = A)
  rows: ExcelCell[][]; // valeurs (pour les caches du graphique)
  columns: string[];
}

export interface DrawingItem {
  row: number; // ancrage (0 = première ligne)
  col: number; // ancrage (0 = colonne A)
  widthPx: number;
  heightPx: number;
  name: string;
  chart?: { spec: NativeChart; table: TableRef };
  image?: Uint8Array; // PNG
}

const NS = {
  rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  relDrawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  relChart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  relImage: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  pkgRel: "http://schemas.openxmlformats.org/package/2006/relationships",
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  ctDrawing: "application/vnd.openxmlformats-officedocument.drawing+xml",
  ctChart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
};

const EMU_PER_PX = 9525;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function hex(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m) return m[1].toUpperCase();
  const s = /^#?([0-9a-f]{3})$/i.exec(color.trim());
  if (s) return s[1].split("").map((c) => c + c).join("").toUpperCase();
  return "2A78D6";
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function toSerial(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EXCEL_EPOCH) / 86400000;
}

function numOf(v: ExcelCell): number | null {
  if (v instanceof Date) return toSerial(v);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// --------------------------------------------------------- graphique (XML)

class ChartWriter {
  private ids = { cat: 50010, val: 50020, cat2: 50030, val2: 50040 };

  constructor(
    private spec: NativeChart,
    private t: TableRef,
  ) {}

  private sheet(): string {
    return `'${this.t.sheetName.replace(/'/g, "''")}'`;
  }

  private range(col: number, r0: number, r1: number): string {
    const c = colLetter(this.t.firstCol + col);
    return `${this.sheet()}!$${c}$${this.t.headerRow + 1 + r0}:$${c}$${this.t.headerRow + 1 + r1}`;
  }

  private headerCell(col: number): string {
    return `${this.sheet()}!$${colLetter(this.t.firstCol + col)}$${this.t.headerRow}`;
  }

  private rowsOf(s: NativeSeries): [number, number] {
    return [s.rowStart ?? 0, s.rowEnd ?? this.t.rows.length - 1];
  }

  private text(s: string, size: number, bold: boolean, vertical = false): string {
    return (
      `<c:tx><c:rich><a:bodyPr${vertical ? ' rot="-5400000" vert="horz"' : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"/></a:pPr>` +
      `<a:r><a:rPr lang="fr-FR" sz="${size}" b="${bold ? 1 : 0}"/><a:t>${esc(s)}</a:t></a:r></a:p></c:rich></c:tx>`
    );
  }

  private title(s: string, vertical = false): string {
    return `<c:title>${this.text(s, vertical ? 1000 : 1000, false, vertical)}<c:overlay val="0"/></c:title>`;
  }

  private strRef(col: number, r0: number, r1: number): string {
    const pts: string[] = [];
    for (let i = r0; i <= r1; i++) {
      const v = this.t.rows[i]?.[col];
      if (v === null || v === undefined) continue;
      pts.push(`<c:pt idx="${i - r0}"><c:v>${esc(v instanceof Date ? v.toLocaleDateString("fr-FR") : String(v))}</c:v></c:pt>`);
    }
    return `<c:strRef><c:f>${this.range(col, r0, r1)}</c:f><c:strCache><c:ptCount val="${r1 - r0 + 1}"/>${pts.join("")}</c:strCache></c:strRef>`;
  }

  private numRef(col: number, r0: number, r1: number, format = "General"): string {
    const pts: string[] = [];
    for (let i = r0; i <= r1; i++) {
      const n = numOf(this.t.rows[i]?.[col] ?? null);
      if (n === null) continue;
      pts.push(`<c:pt idx="${i - r0}"><c:v>${n}</c:v></c:pt>`);
    }
    return `<c:numRef><c:f>${this.range(col, r0, r1)}</c:f><c:numCache><c:formatCode>${esc(format)}</c:formatCode><c:ptCount val="${r1 - r0 + 1}"/>${pts.join("")}</c:numCache></c:numRef>`;
  }

  // Catégories : nombres ou dates → numRef (axe chronologique possible),
  // sinon texte.
  private categories(r0: number, r1: number): string {
    const col = this.spec.categoryCol;
    let numeric = true;
    let dates = false;
    for (let i = r0; i <= r1; i++) {
      const v = this.t.rows[i]?.[col];
      if (v instanceof Date) dates = true;
      else if (typeof v !== "number" && v !== null) numeric = false;
    }
    return numeric ? this.numRef(col, r0, r1, dates ? "dd/mm/yyyy" : "General") : this.strRef(col, r0, r1);
  }

  private serName(s: NativeSeries): string {
    if (s.literalName) return `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
    return `<c:tx><c:strRef><c:f>${this.headerCell(s.valueCol)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
  }

  private fill(color: string): string {
    const a = this.spec.alpha;
    const alpha = a !== undefined && a < 1 ? `<a:alpha val="${Math.round(Math.max(0.05, a) * 100000)}"/>` : "";
    return alpha ? `<a:solidFill><a:srgbClr val="${hex(color)}">${alpha}</a:srgbClr></a:solidFill>` : `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`;
  }

  private line(color: string): string {
    const w = Math.round((this.spec.lineWidthPt ?? 2) * 12700);
    return `<a:ln w="${w}" cap="rnd"><a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>${this.spec.dash ? '<a:prstDash val="dash"/>' : ""}<a:round/></a:ln>`;
  }

  private marker(color: string, show: boolean): string {
    if (!show) return '<c:marker><c:symbol val="none"/></c:marker>';
    const size = Math.max(2, Math.min(72, Math.round(this.spec.markerSize ?? 6)));
    return `<c:marker><c:symbol val="circle"/><c:size val="${size}"/><c:spPr>${this.fill(color)}<a:ln w="6350"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>`;
  }

  private dLbls(forPie = false): string {
    const l = this.spec.labels;
    if (l === "none") return "";
    const val = l === "value" || l === "categoryValue";
    const pct = l === "percent" || l === "categoryPercent";
    const cat = l === "category" || l === "categoryPercent" || l === "categoryValue";
    return (
      `<c:dLbls><c:numFmt formatCode="${esc(pct ? "0%" : this.spec.numFmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
      `<c:showLegendKey val="0"/><c:showVal val="${val ? 1 : 0}"/><c:showCatName val="${cat ? 1 : 0}"/><c:showSerName val="0"/>` +
      `<c:showPercent val="${pct ? 1 : 0}"/><c:showBubbleSize val="0"/>${forPie ? '<c:showLeaderLines val="1"/>' : ""}</c:dLbls>`
    );
  }

  private dPts(colors: string[] | undefined, kind: "bar" | "pie"): string {
    if (!colors) return "";
    return colors
      .map(
        (c, i) =>
          `<c:dPt><c:idx val="${i}"/>${kind === "bar" ? '<c:invertIfNegative val="0"/>' : ""}<c:bubble3D val="0"/>` +
          `<c:spPr>${this.fill(c)}${kind === "pie" ? '<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>' : ""}</c:spPr></c:dPt>`,
      )
      .join("");
  }

  private trend(s: NativeSeries): string {
    if (!s.trend) return "";
    const tr = s.trend;
    const eq = tr.type !== "movingAvg" && this.spec.series.length === 1;
    return (
      `<c:trendline><c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="${hex(s.color)}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>` +
      `<c:trendlineType val="${tr.type}"/>${tr.type === "poly" ? `<c:order val="${tr.order ?? 2}"/>` : ""}` +
      `${tr.type === "movingAvg" ? `<c:period val="${tr.period ?? 3}"/>` : ""}` +
      `<c:dispRSqr val="${eq ? 1 : 0}"/><c:dispEq val="${eq ? 1 : 0}"/></c:trendline>`
    );
  }

  private ser(s: NativeSeries, i: number, kind: NativeChart["kind"] | "col" | "line" | "area"): string {
    const [r0, r1] = this.rowsOf(s);
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${this.serName(s)}`;
    const cat = () => `<c:cat>${this.categories(r0, r1)}</c:cat>`;
    const val = () => `<c:val>${this.numRef(s.valueCol, r0, r1)}</c:val>`;
    switch (kind) {
      case "col":
      case "bar":
        return `<c:ser>${head}<c:spPr>${this.fill(s.color)}</c:spPr><c:invertIfNegative val="0"/>${this.dPts(s.pointColors, "bar")}${cat()}${val()}</c:ser>`;
      case "line":
        return (
          `<c:ser>${head}<c:spPr>${this.line(s.color)}</c:spPr>${this.marker(s.color, Boolean(this.spec.markers))}${cat()}${val()}` +
          `<c:smooth val="${this.spec.smooth ? 1 : 0}"/></c:ser>`
        );
      case "area":
        return `<c:ser>${head}<c:spPr>${this.fill(s.color)}<a:ln><a:noFill/></a:ln></c:spPr>${cat()}${val()}</c:ser>`;
      case "radar":
        return (
          `<c:ser>${head}<c:spPr>${this.spec.radarFilled ? this.fill(s.color) : ""}${this.line(s.color)}</c:spPr>` +
          `${this.marker(s.color, Boolean(this.spec.markers))}${cat()}${val()}</c:ser>`
        );
      case "pie":
      case "doughnut":
        return `<c:ser>${head}${this.dPts(s.pointColors, "pie")}${this.dLbls(true)}${cat()}${val()}</c:ser>`;
      case "scatter":
        return (
          `<c:ser>${head}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>${this.marker(s.color, true)}${this.trend(s)}` +
          `<c:xVal>${this.numRef(s.xCol ?? 0, r0, r1, this.spec.xNumFmt ?? "General")}</c:xVal><c:yVal>${this.numRef(s.valueCol, r0, r1)}</c:yVal>` +
          `<c:smooth val="0"/></c:ser>`
        );
      case "bubble":
        return (
          `<c:ser>${head}<c:spPr>${this.fill(s.color)}<a:ln w="6350"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>` +
          `<c:invertIfNegative val="0"/><c:xVal>${this.numRef(s.xCol ?? 0, r0, r1, this.spec.xNumFmt ?? "General")}</c:xVal>` +
          `<c:yVal>${this.numRef(s.valueCol, r0, r1)}</c:yVal><c:bubbleSize>${this.numRef(s.sizeCol ?? s.valueCol, r0, r1)}</c:bubbleSize>` +
          `<c:bubble3D val="0"/></c:ser>`
        );
    }
    return "";
  }

  // Taille des bulles : réduite quand les points sont nombreux (100 % jusqu'à
  // une quinzaine de bulles), pour qu'elles ne se recouvrent pas toutes.
  private bubbleScale(): number {
    const n = this.spec.series.reduce((sum, x) => {
      const [r0, r1] = this.rowsOf(x);
      return sum + Math.max(0, r1 - r0 + 1);
    }, 0);
    return Math.max(10, Math.min(100, Math.round(100 * Math.sqrt(15 / Math.max(1, n)))));
  }

  private axisCommon(title: string, vertical: boolean): string {
    return title ? this.title(title, vertical) : "";
  }

  private catAx(id: number, cross: number, pos: "b" | "l", title: string, opts: { delete?: boolean; reverse?: boolean; numFmt?: string } = {}): string {
    return (
      `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="${opts.reverse ? "maxMin" : "minMax"}"/></c:scaling>` +
      `<c:delete val="${opts.delete ? 1 : 0}"/><c:axPos val="${pos}"/>${opts.delete ? "" : this.axisCommon(title, pos === "l")}` +
      `<c:numFmt formatCode="${esc(opts.numFmt ?? "General")}" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
      `<c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>` +
      `<c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    );
  }

  private valAx(
    id: number,
    cross: number,
    pos: "l" | "r" | "b",
    title: string,
    opts: { grid?: boolean; numFmt?: string; crossesMax?: boolean; secondary?: boolean; between?: boolean; log?: boolean; min?: number | null; max?: number | null; rotate?: boolean } = {},
  ): string {
    const spec = this.spec;
    const scaling =
      `<c:scaling>${opts.log ? '<c:logBase val="10"/>' : ""}<c:orientation val="minMax"/>` +
      `${opts.max !== undefined && opts.max !== null ? `<c:max val="${opts.max}"/>` : ""}` +
      `${opts.min !== undefined && opts.min !== null ? `<c:min val="${opts.min}"/>` : ""}</c:scaling>`;
    const unit =
      !opts.secondary && spec.dispUnit !== "none"
        ? `<c:dispUnits><c:builtInUnit val="${spec.dispUnit}"/><c:dispUnitsLbl/></c:dispUnits>`
        : "";
    return (
      `<c:valAx><c:axId val="${id}"/>${scaling}<c:delete val="0"/><c:axPos val="${pos}"/>` +
      `${opts.grid ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E6EF"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ""}` +
      `${this.axisCommon(title, pos !== "b")}<c:numFmt formatCode="${esc(opts.numFmt ?? spec.numFmt)}" sourceLinked="0"/>` +
      `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
      `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${opts.rotate ? '<c:txPr><a:bodyPr rot="-2700000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>' : ""}<c:crossAx val="${cross}"/><c:crosses val="${opts.crossesMax ? "max" : "autoZero"}"/>` +
      `<c:crossBetween val="${opts.between === false ? "midCat" : "between"}"/>${unit}</c:valAx>`
    );
  }

  private plotArea(): string {
    const s = this.spec;
    const { cat, val, cat2, val2 } = this.ids;
    const axIds = (secondary: boolean) =>
      secondary ? `<c:axId val="${cat2}"/><c:axId val="${val2}"/>` : `<c:axId val="${cat}"/><c:axId val="${val}"/>`;
    const groups: string[] = [];
    let i = 0;

    if (s.kind === "pie" || s.kind === "doughnut") {
      const tag = s.kind === "pie" ? "pieChart" : "doughnutChart";
      groups.push(
        `<c:${tag}><c:varyColors val="1"/>${s.series.map((x) => this.ser(x, i++, s.kind)).join("")}` +
          `<c:firstSliceAng val="0"/>${s.kind === "doughnut" ? `<c:holeSize val="${Math.max(10, Math.min(90, Math.round(s.holeSize ?? 50)))}"/>` : ""}</c:${tag}>`,
      );
      return `<c:plotArea><c:layout/>${groups.join("")}</c:plotArea>`;
    }

    if (s.kind === "scatter" || s.kind === "bubble") {
      const body = s.series.map((x) => this.ser(x, i++, s.kind)).join("");
      groups.push(
        s.kind === "scatter"
          ? `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${body}${this.dLbls()}${axIds(false)}</c:scatterChart>`
          : `<c:bubbleChart><c:varyColors val="0"/>${body}${this.dLbls()}<c:bubbleScale val="${this.bubbleScale()}"/><c:showNegBubbles val="0"/><c:sizeRepresents val="area"/>${axIds(false)}</c:bubbleChart>`,
      );
      return (
        `<c:plotArea><c:layout/>${groups.join("")}` +
        this.valAx(cat, val, "b", s.xTitle, { numFmt: s.xNumFmt ?? "General", between: false, rotate: /[dy]/.test(s.xNumFmt ?? "") }) +
        this.valAx(val, cat, "l", s.yTitle, { grid: s.grid, log: s.logScale, min: s.min, max: s.max, between: false }) +
        `</c:plotArea>`
      );
    }

    if (s.kind === "radar") {
      groups.push(
        `<c:radarChart><c:radarStyle val="${s.radarFilled ? "filled" : "marker"}"/><c:varyColors val="0"/>` +
          `${s.series.map((x) => this.ser(x, i++, "radar")).join("")}${this.dLbls()}${axIds(false)}</c:radarChart>`,
      );
      return `<c:plotArea><c:layout/>${groups.join("")}${this.catAx(cat, val, "b", "")}${this.valAx(val, cat, "l", "", { grid: true })}</c:plotArea>`;
    }

    // Colonnes, barres, courbes, aires, et graphiques combinés : un groupe
    // par (type, axe).
    const defaultKind: "col" | "line" | "area" = s.kind === "line" ? "line" : s.kind === "area" ? "area" : "col";
    const keyOf = (x: NativeSeries) => `${x.kind ?? defaultKind}|${x.secondary ? 2 : 1}`;
    const order: string[] = [];
    const bucket = new Map<string, NativeSeries[]>();
    for (const x of s.series) {
      const k = keyOf(x);
      if (!bucket.has(k)) {
        bucket.set(k, []);
        order.push(k);
      }
      bucket.get(k)!.push(x);
    }
    // Les barres d'abord, pour que courbes et aires se dessinent par-dessus.
    order.sort((a, b) => (a.startsWith("col") ? 0 : 1) - (b.startsWith("col") ? 0 : 1));
    const indexOf = new Map(s.series.map((x, k) => [x, k]));
    let secondary = false;
    for (const k of order) {
      const [kind, axis] = k.split("|");
      const sec = axis === "2";
      if (sec) secondary = true;
      const list = bucket.get(k)!;
      const body = list.map((x) => this.ser(x, indexOf.get(x)!, kind as "col" | "line" | "area")).join("");
      if (kind === "col") {
        const grouping = s.grouping === "standard" ? "clustered" : s.grouping;
        const overlap = s.overlap ?? (grouping === "clustered" ? -10 : 100);
        groups.push(
          `<c:barChart><c:barDir val="${s.kind === "bar" ? "bar" : "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>` +
            `${body}${this.dLbls()}<c:gapWidth val="${Math.max(0, Math.min(500, Math.round(s.gapWidth ?? 80)))}"/>` +
            `<c:overlap val="${Math.max(-100, Math.min(100, overlap))}"/>${axIds(sec)}</c:barChart>`,
        );
      } else if (kind === "line") {
        const grouping = s.kind === "line" || s.grouping === "clustered" ? "standard" : s.grouping;
        groups.push(
          `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${body}${this.dLbls()}` +
            `<c:marker val="1"/>${axIds(sec)}</c:lineChart>`,
        );
      } else {
        const grouping = s.grouping === "clustered" ? "standard" : s.grouping;
        groups.push(`<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${body}${this.dLbls()}${axIds(sec)}</c:areaChart>`);
      }
    }
    const horizontal = s.kind === "bar";
    const pct = s.grouping === "percentStacked";
    const axes =
      this.catAx(cat, val, horizontal ? "l" : "b", s.xTitle, { reverse: s.reverseCategories }) +
      this.valAx(val, cat, horizontal ? "b" : "l", s.yTitle, {
        grid: s.grid,
        numFmt: pct ? "0%" : s.numFmt,
        crossesMax: Boolean(s.reverseCategories),
        log: s.logScale,
        min: s.min,
        max: s.max,
      }) +
      (secondary
        ? this.catAx(cat2, val2, "b", "", { delete: true }) +
          this.valAx(val2, cat2, "r", s.y2Title, { numFmt: s.y2NumFmt ?? s.numFmt, crossesMax: true, secondary: true, max: s.y2Max })
        : "");
    return `<c:plotArea><c:layout/>${groups.join("")}${axes}</c:plotArea>`;
  }

  xml(): string {
    const s = this.spec;
    const title = s.title
      ? `<c:title>${this.text(s.title, 1300, true)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
      : '<c:autoTitleDeleted val="1"/>';
    const legend = s.legend ? `<c:legend><c:legendPos val="${s.legend}"/><c:overlay val="0"/></c:legend>` : "";
    const size = Math.round(s.fontSizePt * 100);
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<c:chartSpace xmlns:c="${NS.chart}" xmlns:a="${NS.a}" xmlns:r="${NS.rel}">` +
      `<c:date1904 val="0"/><c:lang val="fr-FR"/><c:roundedCorners val="0"/>` +
      `<c:chart>${title}${this.plotArea()}${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
      `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` +
      `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="1A1F2E"/></a:solidFill>` +
      `<a:latin typeface="${esc(s.font)}"/><a:cs typeface="${esc(s.font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>` +
      `</c:chartSpace>`
    );
  }
}

export function chartXml(spec: NativeChart, table: TableRef): string {
  return new ChartWriter(spec, table).xml();
}

// ----------------------------------------------------------- dessins (XML)

function anchor(item: DrawingItem, inner: string): string {
  return (
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${item.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${Math.round(item.widthPx * EMU_PER_PX)}" cy="${Math.round(item.heightPx * EMU_PER_PX)}"/>${inner}<xdr:clientData/></xdr:oneCellAnchor>`
  );
}

function chartFrame(item: DrawingItem, id: number, rId: string): string {
  return anchor(
    item,
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(item.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.chart}">` +
      `<c:chart xmlns:c="${NS.chart}" xmlns:r="${NS.rel}" r:id="${rId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`,
  );
}

function picture(item: DrawingItem, id: number, rId: string): string {
  const cx = Math.round(item.widthPx * EMU_PER_PX);
  const cy = Math.round(item.heightPx * EMU_PER_PX);
  return anchor(
    item,
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${esc(item.name)}" descr="${esc(item.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="${NS.rel}" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`,
  );
}

// ------------------------------------------------------------- injection

type Zip = import("jszip");

async function text(zip: Zip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? f.async("string") : null;
}

function nextName(zip: Zip, prefix: string, ext: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const p = `${prefix}${n}.${ext}`;
    if (!zip.file(p) && !taken.has(p)) {
      taken.add(p);
      return p;
    }
  }
}

function nextRelId(relsXml: string): string {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return `rId${max + 1}`;
}

// Balises qui suivent <drawing> dans une feuille (ordre imposé par le schéma).
const AFTER_DRAWING = ["<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst"];

export async function addDrawings(xlsx: Uint8Array | ArrayBuffer, drawings: Map<string, DrawingItem[]>): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(xlsx);
  const workbook = (await text(zip, "xl/workbook.xml")) ?? "";
  const wbRels = (await text(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  let types = (await text(zip, "[Content_Types].xml")) ?? "";
  const taken = new Set<string>();

  for (const [sheetName, items] of drawings) {
    if (items.length === 0) continue;
    // Feuille → fichier XML, via le nom et sa relation.
    const sheetTag = Array.from(workbook.matchAll(/<sheet\b[^>]*>/g))
      .map((m) => m[0])
      .find((tag) => tag.includes(`name="${esc(sheetName)}"`));
    const rid = sheetTag && /r:id="([^"]+)"/.exec(sheetTag)?.[1];
    const relTag = rid && Array.from(wbRels.matchAll(/<Relationship\b[^>]*>/g)).map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
    const target = relTag && /Target="([^"]+)"/.exec(relTag)?.[1];
    if (!target) throw new Error(`Feuille introuvable dans le classeur : ${sheetName}`);
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetFile = sheetPath.split("/").pop()!;
    const sheetRelsPath = sheetPath.replace(sheetFile, `_rels/${sheetFile}.rels`);
    let sheetXml = (await text(zip, sheetPath)) ?? "";
    if (sheetXml.includes("<drawing ")) throw new Error(`La feuille ${sheetName} contient déjà un dessin.`);

    const drawingPath = nextName(zip, "xl/drawings/drawing", "xml", taken);
    const drawingFile = drawingPath.split("/").pop()!;
    let sheetRels = (await text(zip, sheetRelsPath)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pkgRel}"></Relationships>`;
    const drawingRid = nextRelId(sheetRels);
    sheetRels = sheetRels.replace("</Relationships>", `<Relationship Id="${drawingRid}" Type="${NS.relDrawing}" Target="../drawings/${drawingFile}"/></Relationships>`);
    zip.file(sheetRelsPath, sheetRels);

    if (!/<worksheet[^>]*xmlns:r=/.test(sheetXml)) sheetXml = sheetXml.replace("<worksheet", `<worksheet xmlns:r="${NS.rel}"`);
    const tag = `<drawing r:id="${drawingRid}"/>`;
    const at = AFTER_DRAWING.map((t) => sheetXml.indexOf(t)).filter((i) => i >= 0);
    const pos = at.length ? Math.min(...at) : sheetXml.lastIndexOf("</worksheet>");
    sheetXml = sheetXml.slice(0, pos) + tag + sheetXml.slice(pos);
    zip.file(sheetPath, sheetXml);

    const rels: string[] = [];
    const anchors: string[] = [];
    let shapeId = 2;
    for (const item of items) {
      const rId = `rId${rels.length + 1}`;
      if (item.chart) {
        const chartPath = nextName(zip, "xl/charts/chart", "xml", taken);
        zip.file(chartPath, chartXml(item.chart.spec, item.chart.table));
        rels.push(`<Relationship Id="${rId}" Type="${NS.relChart}" Target="../charts/${chartPath.split("/").pop()}"/>`);
        types = types.replace("</Types>", `<Override PartName="/${chartPath}" ContentType="${NS.ctChart}"/></Types>`);
        anchors.push(chartFrame(item, shapeId++, rId));
      } else if (item.image) {
        const imagePath = nextName(zip, "xl/media/image", "png", taken);
        zip.file(imagePath, item.image);
        rels.push(`<Relationship Id="${rId}" Type="${NS.relImage}" Target="../media/${imagePath.split("/").pop()}"/>`);
        anchors.push(picture(item, shapeId++, rId));
      }
    }
    zip.file(
      drawingPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}">${anchors.join("")}</xdr:wsDr>`,
    );
    zip.file(
      `xl/drawings/_rels/${drawingFile}.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pkgRel}">${rels.join("")}</Relationships>`,
    );
    types = types.replace("</Types>", `<Override PartName="/${drawingPath}" ContentType="${NS.ctDrawing}"/></Types>`);
  }
  if (!/<Default[^>]*Extension="png"/i.test(types)) {
    types = types.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
