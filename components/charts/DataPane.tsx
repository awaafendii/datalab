"use client";

import { AGG_LABELS, chartDef, hasFeature, type RoleSpec } from "@/lib/charts/catalog";
import type { ChartConfig, ColumnInfo, ColumnKind, DateBucket, SortMode } from "@/lib/charts/types";
import { MAP_LEVELS } from "@/lib/charts/geo";

const KIND_LABEL: Record<ColumnKind, string> = {
  number: "nombre",
  date: "date",
  category: "texte",
};

const ACCEPT_LABEL: Record<ColumnKind, string> = {
  number: "numérique",
  date: "de dates",
  category: "de texte",
};

interface Props {
  cfg: ChartConfig;
  columns: ColumnInfo[];
  onChange: (cfg: ChartConfig) => void;
}

export default function DataPane({ cfg, columns, onChange }: Props) {
  const def = chartDef(cfg.type);
  const byName = new Map(columns.map((c) => [c.name, c]));
  const set = (patch: Partial<ChartConfig>) => onChange({ ...cfg, ...patch });
  const setRole = (key: RoleSpec["key"], value: string[]) =>
    onChange({ ...cfg, roles: { ...cfg.roles, [key]: value } });

  const x = cfg.roles.x?.[0];
  const xIsDate = x ? byName.get(x)?.kind === "date" : false;
  const valueSpec = def.roles.find((r) => r.key === "y");
  const noValue = valueSpec !== undefined && !valueSpec.required && (cfg.roles.y ?? []).length === 0;

  return (
    <div className="cb-stack">
      {def.roles.map((spec) => (
        <RoleField
          key={spec.key}
          spec={spec}
          columns={columns}
          value={(cfg.roles[spec.key] ?? []).filter((n) => byName.has(n))}
          onChange={(v) => setRole(spec.key, v)}
        />
      ))}

      {def.aggs.length > 0 && (
        <div className="cb-field">
          <label className="cb-label" htmlFor="cb-agg">
            Calcul
          </label>
          <select
            id="cb-agg"
            value={def.aggs.includes(cfg.agg) ? cfg.agg : def.aggs[0]}
            disabled={noValue}
            onChange={(e) => set({ agg: e.target.value as ChartConfig["agg"] })}
          >
            {def.aggs.map((a) => (
              <option key={a} value={a}>
                {AGG_LABELS[a]}
              </option>
            ))}
          </select>
          {noValue && <p className="hint">Sans colonne de valeurs, le graphique compte les lignes.</p>}
        </div>
      )}

      {hasFeature(cfg.type, "map") && (
        <div className="cb-field">
          <label className="cb-label" htmlFor="cb-map">
            Fond de carte
          </label>
          <select
            id="cb-map"
            value={cfg.mapLevel}
            onChange={(e) => set({ mapLevel: e.target.value as ChartConfig["mapLevel"] })}
          >
            <option value="auto">
              Automatique
              {x && byName.get(x)?.geo
                ? ` (${MAP_LEVELS.find((l) => l.id === byName.get(x)?.geo)?.label})`
                : ""}
            </option>
            {MAP_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="hint">
            Noms rapprochés sans tenir compte des accents, des majuscules ni de « Région de… » ;
            codes ISO acceptés (GN-D, GIN, GN). Fonds inclus : fonctionne hors ligne.
          </p>
        </div>
      )}

      {hasFeature(cfg.type, "dateBucket") && xIsDate && (
        <div className="cb-field">
          <label className="cb-label" htmlFor="cb-bucket">
            Regrouper les dates par
          </label>
          <select
            id="cb-bucket"
            value={cfg.dateBucket}
            onChange={(e) => set({ dateBucket: e.target.value as DateBucket })}
          >
            <option value="none">Aucun regroupement</option>
            <option value="day">Jour</option>
            <option value="month">Mois</option>
            <option value="quarter">Trimestre</option>
            <option value="year">Année</option>
          </select>
        </div>
      )}

      {hasFeature(cfg.type, "sortTop") && (
        <>
          <div className="cb-field">
            <label className="cb-label" htmlFor="cb-sort">
              Tri des catégories
            </label>
            <select id="cb-sort" value={cfg.sort} onChange={(e) => set({ sort: e.target.value as SortMode })}>
              <option value="auto">Automatique</option>
              <option value="value-desc">Valeur décroissante</option>
              <option value="value-asc">Valeur croissante</option>
              <option value="label-asc">Libellé A → Z</option>
              <option value="label-desc">Libellé Z → A</option>
              <option value="none">Ordre du fichier</option>
            </select>
          </div>
          <div className="cb-field">
            <label className="cb-label" htmlFor="cb-topn">
              Afficher les N premières catégories
            </label>
            <div className="cb-row2">
              <input
                id="cb-topn"
                type="number"
                min={0}
                step={1}
                placeholder="Toutes"
                value={cfg.topN > 0 ? cfg.topN : ""}
                onChange={(e) => set({ topN: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
              <label className="cb-toggle">
                <input
                  type="checkbox"
                  checked={cfg.others}
                  disabled={cfg.topN === 0}
                  onChange={(e) => set({ others: e.target.checked })}
                />
                Regrouper le reste en « Autres »
              </label>
            </div>
            <p className="hint">Les plus grandes par valeur ; vide = toutes.</p>
          </div>
        </>
      )}
    </div>
  );
}

function RoleField({
  spec,
  columns,
  value,
  onChange,
}: {
  spec: RoleSpec;
  columns: ColumnInfo[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const eligible = columns.filter((c) => spec.accepts.includes(c.kind));
  const id = `cb-role-${spec.key}`;
  const label = (
    <span className="cb-label">
      {spec.label}
      {spec.required ? <span className="cb-req"> *</span> : <span className="cb-opt"> (facultatif)</span>}
    </span>
  );

  if (eligible.length === 0) {
    return (
      <div className="cb-field">
        {label}
        <p className="hint">
          Aucune colonne {spec.accepts.map((k) => ACCEPT_LABEL[k]).join(" ou ")} dans cette feuille.
        </p>
      </div>
    );
  }

  if (!spec.multiple) {
    return (
      <div className="cb-field">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value[0] ?? ""} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
          <option value="">{spec.required ? "— Choisir une colonne —" : "— Aucune —"}</option>
          {eligible.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} · {KIND_LABEL[c.kind]}
            </option>
          ))}
        </select>
        {spec.hint && <p className="hint">{spec.hint}</p>}
      </div>
    );
  }

  const max = spec.max ?? Infinity;
  const ordered = spec.key === "path";
  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((v) => v !== name));
    else if (value.length < max) onChange([...value, name]);
  };
  return (
    <div className="cb-field">
      {label}
      <div className="chip-picker cb-chips" role="group" aria-label={spec.label}>
        {eligible.map((c) => {
          const pos = value.indexOf(c.name);
          const active = pos !== -1;
          return (
            <button
              key={c.name}
              type="button"
              className={"chip" + (active ? " active" : "")}
              aria-pressed={active}
              disabled={!active && value.length >= max}
              onClick={() => toggle(c.name)}
              title={`${c.name} (${KIND_LABEL[c.kind]})`}
            >
              {ordered && active && <span className="cb-order">{pos + 1}</span>}
              {c.name}
            </button>
          );
        })}
      </div>
      {(spec.hint || ordered) && (
        <p className="hint">{ordered ? "L'ordre de sélection définit les niveaux. " : ""}{spec.hint ?? ""}</p>
      )}
      {value.length > 0 && eligible.length > 3 && (
        <div className="cb-chip-actions">
          <button type="button" className="link-btn" onClick={() => onChange([])}>
            Tout désélectionner
          </button>
          {max === Infinity && value.length < eligible.length && (
            <button type="button" className="link-btn" onClick={() => onChange(eligible.map((c) => c.name))}>
              Tout sélectionner
            </button>
          )}
        </div>
      )}
    </div>
  );
}
