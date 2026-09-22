"use client";

import { useMemo, useState } from "react";
import { Layers, Play, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dataset, DatasetProfile, KMeansResult, RegressionResult } from "@/lib/types";
import { runKMeans, runLinearRegression } from "@/lib/ml";

const CLUSTER_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
}

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

interface Props {
  dataset: Dataset;
  profile: DatasetProfile;
  // Colonnes jugées clés par la détection de contexte (heuristique ou IA) :
  // placées en tête de liste pour que les sélections par défaut du
  // clustering et de la régression les privilégient.
  suggestedColumns?: string[];
}

export default function MLPanel({ dataset, profile, suggestedColumns }: Props) {
  const numericColumns = useMemo(() => {
    const all = profile.columns.filter((c) => c.type === "number").map((c) => c.name);
    if (!suggestedColumns || suggestedColumns.length === 0) return all;
    const suggested = new Set(suggestedColumns);
    return [...all.filter((c) => suggested.has(c)), ...all.filter((c) => !suggested.has(c))];
  }, [profile, suggestedColumns]);

  if (numericColumns.length < 2) {
    return (
      <p className="hint">
        Le clustering et la régression nécessitent au moins deux colonnes
        numériques après nettoyage. Ce jeu de données n&apos;en compte que{" "}
        {numericColumns.length}.
      </p>
    );
  }

  return (
    <div>
      <div className="ml-block">
        <div className="section-title" style={{ marginTop: 0 }}>
          <Layers size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Clustering (k-means)
        </div>
        <ClusteringSection dataset={dataset} numericColumns={numericColumns} />
      </div>

      <div className="ml-block">
        <div className="section-title">
          <TrendingUp size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Régression linéaire
        </div>
        <RegressionSection dataset={dataset} numericColumns={numericColumns} />
      </div>
    </div>
  );
}

// =====================================================================
// Clustering
// =====================================================================

