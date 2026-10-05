"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Database,
  Download,
  LayoutTemplate,
  Paintbrush,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Dataset, DatasetProfile } from "@/lib/types";
import {
  autoTitle,
  baseConfig,
  changeChartType,
  chartDef,
  createChart,
  newChartId,
  recommendCharts,
} from "@/lib/charts/catalog";
import { buildFigure, type BuiltFigure } from "@/lib/charts/build";
import { columnInfos } from "@/lib/charts/data";
import { LIGHT_THEME, STYLE_KEYS, type ChartConfig, type ChartTheme, type ColumnInfo } from "@/lib/charts/types";
import PlotlyChart, { downloadFigure, useChartTheme, type ImageFormat } from "./PlotlyChart";
import { preloadPlotly } from "./plotly-runtime";
import ChartTypePicker, { CHART_ICONS } from "./ChartTypePicker";
import DataPane from "./DataPane";
import FormatPane from "./FormatPane";

interface Props {
  dataset: Dataset;
  profile: DatasetProfile;
  suggestedColumns?: string[];
  charts: ChartConfig[];
  onChange: (charts: ChartConfig[]) => void;
  // Graphique à ouvrir dans l'éditeur (créé depuis « Analyse visuelle »).
  focusId?: string | null;
  baseName: string; // préfixe des fichiers exportés
}

type Tab = "type" | "data" | "format";

function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "graphique"
  );
}

