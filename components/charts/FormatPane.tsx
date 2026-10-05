"use client";

import type { ReactNode } from "react";
import { Brush, Hash, LayoutGrid, Palette, Ruler, Shapes, Tag, Type } from "lucide-react";
import { autoTitle, chartDef, hasFeature } from "@/lib/charts/catalog";
import {
  COLORSCALES,
  FONT_FAMILIES,
  PALETTES,
  colorscalePreview,
} from "@/lib/charts/palettes";
import type { LegendItem } from "@/lib/charts/build";
import type {
  BarMode,
  BoxPoints,
  ChartConfig,
  DashStyle,
  DisplayUnit,
  HistNorm,
  LabelPosition,
  LegendPosition,
  LineShape,
  MarkerSymbol,
  PieText,
  SeriesRender,
  TrendKind,
} from "@/lib/charts/types";

interface Props {
  cfg: ChartConfig;
  legend: LegendItem[];
  onChange: (cfg: ChartConfig) => void;
  onApplyStyleToAll?: () => void;
  onResetStyle: () => void;
}

const HIERARCHY = new Set(["treemap", "sunburst", "icicle"]);
// Types où les points sont toujours visibles : seuls taille et symbole se règlent.
const ALWAYS_MARKERS = new Set(["scatter", "strip", "splom", "scatter3d", "lollipop"]);