function ClusteringSection({
  dataset,
  numericColumns,
}: {
  dataset: Dataset;
  numericColumns: string[];
}) {
  const [cols, setCols] = useState<string[]>(numericColumns.slice(0, 2));
  const [k, setK] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KMeansResult | null>(null);

  const toggleCol = (c: string) => {
    setCols((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const run = () => {
    setError(null);
    setBusy(true);
    setTimeout(() => {
      try {
        const r = runKMeans(dataset, cols, k);
        setResult(r);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Erreur lors du clustering.");
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div>
      <p className="subtitle" style={{ margin: "-6px 0 14px" }}>
        Regroupe les lignes en <strong>k</strong> groupes homogènes selon les
        colonnes numériques choisies (variables centrées-réduites, distance
        euclidienne, algorithme k-means avec plusieurs initialisations).
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Colonnes utilisées pour le clustering</label>
        <div className="chip-picker">
          {numericColumns.map((c) => (
            <button
              key={c}
              type="button"
              className={"chip" + (cols.includes(c) ? " active" : "")}
              onClick={() => toggleCol(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Choisissez au moins une colonne (deux ou plus pour visualiser un nuage
          de points).
        </p>
      </div>

      <div className="form-grid" style={{ marginBottom: 4 }}>
        <div className="field">
          <label>Nombre de groupes (k)</label>
          <input
            type="number"
            min={2}
            max={8}
            value={k}
            onChange={(e) =>
              setK(Math.max(2, Math.min(8, Number(e.target.value) || 2)))
            }
          />
          <p className="hint" style={{ marginTop: 6 }}>
            Entre 2 et 8. Utilisez la courbe du coude ci-dessous pour choisir un
            k pertinent.
          </p>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn primary"
          onClick={run}
          disabled={busy || cols.length === 0}
        >
          {busy ? <span className="spinner" /> : <Play size={16} />}
          Lancer le clustering
        </button>
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {result && <ClusteringResultView result={result} />}
    </div>
  );
}

function ClusteringResultView({ result }: { result: KMeansResult }) {
  const scatterCols = result.columns.slice(0, 2);
  const canScatter = scatterCols.length === 2;

  const scatterData = canScatter
    ? result.points.map((p) => ({
        x: p.values[scatterCols[0]],
        y: p.values[scatterCols[1]],
        cluster: p.cluster,
      }))
    : [];

  const byCluster: Record<number, typeof scatterData> = {};
  for (const p of scatterData) {
    (byCluster[p.cluster] ??= []).push(p);
  }

  const sortedClusters = [...result.clusters].sort((a, b) => b.size - a.size);
  const dominant = sortedClusters[0];
  const otherCols = result.columns.filter((c) => !scatterCols.includes(c));

  return (
    <div style={{ marginTop: 18 }}>
      <div className="tiles">
        <div className="tile">
          <div className="value">{result.k}</div>
          <div className="label">Groupes</div>
        </div>
        <div className="tile">
          <div className="value">{result.rowsUsed.toLocaleString("fr-FR")}</div>
          <div className="label">Lignes utilisées</div>
        </div>
        <div className="tile">
          <div className="value">{fmt(result.inertia, 1)}</div>
          <div className="label">Inertie intra-classe</div>
        </div>
        <div className="tile">
          <div className="value">{result.iterations}</div>
          <div className="label">Itérations</div>
        </div>
      </div>
      {(result.rowsSkipped > 0 || result.sampled) && (
        <p className="hint" style={{ marginTop: 10 }}>
          {result.rowsSkipped > 0 &&
            `${result.rowsSkipped.toLocaleString("fr-FR")} ligne(s) ignorée(s) (valeur manquante sur une colonne sélectionnée). `}
          {result.sampled &&
            "Calculé sur un échantillon aléatoire de 20 000 lignes pour rester réactif."}
        </p>
      )}

      {canScatter && (
        <div className="chart-card" style={{ marginTop: 16 }}>
          <h4>
            {scatterCols[0]} <span className="type">×</span> {scatterCols[1]}
          </h4>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                name={scatterCols[0]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={scatterCols[1]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} />
              {Object.entries(byCluster).map(([c, pts]) => (
                <Scatter
                  key={c}
                  name={`Groupe ${Number(c) + 1}`}
                  data={pts}
                  fill={CLUSTER_COLORS[Number(c) % CLUSTER_COLORS.length]}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <div className="legend-row">
            {sortedClusters.map((c) => (
              <span key={c.cluster}>
                <span
                  className="sw"
                  style={{
                    background: CLUSTER_COLORS[c.cluster % CLUSTER_COLORS.length],
                  }}
                />
                Groupe {c.cluster + 1} — {c.size.toLocaleString("fr-FR")} ligne(s) (
                {c.share}%)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 20 }}>
        Profil des groupes
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Groupe</th>
              <th className="num">Taille</th>
              <th className="num">Part</th>
              {result.columns.map((c) => (
                <th key={c} className="num">
                  {c} (moyenne)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedClusters.map((c) => (
              <tr key={c.cluster}>
                <td>
                  <span
                    className="sw"
                    style={{
                      background: CLUSTER_COLORS[c.cluster % CLUSTER_COLORS.length],
                    }}
                  />
                  Groupe {c.cluster + 1}
                </td>
                <td className="num">{c.size.toLocaleString("fr-FR")}</td>
                <td className="num">{c.share}%</td>
                {result.columns.map((col) => (
                  <td key={col} className="num">
                    {fmt(c.means[col], 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dominant && (
        <ul className="obs" style={{ marginTop: 14 }}>
          <li>
            Le groupe {dominant.cluster + 1} est le plus important avec{" "}
            {dominant.size.toLocaleString("fr-FR")} ligne(s) ({dominant.share}%
            du jeu de données utilisé).
          </li>
          {otherCols.length === 0 && scatterCols.length > 0 && (
            <li>
              Le nuage de points ci-dessus montre la séparation des groupes selon{" "}
              « {scatterCols[0]} » et « {scatterCols[1]} ».
            </li>
          )}
        </ul>
      )}

      <div className="section-title">Choisir k — courbe du coude</div>
      <div className="chart-card">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={result.elbow}
            margin={{ top: 8, right: 16, left: -12, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="k"
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              label={{ value: "k", position: "insideBottom", offset: -2, fontSize: 11 }}
            />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="inertia"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <ReferenceLine x={result.k} stroke="var(--muted)" strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
        <p className="hint">
          Le « coude » de la courbe (là où la baisse de l&apos;inertie ralentit
          nettement) indique un nombre de groupes raisonnable. La ligne
          pointillée marque le k actuellement sélectionné.
        </p>
      </div>
    </div>
  );
}

// =====================================================================
// Régression linéaire
// =====================================================================

function RegressionSection({
  dataset,
  numericColumns,
}: {
  dataset: Dataset;
  numericColumns: string[];
}) {
  const [target, setTarget] = useState(numericColumns[0]);
  const [predictors, setPredictors] = useState<string[]>(
    numericColumns.length > 1 ? [numericColumns[1]] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegressionResult | null>(null);

  const availablePredictors = numericColumns.filter((c) => c !== target);

  const setTargetSafe = (t: string) => {
    setTarget(t);
    setPredictors((prev) => prev.filter((p) => p !== t));
  };

  const togglePredictor = (c: string) => {
    setPredictors((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const run = () => {
    setError(null);
    setBusy(true);
    setTimeout(() => {
      try {
        const r = runLinearRegression(dataset, target, predictors);
        setResult(r);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Erreur lors de la régression.");
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div>
      <p className="subtitle" style={{ margin: "-6px 0 14px" }}>
        Modélise une variable numérique à partir d&apos;une ou plusieurs autres
        (régression linéaire simple ou multiple, ajustée par moindres carrés
        ordinaires).
      </p>

      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Variable à expliquer (cible)</label>
          <select value={target} onChange={(e) => setTargetSafe(e.target.value)}>
            {numericColumns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Variables prédictives</label>
        <div className="chip-picker">
          {availablePredictors.map((c) => (
            <button
              key={c}
              type="button"
              className={"chip" + (predictors.includes(c) ? " active" : "")}
              onClick={() => togglePredictor(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Une seule variable = régression simple (avec droite de régression).
          Plusieurs = régression multiple (comparaison observé / prédit).
        </p>
      </div>

      <div className="btn-row">
        <button
          className="btn primary"
          onClick={run}
          disabled={busy || predictors.length === 0}
        >
          {busy ? <span className="spinner" /> : <Play size={16} />}
          Lancer la régression
        </button>
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {result && <RegressionResultView result={result} />}
    </div>
  );
}

function RegressionResultView({ result }: { result: RegressionResult }) {
  const simple = result.predictors.length === 1;

  const lineData = simple
    ? result.points.map((p) => ({ x: p.x, predicted: p.predicted }))
    : [];

  const allVals = result.points.flatMap((p) => [p.actual, p.predicted]);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);

  const strongest = [...result.coefficients].sort(
    (a, b) => Math.abs(b.standardized ?? 0) - Math.abs(a.standardized ?? 0),
  )[0];

  return (
    <div style={{ marginTop: 18 }}>
      <div className="chart-card" style={{ marginBottom: 4 }}>
        <h4>Équation ajustée</h4>
        <p style={{ fontSize: 14, fontFamily: "ui-monospace, monospace" }}>
          {result.equation}
        </p>
      </div>

      <div className="tiles" style={{ marginTop: 16 }}>
        <div className="tile good">
          <div className="value">{fmt(result.r2, 3)}</div>
          <div className="label">R²</div>
        </div>
        <div className="tile">
          <div className="value">{fmt(result.adjustedR2, 3)}</div>
          <div className="label">R² ajusté</div>
        </div>
        <div className="tile">
          <div className="value">{fmt(result.rmse, 2)}</div>
          <div className="label">RMSE</div>
        </div>
        <div className="tile">
          <div className="value">{fmt(result.mae, 2)}</div>
          <div className="label">MAE</div>
        </div>
        <div className="tile">
          <div className="value">{result.rowsUsed.toLocaleString("fr-FR")}</div>
          <div className="label">Lignes utilisées</div>
        </div>
      </div>

      <div className="section-title">Coefficients</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Variable</th>
              <th className="num">Coefficient</th>
              <th className="num">Coefficient standardisé</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ordonnée à l&apos;origine</td>
              <td className="num">{fmt(result.intercept, 4)}</td>
              <td className="num">—</td>
            </tr>
            {result.coefficients.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="num">{fmt(c.coefficient, 4)}</td>
                <td className="num">
                  {c.standardized !== undefined ? fmt(c.standardized, 3) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Le coefficient standardisé permet de comparer l&apos;influence relative
        des variables entre elles (indépendamment de leur unité).
      </p>

      <div className="chart-card" style={{ marginTop: 18 }}>
        <h4>
          {simple
            ? `${result.target} en fonction de ${result.predictors[0]}`
            : `${result.target} observé vs. prédit`}
        </h4>
        <ResponsiveContainer width="100%" height={320}>
          {simple ? (
            <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                name={result.predictors[0]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={result.target}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
              <Scatter
                name="Observé"
                data={result.points.map((p) => ({ x: p.x, y: p.actual }))}
                fill="var(--series-1)"
              />
              <Line
                name="Régression"
                data={lineData}
                type="linear"
                dataKey="predicted"
                stroke="var(--series-2)"
                strokeWidth={2}
                dot={false}
                activeDot={false}
              />
            </ComposedChart>
          ) : (
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="actual"
                name="Observé"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <YAxis
                type="number"
                dataKey="predicted"
                name="Prédit"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} />
              <ReferenceLine
                segment={[
                  { x: lo, y: lo },
                  { x: hi, y: hi },
                ]}
                stroke="var(--muted)"
                strokeDasharray="4 4"
              />
              <Scatter
                name="Lignes"
                data={result.points}
                fill="var(--series-1)"
              />
            </ScatterChart>
          )}
        </ResponsiveContainer>
        <p className="hint">
          {simple
            ? "Points bleus = valeurs observées, ligne orange = droite de régression ajustée."
            : "Chaque point compare la valeur observée et la valeur prédite par le modèle ; la ligne pointillée représente une prédiction parfaite."}
        </p>
      </div>

      <ul className="obs" style={{ marginTop: 14 }}>
        <li>
          Le modèle explique {fmt(result.r2 * 100, 1)}% de la variance de « {result.target}{" "}
          » (R² = {fmt(result.r2, 3)}).
        </li>
        {strongest && strongest.standardized !== undefined && (
          <li>
            La variable la plus influente est « {strongest.name} » (coefficient
            standardisé = {fmt(strongest.standardized, 3)}).
          </li>
        )}
        {result.rowsSkipped > 0 && (
          <li>
            {result.rowsSkipped.toLocaleString("fr-FR")} ligne(s) ignorée(s) pour
            valeur manquante sur la cible ou un prédicteur.
          </li>
        )}
      </ul>
    </div>
  );
}
