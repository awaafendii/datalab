"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import type { Dataset, DatasetProfile } from "@/lib/types";
import {
  KPI_AGG_LABEL,
  KPI_NON_NUMERIC_AGGS,
  KPI_NUMERIC_AGGS,
  autoKpis,
  computeKpis,
  newKpiId,
  type KpiAgg,
  type KpiDef,
} from "@/lib/kpi/kpi";

export default function KpiPanel({
  dataset,
  profile,
  defs,
  onChange,
}: {
  dataset: Dataset;
  profile: DatasetProfile;
  defs: KpiDef[];
  onChange: (defs: KpiDef[]) => void;
}) {
  const numericCols = useMemo(
    () => new Set(profile.columns.filter((c) => c.type === "number").map((c) => c.name)),
    [profile],
  );
  const kpis = useMemo(() => computeKpis(dataset, defs), [dataset, defs]);

  // Formulaire d'ajout manuel.
  const [mCol, setMCol] = useState<string>("");
  const [mAgg, setMAgg] = useState<KpiAgg>("count");
  const [mLabel, setMLabel] = useState<string>("");
  const [mSuffix, setMSuffix] = useState<string>("");

  const aggsFor = (col: string) =>
    col === "" || !numericCols.has(col) ? (col === "" ? (["count"] as KpiAgg[]) : KPI_NON_NUMERIC_AGGS) : KPI_NUMERIC_AGGS;
  const currentAggs = aggsFor(mCol);

  const add = () => {
    const column = mCol || null;
    const agg = currentAggs.includes(mAgg) ? mAgg : currentAggs[0];
    const label =
      mLabel.trim() ||
      (column === null ? "Nombre de lignes" : `${KPI_AGG_LABEL[agg]} · ${column}`);
    onChange([...defs, { id: newKpiId(), label, column, agg, suffix: mSuffix.trim() || undefined }]);
    setMLabel("");
    setMSuffix("");
  };

  const remove = (id: string) => onChange(defs.filter((k) => k.id !== id));

  return (
    <div>
      <p className="subtitle">
        Indicateurs clés calculés sur les données traitées. DataLab en propose
        automatiquement selon le type de chaque colonne ; ajoutez les vôtres,
        retirez ceux qui ne servent pas. Ils sont inclus dans l&apos;export Excel.
      </p>

      <div className="kpi-row">
        {kpis.map((k) => (
          <div key={k.def.id} className="kpi kpi-editable">
            <button
              type="button"
              className="icon-btn kpi-remove"
              onClick={() => remove(k.def.id)}
              aria-label="Retirer ce KPI"
            >
              <X size={13} />
            </button>
            <span className="k-label">{k.def.label}</span>
            <span className="k-value">{k.display}</span>
          </div>
        ))}
        {kpis.length === 0 && <p className="hint">Aucun KPI. Ajoutez-en ci-dessous.</p>}
      </div>

      <div className="kpi-add">
        <select
          value={mCol}
          onChange={(e) => {
            setMCol(e.target.value);
            const aggs = aggsFor(e.target.value);
            if (!aggs.includes(mAgg)) setMAgg(aggs[0]);
          }}
        >
          <option value="">Nombre de lignes</option>
          {profile.columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={currentAggs.includes(mAgg) ? mAgg : currentAggs[0]} onChange={(e) => setMAgg(e.target.value as KpiAgg)}>
          {currentAggs.map((a) => (
            <option key={a} value={a}>
              {KPI_AGG_LABEL[a]}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Libellé (optionnel)"
          value={mLabel}
          onChange={(e) => setMLabel(e.target.value)}
        />
        <input
          type="text"
          placeholder="Suffixe (ex. GNF, %)"
          value={mSuffix}
          onChange={(e) => setMSuffix(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <button type="button" className="btn small" onClick={add}>
          <Plus size={14} /> Ajouter
        </button>
        <button type="button" className="btn small" onClick={() => onChange(autoKpis(profile))}>
          <RefreshCw size={14} /> Régénérer auto
        </button>
      </div>
    </div>
  );
}