export default function FormatPane({ cfg, legend, onChange, onApplyStyleToAll, onResetStyle }: Props) {
  const set = (patch: Partial<ChartConfig>) => onChange({ ...cfg, ...patch });
  const has = (f: Parameters<typeof hasFeature>[1]) => hasFeature(cfg.type, f);
  const def = chartDef(cfg.type);
  const hierarchy = HIERARCHY.has(cfg.type);

  const styleControls = renderStyle(cfg, set, has, legend);

  return (
    <div className="cb-stack">
      {/* ------------------------------------------------------- Couleurs */}
      <Group title="Couleurs" icon={<Palette size={15} />} open>
        {has("palette") && !(hierarchy && cfg.varyColors) && (
          <Field label="Palette">
            <div className="cb-palettes" role="radiogroup" aria-label="Palette de couleurs">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={cfg.palette === p.id}
                  className={"cb-palette" + (cfg.palette === p.id ? " active" : "")}
                  onClick={() => set({ palette: p.id })}
                >
                  <span className="cb-swatches" aria-hidden>
                    {p.colors.slice(0, 8).map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {has("varyColors") && (
          <Toggle
            label="Une couleur par catégorie"
            hint="Pour une série unique, comme « Varier les couleurs par point » d'Excel."
            checked={cfg.varyColors}
            onChange={(v) => set({ varyColors: v })}
          />
        )}
        {hierarchy && (
          <Toggle
            label="Colorer selon la valeur (dégradé)"
            checked={cfg.varyColors}
            onChange={(v) => set({ varyColors: v })}
          />
        )}

        {legend.length > 0 && !(hierarchy && cfg.varyColors) && (
          <Field label="Couleur de chaque élément">
            <div className="cb-colors">
              {legend.slice(0, 40).map((item) => (
                <div className="cb-color" key={item.key}>
                  <input
                    type="color"
                    value={toHex(item.color)}
                    aria-label={`Couleur de ${item.key}`}
                    onChange={(e) => set({ colors: { ...cfg.colors, [item.key]: e.target.value } })}
                  />
                  <span className="name" title={item.key}>
                    {item.key || "(sans nom)"}
                  </span>
                  {cfg.colors[item.key] && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        const next = { ...cfg.colors };
                        delete next[item.key];
                        set({ colors: next });
                      }}
                    >
                      Par défaut
                    </button>
                  )}
                </div>
              ))}
              {legend.length > 40 && <p className="hint">+ {legend.length - 40} autre(s) : couleurs de la palette.</p>}
            </div>
          </Field>
        )}

        {(has("colorscale") && (!hierarchy || cfg.varyColors)) && (
          <Field label="Dégradé (valeurs continues)">
            <select value={cfg.colorscale} onChange={(e) => set({ colorscale: e.target.value })}>
              {COLORSCALES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div
              className="cb-gradient"
              style={{ background: colorscalePreview(cfg.colorscale, cfg.reverseScale, cfg.scaleFrom, cfg.scaleTo) }}
              aria-hidden
            />
            {cfg.colorscale === "custom" && (
              <div className="cb-row2">
                <label className="cb-color">
                  <input type="color" value={cfg.scaleFrom} onChange={(e) => set({ scaleFrom: e.target.value })} />
                  Valeur basse
                </label>
                <label className="cb-color">
                  <input type="color" value={cfg.scaleTo} onChange={(e) => set({ scaleTo: e.target.value })} />
                  Valeur haute
                </label>
              </div>
            )}
            <Toggle label="Inverser le dégradé" checked={cfg.reverseScale} onChange={(v) => set({ reverseScale: v })} />
            {(cfg.type === "scatter" || cfg.type === "bubble" || cfg.type === "scatter3d" || cfg.type === "splom" || cfg.type === "parallel" || cfg.type === "mapBubble") && (
              <p className="hint">Utilisé quand la colonne « Couleur » est numérique.</p>
            )}
          </Field>
        )}

        {has("opacity") && (
          <Range label="Opacité" min={0.1} max={1} step={0.05} value={cfg.opacity} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ opacity: v })} />
        )}

        <Field label="Arrière-plan">
          <select
            value={cfg.background}
            onChange={(e) => set({ background: e.target.value as ChartConfig["background"] })}
            aria-label="Arrière-plan"
          >
            <option value="transparent">Transparent (suit le thème)</option>
            <option value="custom">Couleur personnalisée</option>
          </select>
          {cfg.background === "custom" && (
            <label className="cb-color">
              <input type="color" value={cfg.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />
              {cfg.bgColor}
            </label>
          )}
        </Field>
      </Group>

      {/* ------------------------------------------------ Titre & texte */}
      <Group title="Titre & texte" icon={<Type size={15} />} open>
        <Toggle label="Afficher le titre" checked={cfg.showTitle} onChange={(v) => set({ showTitle: v })} />
        {cfg.showTitle && (
          <>
            <Field label="Titre">
              <input
                type="text"
                value={cfg.title}
                placeholder={autoTitle(cfg)}
                onChange={(e) => set({ title: e.target.value })}
              />
            </Field>
            <Field label="Alignement du titre">
              <select value={cfg.titleAlign} onChange={(e) => set({ titleAlign: e.target.value as ChartConfig["titleAlign"] })}>
                <option value="left">À gauche</option>
                <option value="center">Centré</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Police">
          <select value={cfg.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Range label="Taille du texte" min={9} max={20} step={1} value={cfg.fontSize} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
      </Group>

      {/* --------------------------------------------------------- Axes */}
      {has("axes") && (
        <Group title="Axes" icon={<Ruler size={15} />}>
          <AxisTitle label="Titre de l'axe X" value={cfg.xTitle} onChange={(v) => set({ xTitle: v })} />
          <AxisTitle label="Titre de l'axe Y" value={cfg.yTitle} onChange={(v) => set({ yTitle: v })} />
          {has("y2") && <AxisTitle label="Titre de l'axe secondaire" value={cfg.y2Title} onChange={(v) => set({ y2Title: v })} />}
          <Toggle label="Quadrillage" checked={cfg.grid} onChange={(v) => set({ grid: v })} />
          <Field label="Inclinaison des libellés de l'axe X">
            <select
              value={cfg.xAngle === null ? "auto" : String(cfg.xAngle)}
              onChange={(e) => set({ xAngle: e.target.value === "auto" ? null : Number(e.target.value) })}
            >
              <option value="auto">Automatique</option>
              <option value="0">Horizontale (0°)</option>
              <option value="-30">−30°</option>
              <option value="-45">−45°</option>
              <option value="-90">Verticale (−90°)</option>
            </select>
          </Field>
          <Toggle label="Échelle logarithmique (axe des valeurs)" checked={cfg.yLog} onChange={(v) => set({ yLog: v })} />
          {!cfg.yLog && (
            <Field label="Bornes de l'axe des valeurs" hint="Dans l'unité affichée ; vide = automatique.">
              <div className="cb-row2">
                <NumberInput placeholder="Min. auto" value={cfg.yMin} onChange={(v) => set({ yMin: v })} />
                <NumberInput placeholder="Max. auto" value={cfg.yMax} onChange={(v) => set({ yMax: v })} />
              </div>
            </Field>
          )}
        </Group>
      )}

      {/* ------------------------------------------------------- Légende */}
      {has("legend") && (
        <Group title="Légende" icon={<Tag size={15} />}>
          <Field label="Position">
            <select value={cfg.legend} onChange={(e) => set({ legend: e.target.value as LegendPosition })}>
              <option value="top">En haut</option>
              <option value="bottom">En bas</option>
              <option value="right">À droite</option>
              <option value="left">À gauche</option>
              <option value="hidden">Masquée</option>
            </select>
          </Field>
        </Group>
      )}

      {/* ------------------------------------- Étiquettes & nombres */}
      {(has("labels") || has("numbers")) && (
        <Group title="Étiquettes & nombres" icon={<Hash size={15} />}>
          {has("labels") && (
            <Toggle label="Afficher les étiquettes de données" checked={cfg.labels} onChange={(v) => set({ labels: v })} />
          )}
          {has("labelPos") && cfg.labels && (
            <Field label="Position des étiquettes">
              <select value={cfg.labelPosition} onChange={(e) => set({ labelPosition: e.target.value as LabelPosition })}>
                <option value="auto">Automatique</option>
                <option value="inside">À l&apos;intérieur</option>
                <option value="outside">À l&apos;extérieur</option>
              </select>
            </Field>
          )}
          {has("pie") && cfg.labels && (
            <Field label="Contenu des étiquettes">
              <select value={cfg.pieText} onChange={(e) => set({ pieText: e.target.value as PieText })}>
                <option value="percent">Pourcentage</option>
                <option value="value">Valeur</option>
                <option value="label">Catégorie</option>
                <option value="label+percent">Catégorie et pourcentage</option>
                <option value="label+value">Catégorie et valeur</option>
              </select>
            </Field>
          )}
          {has("numbers") && (
            <>
              <div className="cb-row2">
                <Field label="Décimales">
                  <select value={cfg.decimals} onChange={(e) => set({ decimals: Number(e.target.value) })}>
                    <option value={-1}>Auto</option>
                    {[0, 1, 2, 3, 4].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Unités d'affichage">
                  <select value={cfg.unit} onChange={(e) => set({ unit: e.target.value as DisplayUnit })}>
                    <option value="auto">Automatique</option>
                    <option value="none">Aucune</option>
                    <option value="k">Milliers (k)</option>
                    <option value="M">Millions (M)</option>
                    <option value="Md">Milliards (Md)</option>
                  </select>
                </Field>
              </div>
              <div className="cb-row2">
                <Field label="Préfixe">
                  <input type="text" value={cfg.prefix} placeholder="ex. $" onChange={(e) => set({ prefix: e.target.value })} />
                </Field>
                <Field label="Suffixe">
                  <input type="text" value={cfg.suffix} placeholder="ex.  GNF" onChange={(e) => set({ suffix: e.target.value })} />
                </Field>
              </div>
            </>
          )}
        </Group>
      )}

      {/* --------------------------------------------- Style du type */}
      {styleControls.length > 0 && (
        <Group title={`Style — ${def.label}`} icon={<Brush size={15} />} open>
          {styleControls}
        </Group>
      )}

      {/* --------------------------------------------------- Disposition */}
      <Group title="Disposition" icon={<LayoutGrid size={15} />}>
        <Range label="Hauteur" min={200} max={900} step={10} value={cfg.height} format={(v) => `${v} px`} onChange={(v) => set({ height: v })} />
        <Field label="Largeur dans le tableau de bord">
          <select value={cfg.span} onChange={(e) => set({ span: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>Demi-largeur</option>
            <option value={2}>Pleine largeur</option>
          </select>
        </Field>
      </Group>

      <div className="cb-pane-actions">
        {onApplyStyleToAll && (
          <button type="button" className="btn small" onClick={onApplyStyleToAll}>
            <Shapes size={14} /> Appliquer ce style à tous les graphiques
          </button>
        )}
        <button type="button" className="btn small" onClick={onResetStyle}>
          Réinitialiser la mise en forme
        </button>
      </div>
    </div>
  );
}

// Réglages propres au type de graphique.
function renderStyle(
  cfg: ChartConfig,
  set: (p: Partial<ChartConfig>) => void,
  has: (f: Parameters<typeof hasFeature>[1]) => boolean,
  legend: LegendItem[],
): ReactNode[] {
  const out: ReactNode[] = [];
  const push = (key: string, node: ReactNode) => out.push(<div key={key}>{node}</div>);

  if (has("barMode")) {
    const options: [BarMode, string][] =
      cfg.type === "area"
        ? [["overlay", "Superposées"], ["stack", "Empilées"], ["percent", "Empilées à 100 %"]]
        : cfg.type === "histogram"
          ? [["overlay", "Superposés"], ["stack", "Empilés"], ["group", "Côte à côte"]]
          : [["group", "Groupées"], ["stack", "Empilées"], ["percent", "Empilées à 100 %"], ["overlay", "Superposées"]];
    push(
      "barMode",
      <Field label="Disposition des séries">
        <select value={cfg.barMode} onChange={(e) => set({ barMode: e.target.value as BarMode })}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>,
    );
  }
  if (has("horizontal")) {
    push("horizontal", <Toggle label="Orientation horizontale" checked={cfg.horizontal} onChange={(v) => set({ horizontal: v })} />);
  }
  if (has("barStyle")) {
    push("gap", <Range label="Espacement entre les barres" min={0} max={0.8} step={0.05} value={cfg.barGap} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ barGap: v })} />);
    if (cfg.type !== "histogram" && cfg.type !== "waterfall") {
      push("corner", <Range label="Arrondi des coins" min={0} max={20} step={1} value={cfg.cornerRadius} format={(v) => `${v} px`} onChange={(v) => set({ cornerRadius: v })} />);
    }
  }
  if (has("line")) {
    if (cfg.type !== "density") {
      push(
        "shape",
        <Field label="Forme des courbes">
          <select value={cfg.lineShape} onChange={(e) => set({ lineShape: e.target.value as LineShape })}>
            <option value="linear">Segments droits</option>
            <option value="spline">Lissée</option>
            {cfg.type !== "radar" && <option value="hv">En escalier</option>}
          </select>
        </Field>,
      );
    }
    push("width", <Range label="Épaisseur des traits" min={1} max={8} step={0.5} value={cfg.lineWidth} format={(v) => `${v} px`} onChange={(v) => set({ lineWidth: v })} />);
    push(
      "dash",
      <Field label="Type de trait">
        <select value={cfg.dash} onChange={(e) => set({ dash: e.target.value as DashStyle })}>
          <option value="solid">Continu</option>
          <option value="dash">Tirets</option>
          <option value="dot">Pointillés</option>
          <option value="dashdot">Tiret-point</option>
        </select>
      </Field>,
    );
  }
  if (has("fill")) {
    push("fill", <Toggle label="Remplir la surface" checked={cfg.fill} onChange={(v) => set({ fill: v })} />);
  }
  if (has("markers") || has("bubble")) {
    const always = ALWAYS_MARKERS.has(cfg.type);
    if (!always && has("markers")) {
      push(
        "markers",
        <Toggle
          label={cfg.type === "density2d" ? "Afficher les points" : "Afficher les marqueurs"}
          checked={cfg.markers}
          onChange={(v) => set({ markers: v })}
        />,
      );
    }
    if ((always || cfg.markers) && has("markers")) {
      push("msize", <Range label="Taille des points" min={2} max={30} step={1} value={cfg.markerSize} format={(v) => `${v} px`} onChange={(v) => set({ markerSize: v })} />);
      if (cfg.type !== "density2d") {
        push(
          "symbol",
          <Field label="Forme des points">
            <select value={cfg.markerSymbol} onChange={(e) => set({ markerSymbol: e.target.value as MarkerSymbol })}>
              <option value="circle">Cercle</option>
              <option value="square">Carré</option>
              <option value="diamond">Losange</option>
              <option value="triangle-up">Triangle</option>
              <option value="cross">Croix</option>
              <option value="x">X</option>
              {cfg.type !== "scatter3d" && <option value="star">Étoile</option>}
            </select>
          </Field>,
        );
      }
    }
  }
  if (has("bubble")) {
    push("bubble", <Range label="Taille maximale des bulles" min={10} max={90} step={2} value={cfg.maxBubble} format={(v) => `${v} px`} onChange={(v) => set({ maxBubble: v })} />);
  }
  if (has("pie")) {
    push("hole", <Range label="Taille du trou central" min={0} max={0.85} step={0.05} value={cfg.hole} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ hole: v })} />);
  }
  if (has("hist")) {
    push("bins", <Range label="Nombre de classes" min={0} max={100} step={1} value={cfg.bins} format={(v) => (v === 0 ? "Auto" : String(v))} onChange={(v) => set({ bins: v })} />);
    push(
      "norm",
      <Field label="Hauteur des barres">
        <select value={cfg.histNorm} onChange={(e) => set({ histNorm: e.target.value as HistNorm })}>
          <option value="count">Effectif</option>
          <option value="percent">Pourcentage</option>
          <option value="density">Densité de probabilité</option>
        </select>
      </Field>,
    );
    push("cum", <Toggle label="Cumulé" checked={cfg.cumulative} onChange={(v) => set({ cumulative: v })} />);
    push("kde", <Toggle label="Superposer la courbe de densité (KDE)" checked={cfg.kde} onChange={(v) => set({ kde: v })} />);
  }
  if (has("kde") && (cfg.type !== "histogram" || cfg.kde)) {
    push("bw", <Range label="Lissage de la densité" min={0.2} max={3} step={0.1} value={cfg.bandwidth} format={(v) => `× ${v.toFixed(1)}`} onChange={(v) => set({ bandwidth: v })} />);
  }
  if (has("box")) {
    push(
      "points",
      <Field label="Points affichés">
        <select value={cfg.boxPoints} onChange={(e) => set({ boxPoints: e.target.value as BoxPoints })}>
          <option value="none">Aucun</option>
          <option value="outliers">Valeurs atypiques</option>
          <option value="all">Tous les points</option>
        </select>
      </Field>,
    );
    push("mean", <Toggle label="Afficher la moyenne" checked={cfg.showMean} onChange={(v) => set({ showMean: v })} />);
    if (cfg.type === "box") push("notch", <Toggle label="Encoche (intervalle de confiance de la médiane)" checked={cfg.notched} onChange={(v) => set({ notched: v })} />);
  }
  if (has("trend")) {
    push(
      "trend",
      <Field label="Courbe de tendance">
        <select value={cfg.trend} onChange={(e) => set({ trend: e.target.value as TrendKind })}>
          <option value="none">Aucune</option>
          <option value="linear">Linéaire</option>
          <option value="poly2">Polynomiale (degré 2)</option>
          <option value="poly3">Polynomiale (degré 3)</option>
          <option value="exp">Exponentielle</option>
          <option value="log">Logarithmique</option>
          <option value="power">Puissance</option>
          <option value="movavg">Moyenne mobile</option>
        </select>
      </Field>,
    );
    if (cfg.trend === "movavg") {
      push("window", <Range label="Périodes de la moyenne mobile" min={2} max={30} step={1} value={cfg.movingWindow} format={String} onChange={(v) => set({ movingWindow: v })} />);
    }
  }
  if (has("waterfall")) {
    push("total", <Toggle label="Barre de total" checked={cfg.showTotal} onChange={(v) => set({ showTotal: v })} />);
  }
  if (has("gauge")) {
    push(
      "gshape",
      <Field label="Forme">
        <select value={cfg.gaugeShape} onChange={(e) => set({ gaugeShape: e.target.value as ChartConfig["gaugeShape"] })}>
          <option value="angular">Cadran</option>
          <option value="bullet">Linéaire (bullet)</option>
        </select>
      </Field>,
    );
    push(
      "grange",
      <Field label="Minimum et maximum" hint="Vide = automatique.">
        <div className="cb-row2">
          <NumberInput placeholder="Min. auto" value={cfg.gaugeMin} onChange={(v) => set({ gaugeMin: v })} />
          <NumberInput placeholder="Max. auto" value={cfg.gaugeMax} onChange={(v) => set({ gaugeMax: v })} />
        </div>
      </Field>,
    );
    push("bands", <Toggle label="Zones colorées (0–50 %, 50–80 %, 80–100 %)" checked={cfg.gaugeBands} onChange={(v) => set({ gaugeBands: v })} />);
  }
  if (has("gauge") || has("kpi")) {
    push(
      "target",
      <Field label="Objectif / valeur de référence" hint="Affiche l'écart à l'objectif.">
        <NumberInput placeholder="Aucun" value={cfg.target} onChange={(v) => set({ target: v })} />
      </Field>,
    );
  }
  if (has("corr")) {
    push("tri", <Toggle label="Moitié inférieure seulement" checked={cfg.triangle} onChange={(v) => set({ triangle: v })} />);
  }
  if (has("contour")) {
    push(
      "contour",
      <Field label="Représentation">
        <select value={cfg.contour ? "contour" : "tiles"} onChange={(e) => set({ contour: e.target.value === "contour" })}>
          <option value="contour">Courbes de niveau</option>
          <option value="tiles">Carreaux (histogramme 2D)</option>
        </select>
      </Field>,
    );
    push("bins2d", <Range label="Finesse de la grille" min={0} max={80} step={1} value={cfg.bins} format={(v) => (v === 0 ? "Auto" : String(v))} onChange={(v) => set({ bins: v })} />);
  }
  if (has("combo") && legend.length > 0) {
    push(
      "combo",
      <Field label="Représentation de chaque série">
        <div className="cb-combo">
          {legend.map((item, i) => (
            <div key={item.key} className="cb-combo-row">
              <span className="name" title={item.key}>
                <span className="sw" style={{ background: item.color }} />
                {item.key}
              </span>
              <select
                aria-label={`Type de ${item.key}`}
                value={cfg.seriesRender[item.key] ?? (i === 0 ? "bar" : "line")}
                onChange={(e) => set({ seriesRender: { ...cfg.seriesRender, [item.key]: e.target.value as SeriesRender } })}
              >
                <option value="bar">Colonnes</option>
                <option value="line">Courbe</option>
                <option value="area">Aire</option>
              </select>
              <select
                aria-label={`Axe de ${item.key}`}
                value={cfg.seriesAxis[item.key] ?? (i === 0 ? "y" : "y2")}
                onChange={(e) => set({ seriesAxis: { ...cfg.seriesAxis, [item.key]: e.target.value as "y" | "y2" } })}
              >
                <option value="y">Axe principal</option>
                <option value="y2">Axe secondaire</option>
              </select>
            </div>
          ))}
        </div>
      </Field>,
    );
  }
  return out;
}

