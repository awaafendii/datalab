"use client";

import {
  Activity,
  Blend,
  Box,
  ChartArea,
  ChartBar,
  ChartCandlestick,
  ChartColumn,
  ChartColumnBig,
  ChartColumnDecreasing,
  ChartColumnIncreasing,
  ChartGantt,
  ChartLine,
  ChartNoAxesColumn,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  ChartSpline,
  CircleDot,
  Columns3,
  Cuboid,
  Donut,
  Filter,
  Gauge,
  Grid3x3,
  Grip,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  Map as MapIcon,
  MapPinned,
  Orbit,
  Radar,
  Sun,
  Table2,
  Target,
  Waves,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CHART_TYPES, FAMILIES, chartDef } from "@/lib/charts/catalog";
import type { ChartType } from "@/lib/charts/types";

export const CHART_ICONS: Record<ChartType, LucideIcon> = {
  column: ChartColumn,
  bar: ChartBar,
  lollipop: ChartNoAxesColumn,
  pareto: ChartColumnDecreasing,
  combo: ChartNoAxesCombined,
  line: ChartLine,
  area: ChartArea,
  waterfall: ChartColumnIncreasing,
  candlestick: ChartCandlestick,
  gantt: ChartGantt,
  pie: ChartPie,
  donut: Donut,
  treemap: LayoutGrid,
  sunburst: Sun,
  icicle: Columns3,
  funnel: Filter,
  histogram: ChartColumnBig,
  box: Box,
  violin: Blend,
  density: Waves,
  ecdf: ChartSpline,
  strip: Grip,
  scatter: ChartScatter,
  bubble: CircleDot,
  heatmap: Grid3x3,
  correlation: Table2,
  density2d: Target,
  splom: LayoutDashboard,
  parallel: Activity,
  sankey: Workflow,
  radar: Radar,
  polarBar: Orbit,
  scatter3d: Cuboid,
  kpi: Hash,
  gauge: Gauge,
  choropleth: MapIcon,
  mapBubble: MapPinned,
};

export default function ChartTypePicker({
  value,
  onPick,
}: {
  value: ChartType;
  onPick: (t: ChartType) => void;
}) {
  const def = chartDef(value);
  return (
    <div className="cb-typepicker">
      <div className="cb-type-info">
        <strong>{def.label}</strong>
        <p>{def.description}</p>
        <p className="hint">
          Équivalent Python : <code>{def.python}</code>
        </p>
      </div>
      {FAMILIES.map((f) => (
        <div key={f.id}>
          <div className="cb-family">{f.label}</div>
          <div className="cb-types">
            {CHART_TYPES.filter((t) => t.family === f.id).map((t) => {
              const Icon = CHART_ICONS[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  className={"cb-type" + (t.id === value ? " active" : "")}
                  title={t.description}
                  aria-pressed={t.id === value}
                  onClick={() => onPick(t.id)}
                >
                  <Icon size={20} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