export default function ChartBuilder({
  dataset,
  profile,
  suggestedColumns = [],
  charts,
  onChange,
  focusId,
  baseName,
}: Props) {
  const columns = useMemo(() => columnInfos(profile), [profile]);
  const theme = useChartTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("data");
  const [exportError, setExportError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [scrollTo, setScrollTo] = useState(0);

  const editing = charts.find((c) => c.id === editingId) ?? null;

  // Précharge le moteur de graphiques pendant que le navigateur est inactif :
  // le premier graphique s'affiche ensuite sans attendre le téléchargement.
  useEffect(() => {
    preloadPlotly(["bar"]);
  }, []);

  useEffect(() => {
    if (focusId && charts.some((c) => c.id === focusId)) {
      setEditingId(focusId);
      setTab("format");
      setScrollTo((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => {
    if (scrollTo > 0) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollTo]);

  const open = (id: string, t: Tab = "data") => {
    setEditingId(id);
    setTab(t);
    setScrollTo((n) => n + 1);
  };
  const update = (cfg: ChartConfig) => onChange(charts.map((c) => (c.id === cfg.id ? cfg : c)));

  const addNew = () => {
    const cfg = createChart("column", columns, suggestedColumns);
    onChange([...charts, cfg]);
    open(cfg.id, "type");
  };
  const addRecommended = () => {
    const recs = recommendCharts(columns, suggestedColumns);
    if (recs.length === 0) return;
    onChange([...charts, ...recs]);
    setEditingId(null);
  };
  const duplicate = (id: string) => {
    const src = charts.find((c) => c.id === id);
    if (!src) return;
    const copy: ChartConfig = {
      ...JSON.parse(JSON.stringify(src)),
      id: newChartId(),
      title: `${src.title.trim() || autoTitle(src)} (copie)`,
    };
    const i = charts.findIndex((c) => c.id === id);
    onChange([...charts.slice(0, i + 1), copy, ...charts.slice(i + 1)]);
    open(copy.id, tab);
  };
  const remove = (id: string) => {
    onChange(charts.filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const move = (id: string, delta: -1 | 1) => {
    const i = charts.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= charts.length) return;
    const next = [...charts];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const applyStyleToAll = (src: ChartConfig) => {
    const style: Partial<ChartConfig> = {};
    for (const k of STYLE_KEYS) (style as Record<string, unknown>)[k] = src[k];
    onChange(charts.map((c) => (c.id === src.id ? c : { ...c, ...style })));
  };
  const resetStyle = (cfg: ChartConfig) => {
    const fresh = baseConfig(cfg.type);
    const style: Partial<ChartConfig> = {};
    for (const k of STYLE_KEYS) (style as Record<string, unknown>)[k] = fresh[k];
    update({ ...cfg, ...style, colors: {}, title: "", xTitle: null, yTitle: null, y2Title: null, showTitle: true });
  };

  const exportChart = async (cfg: ChartConfig, format: ImageFormat, width: number) => {
    setExportError(null);
    try {
      // Les images sont toujours produites en thème clair sur fond opaque,
      // lisibles dans un rapport Word ou PDF quel que soit le thème à l'écran.
      const fig = buildFigure(cfg, { dataset, columns, theme: LIGHT_THEME, exporting: true });
      if (fig.empty) throw new Error("le graphique est vide");
      const name = `${slug(baseName)}-${slug(cfg.title.trim() || autoTitle(cfg))}`;
      await downloadFigure(fig, format, name, Math.max(600, Math.min(1600, Math.round(width))));
    } catch (e) {
      setExportError(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="cb">
      <div className="cb-toolbar">
        <button type="button" className="btn primary" onClick={addNew}>
          <Plus size={18} /> Nouveau graphique
        </button>
        <button type="button" className="btn" onClick={addRecommended}>
          <Sparkles size={18} /> Graphiques recommandés
        </button>
        {charts.length > 0 && (
          <span className="hint">
            {charts.length} graphique{charts.length > 1 ? "s" : ""} · cliquez sur <Pencil size={12} /> pour modifier
          </span>
        )}
      </div>

      {exportError && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {exportError}
        </div>
      )}

      {editing && (
        <ChartEditor
          ref_={editorRef}
          cfg={editing}
          tab={tab}
          onTab={setTab}
          dataset={dataset}
          columns={columns}
          suggested={suggestedColumns}
          theme={theme}
          onChange={update}
          onClose={() => setEditingId(null)}
          onDuplicate={() => duplicate(editing.id)}
          onRemove={() => remove(editing.id)}
          onExport={(f, w) => exportChart(editing, f, w)}
          onApplyStyleToAll={charts.length > 1 ? () => applyStyleToAll(editing) : undefined}
          onResetStyle={() => resetStyle(editing)}
        />
      )}

      {charts.length === 0 ? (
        <div className="cb-empty">
          <LayoutTemplate size={28} />
          <p>
            Aucun graphique personnalisé pour cette feuille. Créez-en un et choisissez parmi 35 types
            (colonnes, courbes, secteurs, boîtes à moustaches, cartes de chaleur, Sankey, 3D…),
            ou partez des graphiques recommandés pour vos données.
          </p>
        </div>
      ) : (
        <div className="cb-board">
          {charts.map((cfg, i) => (
            <ChartTile
              key={cfg.id}
              cfg={cfg}
              active={cfg.id === editingId}
              dataset={dataset}
              columns={columns}
              theme={theme}
              first={i === 0}
              last={i === charts.length - 1}
              onEdit={() => open(cfg.id, "data")}
              onDuplicate={() => duplicate(cfg.id)}
              onRemove={() => remove(cfg.id)}
              onMove={(d) => move(cfg.id, d)}
              onExport={(w) => exportChart(cfg, "png", w)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- éditeur

function useFigure(cfg: ChartConfig, dataset: Dataset, columns: ColumnInfo[], theme: ChartTheme): BuiltFigure {
  return useMemo(() => buildFigure(cfg, { dataset, columns, theme }), [cfg, dataset, columns, theme]);
}

function ChartEditor({
  ref_,
  cfg,
  tab,
  onTab,
  dataset,
  columns,
  suggested,
  theme,
  onChange,
  onClose,
  onDuplicate,
  onRemove,
  onExport,
  onApplyStyleToAll,
  onResetStyle,
}: {
  ref_: React.RefObject<HTMLDivElement>;
  cfg: ChartConfig;
  tab: Tab;
  onTab: (t: Tab) => void;
  dataset: Dataset;
  columns: ColumnInfo[];
  suggested: string[];
  theme: ChartTheme;
  onChange: (cfg: ChartConfig) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onExport: (f: ImageFormat, width: number) => void;
  onApplyStyleToAll?: () => void;
  onResetStyle: () => void;
}) {
  // L'aperçu suit les réglages avec un léger différé : la saisie reste fluide
  // même sur de gros fichiers.
  const deferred = useDeferredValue(cfg);
  const fig = useFigure(deferred, dataset, columns, theme);
  const previewRef = useRef<HTMLDivElement>(null);
  const def = chartDef(cfg.type);
  const Icon = CHART_ICONS[cfg.type];
  const width = () => previewRef.current?.clientWidth ?? 900;

  return (
    <div className="cb-editor" ref={ref_}>
      <div className="cb-editor-head">
        <h3>
          <Icon size={18} />
          <span className="cb-ellipsis">{cfg.title.trim() || autoTitle(cfg)}</span>
        </h3>
        <div className="cb-editor-actions">
          <span className="cb-export" role="group" aria-label="Exporter l'image">
            <Download size={14} />
            {(["png", "svg", "jpeg"] as ImageFormat[]).map((f) => (
              <button key={f} type="button" className="btn small" disabled={fig.empty} onClick={() => onExport(f, width())}>
                {f.toUpperCase()}
              </button>
            ))}
          </span>
          <button type="button" className="btn small" onClick={onDuplicate}>
            <Copy size={14} /> Dupliquer
          </button>
          <button type="button" className="btn small danger" onClick={onRemove}>
            <Trash2 size={14} /> Supprimer
          </button>
          <button type="button" className="btn small primary" onClick={onClose}>
            <Check size={14} /> Terminer
          </button>
        </div>
      </div>
      <div className="cb-editor-body">
        <div className="cb-preview" ref={previewRef}>
          <FigureView fig={fig} onFixData={() => onTab("data")} />
        </div>
        <aside className="cb-pane" aria-label="Paramètres du graphique">
          <div className="cb-tabs" role="tablist">
            {(
              [
                ["type", "Type", LayoutTemplate],
                ["data", "Données", Database],
                ["format", "Format", Paintbrush],
              ] as const
            ).map(([id, label, TabIcon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={"cb-tab" + (tab === id ? " active" : "")}
                onClick={() => onTab(id)}
              >
                <TabIcon size={15} /> {label}
              </button>
            ))}
          </div>
          <div className="cb-pane-body" role="tabpanel">
            {tab === "type" && (
              <ChartTypePicker value={cfg.type} onPick={(t) => onChange(changeChartType(cfg, t, columns, suggested))} />
            )}
            {tab === "data" && (
              <>
                <p className="hint cb-pane-intro">
                  {def.label} — choisissez les colonnes de chaque rôle. <strong>*</strong> = obligatoire.
                </p>
                <DataPane cfg={cfg} columns={columns} onChange={onChange} />
              </>
            )}
            {tab === "format" && (
              <FormatPane
                cfg={cfg}
                legend={fig.legend}
                onChange={onChange}
                onApplyStyleToAll={onApplyStyleToAll}
                onResetStyle={onResetStyle}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function FigureView({ fig, onFixData }: { fig: BuiltFigure; onFixData?: () => void }) {
  if (fig.missing.length) {
    return (
      <div className="cb-missing" style={{ minHeight: Math.min(fig.layout.height ?? 300, 260) }}>
        <p>
          Pour afficher ce graphique, choisissez : <strong>{fig.missing.join(", ")}</strong>.
        </p>
        {onFixData && (
          <button type="button" className="btn small" onClick={onFixData}>
            <Database size={14} /> Ouvrir l&apos;onglet Données
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {fig.empty ? (
        <div className="cb-missing">
          <p>Aucune donnée exploitable avec ces colonnes (valeurs vides ou non numériques).</p>
        </div>
      ) : (
        <PlotlyChart data={fig.data} layout={fig.layout} />
      )}
      {fig.warnings.length > 0 && (
        <ul className="cb-warnings">
          {fig.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// ------------------------------------------------------- tableau de bord

function ChartTile({
  cfg,
  active,
  dataset,
  columns,
  theme,
  first,
  last,
  onEdit,
  onDuplicate,
  onRemove,
  onMove,
  onExport,
}: {
  cfg: ChartConfig;
  active: boolean;
  dataset: Dataset;
  columns: ColumnInfo[];
  theme: ChartTheme;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  onExport: (width: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const def = chartDef(cfg.type);
  const Icon = CHART_ICONS[cfg.type];
  return (
    <div ref={ref} className={"cb-tile" + (cfg.span === 2 ? " wide" : "") + (active ? " active" : "")}>
      <div className="cb-tile-bar">
        <span className="cb-tile-type">
          <Icon size={14} /> {def.label}
        </span>
        <div className="cb-tile-actions">
          <button type="button" className="icon-btn" title="Modifier" aria-label="Modifier" onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button type="button" className="icon-btn" title="Dupliquer" aria-label="Dupliquer" onClick={onDuplicate}>
            <Copy size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Télécharger en PNG"
            aria-label="Télécharger en PNG"
            onClick={() => onExport(ref.current?.clientWidth ?? 900)}
          >
            <Download size={15} />
          </button>
          <button type="button" className="icon-btn" title="Déplacer avant" aria-label="Déplacer avant" disabled={first} onClick={() => onMove(-1)}>
            <ArrowUp size={15} />
          </button>
          <button type="button" className="icon-btn" title="Déplacer après" aria-label="Déplacer après" disabled={last} onClick={() => onMove(1)}>
            <ArrowDown size={15} />
          </button>
          <button type="button" className="icon-btn danger" title="Supprimer" aria-label="Supprimer" onClick={onRemove}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {active ? (
        <button type="button" className="cb-tile-editing" onClick={onEdit}>
          <Pencil size={16} /> En cours de modification dans l&apos;éditeur ci-dessus
        </button>
      ) : (
        <TileFigure cfg={cfg} dataset={dataset} columns={columns} theme={theme} onEdit={onEdit} />
      )}
    </div>
  );
}

function TileFigure({
  cfg,
  dataset,
  columns,
  theme,
  onEdit,
}: {
  cfg: ChartConfig;
  dataset: Dataset;
  columns: ColumnInfo[];
  theme: ChartTheme;
  onEdit: () => void;
}) {
  const fig = useFigure(cfg, dataset, columns, theme);
  return <FigureView fig={fig} onFixData={onEdit} />;
}