// ---------------------------------------------------------------- contrôles

function Group({ title, icon, open, children }: { title: string; icon: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="cb-group" open={open}>
      <summary>
        {icon}
        {title}
      </summary>
      <div className="cb-group-body">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cb-field">
      <span className="cb-label">{label}</span>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="cb-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="cb-field">
      <span className="cb-label">{label}</span>
      <div className="cb-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{format(value)}</output>
      </div>
    </div>
  );
}

function NumberInput({ value, placeholder, onChange }: { value: number | null; placeholder: string; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      step="any"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value.trim();
        const n = raw === "" ? null : Number(raw.replace(",", "."));
        onChange(n === null || Number.isFinite(n) ? n : null);
      }}
    />
  );
}

// Titre d'axe : automatique (null), masqué ("") ou personnalisé.
function AxisTitle({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const hidden = value === "";
  return (
    <div className="cb-field">
      <span className="cb-label">{label}</span>
      <div className="cb-row2 cb-row-axis">
        <input
          type="text"
          value={value ?? ""}
          disabled={hidden}
          placeholder={hidden ? "Masqué" : "Automatique"}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
        <label className="cb-toggle">
          <input type="checkbox" checked={!hidden} onChange={(e) => onChange(e.target.checked ? null : "")} />
          Afficher
        </label>
      </div>
    </div>
  );
}

// <input type="color"> n'accepte que #rrggbb.
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return "#" + color.slice(1).split("").map((c) => c + c).join("");
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (m) return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return "#000000";
}
