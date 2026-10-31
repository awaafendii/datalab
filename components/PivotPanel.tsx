"use client";

import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { ColumnType, Dataset, DatasetProfile } from "@/lib/types";
import type { ColumnKind } from "@/lib/charts/types";
import { axisKey } from "@/lib/charts/data";
import { computePivot } from "@/lib/pivot/engine";
import {
  PIVOT_AGG_LABEL,
  type PivotAgg,
  type PivotConfig,
  type PivotField,
  type PivotValue,
} from "@/lib/pivot/types";

function kindOf(type: ColumnType): ColumnKind {
  return type === "number" ? "number" : type === "date" ? "date" : "category";
}

const NUMERIC_AGGS: PivotAgg[] = ["sum", "mean", "median", "min", "max", "std", "var", "count", "distinct"];
const NON_NUMERIC_AGGS: PivotAgg[] = ["count", "distinct"];

export default function PivotPanel({
  dataset,
  profile,
  config,
  onChange,
}: {
  dataset: Dataset;
  profile: DatasetProfile;
  config: PivotConfig;
  onChange: (config: PivotConfig) => void;
}) {
  const kinds = useMemo(() => {
    const m = new Map<string, ColumnKind>();
    for (const c of profile.columns) m.set(c.name, kindOf(c.type));
    return m;
  }, [profile]);

  const columns = profile.columns.map((c) => c.name);
  const numericColumns = profile.columns.filter((c) => c.type === "number").map((c) => c.name);
  const field = (column: string): PivotField => ({ column, kind: kinds.get(column) ?? "category" });

  // Composant contrôlé : la configuration vit au niveau de la feuille (page).
  // Ce relais applique l'ancienne forme setConfig(updater) à la prop.
  const setConfig = (updater: (c: PivotConfig) => PivotConfig) => onChange(updater(config));

  const result = useMemo(() => computePivot(dataset, config), [dataset, config]);

  const used = new Set([
    ...config.rows.map((f) => f.column),
    ...config.columns.map((f) => f.column),
  ]);
  const available = (zone: "rows" | "columns") =>
    columns.filter((c) => !used.has(c) || config[zone].some((f) => f.column === c));

  // --- mutations de configuration ---
  const addField = (zone: "rows" | "columns", column: string) =>
    setConfig((c) => ({ ...c, [zone]: [...c[zone], field(column)] }));
  const removeField = (zone: "rows" | "columns", column: string) =>
    setConfig((c) => ({ ...c, [zone]: c[zone].filter((f) => f.column !== column) }));
  const setBucket = (zone: "rows" | "columns", column: string, bucket: PivotField["bucket"]) =>
    setConfig((c) => ({
      ...c,
      [zone]: c[zone].map((f) => (f.column === column ? { ...f, bucket } : f)),
    }));

  const addValue = () =>
    setConfig((c) => ({
      ...c,
      values: [
        ...c.values,
        numericColumns[0] ? { column: numericColumns[0], agg: "sum" } : { column: null, agg: "count" },
      ],
    }));
  const setValue = (i: number, patch: Partial<PivotValue>) =>
    setConfig((c) => ({ ...c, values: c.values.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const removeValue = (i: number) =>
    setConfig((c) => ({ ...c, values: c.values.filter((_, j) => j !== i) }));

  // --- filtres ---
  const distinctKeys = (column: string) => {
    const kind = kinds.get(column) ?? "category";
    const m = new Map<string, string>();
    for (const row of dataset.rows) {
      const k = axisKey(row[column], kind, "none");
      if (k && !m.has(k.key)) m.set(k.key, k.label);
      if (m.size > 300) break;
    }
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  };
  const addFilter = (column: string) =>
    setConfig((c) => ({
      ...c,
      filters: [...c.filters, { column, kind: kinds.get(column) ?? "category", include: [] }],
    }));
  const toggleFilterKey = (column: string, key: string) =>
    setConfig((c) => ({
      ...c,
      filters: c.filters.map((f) => {
        if (f.column !== column) return f;
        const include = f.include.includes(key)
          ? f.include.filter((k) => k !== key)
          : [...f.include, key];
        return { ...f, include };
      }),
    }));
  const removeFilter = (column: string) =>
    setConfig((c) => ({ ...c, filters: c.filters.filter((f) => f.column !== column) }));

  const colCount = Math.max(1, result.columnLeaves.length) * result.values.length;
  const rowFieldCount = Math.max(1, config.rows.length);

  return (
    <div>
      <p className="subtitle">
        Placez vos colonnes en lignes, en colonnes et en valeurs — comme le
        tableau croisé dynamique d&apos;Excel. Plusieurs niveaux, plusieurs
        mesures, sous-totaux, totaux et filtres. Tout se recalcule en direct.
      </p>

      <div className="pivot-zones">
        <ZoneFields
          title="Lignes"
          fields={config.rows}
          options={available("rows")}
          kinds={kinds}
          onAdd={(c) => addField("rows", c)}
          onRemove={(c) => removeField("rows", c)}
          onBucket={(c, b) => setBucket("rows", c, b)}
        />
        <ZoneFields
          title="Colonnes"
          fields={config.columns}
          options={available("columns")}
          kinds={kinds}
          onAdd={(c) => addField("columns", c)}
          onRemove={(c) => removeField("columns", c)}
          onBucket={(c, b) => setBucket("columns", c, b)}
        />

        <div className="pivot-zone">
          <h4>Valeurs</h4>
          {config.values.map((v, i) => {
            const aggs = v.column && numericColumns.includes(v.column) ? NUMERIC_AGGS : NON_NUMERIC_AGGS;
            return (
              <div key={i} className="pivot-value">
                <select
                  value={v.column ?? ""}
                  onChange={(e) => setValue(i, { column: e.target.value || null })}
                >
                  <option value="">Nombre de lignes</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={aggs.includes(v.agg) ? v.agg : aggs[0]}
                  onChange={(e) => setValue(i, { agg: e.target.value as PivotAgg })}
                >
                  {aggs.map((a) => (
                    <option key={a} value={a}>
                      {PIVOT_AGG_LABEL[a]}
                    </option>
                  ))}
                </select>
                {config.values.length > 1 && (
                  <button type="button" className="icon-btn" onClick={() => removeValue(i)} aria-label="Retirer">
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="btn small" onClick={addValue}>
            <Plus size={14} /> Ajouter une mesure
          </button>
        </div>

        <div className="pivot-zone">
          <h4>Filtres</h4>
          {config.filters.map((f) => {
            const keys = distinctKeys(f.column);
            return (
              <details key={f.column} className="pivot-filter">
                <summary>
                  {f.column}
                  {f.include.length > 0 ? ` (${f.include.length})` : ""}
                  <span
                    className="icon-btn"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      removeFilter(f.column);
                    }}
                    aria-label="Retirer le filtre"
                  >
                    <X size={13} />
                  </span>
                </summary>
                <div className="pivot-filter-keys">
                  {keys.map((k) => (
                    <label key={k.key}>
                      <input
                        type="checkbox"
                        checked={f.include.length === 0 || f.include.includes(k.key)}
                        onChange={() => toggleFilterKey(f.column, k.key)}
                      />
                      {k.label}
                    </label>
                  ))}
                  {keys.length === 0 && <span className="hint">Aucune valeur.</span>}
                </div>
              </details>
            );
          })}
          <AddSelect
            placeholder="+ Ajouter un filtre"
            options={columns.filter((c) => !config.filters.some((f) => f.column === c))}
            onPick={addFilter}
          />
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 4, marginBottom: 12 }}>
        <label className="check inline">
          <input
            type="checkbox"
            checked={config.rowSubtotals}
            onChange={(e) => setConfig((c) => ({ ...c, rowSubtotals: e.target.checked }))}
          />
          Sous-totaux
        </label>
        <label className="check inline">
          <input
            type="checkbox"
            checked={config.grandTotal}
            onChange={(e) => setConfig((c) => ({ ...c, grandTotal: e.target.checked }))}
          />
          Totaux généraux
        </label>
      </div>

      {result.warnings.map((w, i) => (
        <p key={i} className="hint">
          {w}
        </p>
      ))}

      <div className="table-wrap tall">
        <table className="data pivot-table">
          <thead>
            {result.headerRows.map((hr, ri) => (
              <tr key={ri}>
                {ri === 0 && (
                  <th
                    colSpan={rowFieldCount}
                    rowSpan={result.headerRows.length}
                    className="pivot-corner"
                  >
                    {result.rowFieldLabels.join(" / ") || "Total"}
                  </th>
                )}
                {hr.map((h, ci) => (
                  <th key={ci} colSpan={h.span} className="num">
                    {h.label}
                  </th>
                ))}
                {ri === 0 && config.grandTotal && result.columnLeaves.length > 0 && (
                  <th
                    colSpan={result.values.length}
                    rowSpan={result.headerRows.length}
                    className="num pivot-total-col"
                  >
                    Total général
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {result.rows.map((row, ri) => {
              const cls =
                row.kind === "subtotal" ? "pv-subtotal" : row.kind === "grandtotal" ? "pv-total" : "";
              return (
                <tr key={ri} className={cls}>
                  {renderRowLabels(row, config.rows.length)}
                  {row.cells.map((perValue, ci) =>
                    perValue.map((cell, vi) => (
                      <td key={`${ci}-${vi}`} className="num">
                        {cell.display}
                      </td>
                    )),
                  )}
                  {config.grandTotal &&
                    result.columnLeaves.length > 0 &&
                    row.totals.map((cell, vi) => (
                      <td key={`t-${vi}`} className="num pivot-total-col">
                        {cell.display}
                      </td>
                    ))}
                </tr>
              );
            })}
            {result.grandTotalRow && (
              <tr className="pv-total">
                {renderRowLabels(result.grandTotalRow, config.rows.length)}
                {result.grandTotalRow.cells.map((perValue, ci) =>
                  perValue.map((cell, vi) => (
                    <td key={`${ci}-${vi}`} className="num">
                      {cell.display}
                    </td>
                  )),
                )}
                {config.grandTotal &&
                  result.columnLeaves.length > 0 &&
                  result.grandTotalRow.totals.map((cell, vi) => (
                    <td key={`t-${vi}`} className="num pivot-total-col">
                      {cell.display}
                    </td>
                  ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        {result.rows.length} ligne(s) · {colCount} colonne(s) de données.
      </p>
    </div>
  );
}

// Libellés de lignes : une cellule d'en-tête par champ ligne, avec
// indentation et fusion visuelle des sous-totaux.
function renderRowLabels(
  row: { labels: string[]; depth: number; kind: string },
  rowFieldCount: number,
) {
  if (rowFieldCount === 0) {
    return <th className="pivot-rowhead">{row.labels[0] ?? "Total"}</th>;
  }
  if (row.kind === "subtotal") {
    const label = `Total ${row.labels[row.depth] ?? ""}`.trim();
    return (
      <th className="pivot-rowhead" colSpan={rowFieldCount}>
        {label}
      </th>
    );
  }
  if (row.kind === "grandtotal") {
    return (
      <th className="pivot-rowhead" colSpan={rowFieldCount}>
        {row.labels[0] || "Total général"}
      </th>
    );
  }
  return (
    <>
      {Array.from({ length: rowFieldCount }).map((_, i) => (
        <th key={i} className="pivot-rowhead">
          {row.labels[i] ?? ""}
        </th>
      ))}
    </>
  );
}

function ZoneFields({
  title,
  fields,
  options,
  kinds,
  onAdd,
  onRemove,
  onBucket,
}: {
  title: string;
  fields: PivotField[];
  options: string[];
  kinds: Map<string, ColumnKind>;
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
  onBucket: (c: string, b: PivotField["bucket"]) => void;
}) {
  const free = options.filter((c) => !fields.some((f) => f.column === c));
  return (
    <div className="pivot-zone">
      <h4>{title}</h4>
      {fields.map((f) => (
        <div key={f.column} className="chip">
          <span className="chip-label">{f.column}</span>
          {kinds.get(f.column) === "date" && (
            <select
              value={f.bucket ?? "none"}
              onChange={(e) => onBucket(f.column, e.target.value as PivotField["bucket"])}
              aria-label="Regroupement des dates"
            >
              <option value="none">exact</option>
              <option value="day">jour</option>
              <option value="month">mois</option>
              <option value="quarter">trimestre</option>
              <option value="year">année</option>
            </select>
          )}
          <button type="button" className="icon-btn" onClick={() => onRemove(f.column)} aria-label="Retirer">
            <X size={14} />
          </button>
        </div>
      ))}
      <AddSelect placeholder="+ Ajouter" options={free} onPick={onAdd} />
      {fields.length === 0 && <span className="hint">Aucun champ.</span>}
    </div>
  );
}

function AddSelect({
  placeholder,
  options,
  onPick,
}: {
  placeholder: string;
  options: string[];
  onPick: (c: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <select
      className="pivot-add"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
