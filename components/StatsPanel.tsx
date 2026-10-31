"use client";

import { useMemo, useState } from "react";
import type { ColumnType, Dataset, DatasetProfile } from "@/lib/types";
import { fmt } from "@/lib/documents/text";
import { runLinearRegression } from "@/lib/ml";
import {
  chiSquareIndependence,
  correlationMatrix,
  describe,
  frequencies,
  groupStats,
  isStatError,
  oneWayAnova,
  welchTTest,
} from "@/lib/statlab/statlab";

type Analysis =
  | "describe"
  | "correlation"
  | "group"
  | "frequency"
  | "ttest"
  | "anova"
  | "chi2"
  | "regression";

const ANALYSIS_LABEL: Record<Analysis, string> = {
  describe: "Statistiques descriptives",
  correlation: "Matrice de corrélation",
  group: "Statistiques par groupe",
  frequency: "Tableau de fréquences",
  ttest: "Test t (comparaison de 2 groupes)",
  anova: "ANOVA à un facteur",
  chi2: "Test du khi² (indépendance)",
  regression: "Régression linéaire (OLS)",
};

const num = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : fmt(x, d);
const pval = (p: number) => (p < 0.001 ? "< 0,001" : fmt(p, 4));
const verdict = (p: number) =>
  p < 0.05 ? "Différence significative (p < 0,05)" : "Pas de différence significative (p ≥ 0,05)";

function isCat(t: ColumnType) {
  return t === "string" || t === "boolean" || t === "date";
}

export default function StatsPanel({
  dataset,
  profile,
}: {
  dataset: Dataset;
  profile: DatasetProfile;
}) {
  const numericCols = useMemo(
    () => profile.columns.filter((c) => c.type === "number").map((c) => c.name),
    [profile],
  );
  const catCols = useMemo(
    () => profile.columns.filter((c) => isCat(c.type)).map((c) => c.name),
    [profile],
  );
  const allCols = profile.columns.map((c) => c.name);

  const [analysis, setAnalysis] = useState<Analysis>("describe");
  const [selectedNum, setSelectedNum] = useState<string[]>(numericCols.slice(0, 6));
  const [corrMethod, setCorrMethod] = useState<"pearson" | "spearman">("pearson");
  const [valueCol, setValueCol] = useState(numericCols[0] ?? "");
  const [groupCol, setGroupCol] = useState(catCols[0] ?? "");
  const [freqCol, setFreqCol] = useState(catCols[0] ?? allCols[0] ?? "");
  const [chiA, setChiA] = useState(catCols[0] ?? "");
  const [chiB, setChiB] = useState(catCols[1] ?? catCols[0] ?? "");
  const [regTarget, setRegTarget] = useState(numericCols[0] ?? "");
  const [regPredictors, setRegPredictors] = useState<string[]>(numericCols.slice(1, 4));

  const toggleNum = (c: string) =>
    setSelectedNum((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const togglePredictor = (c: string) =>
    setRegPredictors((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  return (
    <div>
      <p className="subtitle">
        Choisissez une analyse et ses paramètres. Les tests d&apos;hypothèse
        donnent de vraies p-values (t de Welch, ANOVA, khi²). Tout est calculé
        dans votre navigateur.
      </p>

      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Analyse</label>
          <select value={analysis} onChange={(e) => setAnalysis(e.target.value as Analysis)}>
            {(Object.keys(ANALYSIS_LABEL) as Analysis[]).map((a) => (
              <option key={a} value={a}>
                {ANALYSIS_LABEL[a]}
              </option>
            ))}
          </select>
        </div>

        {(analysis === "group" || analysis === "ttest" || analysis === "anova") && (
          <>
            <div className="field">
              <label>Variable numérique</label>
              <select value={valueCol} onChange={(e) => setValueCol(e.target.value)}>
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Variable de groupe</label>
              <select value={groupCol} onChange={(e) => setGroupCol(e.target.value)}>
                {catCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {analysis === "correlation" && (
          <div className="field">
            <label>Méthode</label>
            <select value={corrMethod} onChange={(e) => setCorrMethod(e.target.value as "pearson" | "spearman")}>
              <option value="pearson">Pearson</option>
              <option value="spearman">Spearman (rangs)</option>
            </select>
          </div>
        )}

        {analysis === "frequency" && (
          <div className="field">
            <label>Colonne</label>
            <select value={freqCol} onChange={(e) => setFreqCol(e.target.value)}>
              {allCols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        {analysis === "chi2" && (
          <>
            <div className="field">
              <label>Variable A</label>
              <select value={chiA} onChange={(e) => setChiA(e.target.value)}>
                {catCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Variable B</label>
              <select value={chiB} onChange={(e) => setChiB(e.target.value)}>
                {catCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {analysis === "regression" && (
          <div className="field">
            <label>Variable à expliquer (Y)</label>
            <select value={regTarget} onChange={(e) => setRegTarget(e.target.value)}>
              {numericCols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {analysis === "regression" && (
        <div className="stat-cols">
          <span className="hint">Variables explicatives (X) :</span>
          {numericCols
            .filter((c) => c !== regTarget)
            .map((c) => (
              <label key={c} className="check inline">
                <input type="checkbox" checked={regPredictors.includes(c)} onChange={() => togglePredictor(c)} />
                {c}
              </label>
            ))}
          {numericCols.length < 2 && <span className="hint">Il faut au moins deux colonnes numériques.</span>}
        </div>
      )}

      {(analysis === "describe" || analysis === "correlation") && (
        <div className="stat-cols">
          <span className="hint">Colonnes numériques :</span>
          {numericCols.map((c) => (
            <label key={c} className="check inline">
              <input type="checkbox" checked={selectedNum.includes(c)} onChange={() => toggleNum(c)} />
              {c}
            </label>
          ))}
          {numericCols.length === 0 && <span className="hint">Aucune colonne numérique.</span>}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {analysis === "describe" && <DescribeView dataset={dataset} columns={selectedNum} />}
        {analysis === "correlation" && (
          <CorrelationView dataset={dataset} columns={selectedNum} method={corrMethod} />
        )}
        {analysis === "group" && <GroupView dataset={dataset} valueCol={valueCol} groupCol={groupCol} />}
        {analysis === "frequency" && <FrequencyView dataset={dataset} column={freqCol} />}
        {analysis === "ttest" && <TTestView dataset={dataset} valueCol={valueCol} groupCol={groupCol} />}
        {analysis === "anova" && <AnovaView dataset={dataset} valueCol={valueCol} groupCol={groupCol} />}
        {analysis === "chi2" && <ChiView dataset={dataset} colA={chiA} colB={chiB} />}
        {analysis === "regression" && (
          <RegressionView dataset={dataset} target={regTarget} predictors={regPredictors} />
        )}
      </div>
    </div>
  );
}

function RegressionView({
  dataset,
  target,
  predictors,
}: {
  dataset: Dataset;
  target: string;
  predictors: string[];
}) {
  const result = useMemo(() => {
    if (!target || predictors.length === 0) return { error: "Choisissez Y et au moins une variable X." };
    try {
      return { ok: runLinearRegression(dataset, target, predictors) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Régression impossible." };
    }
  }, [dataset, target, predictors]);

  if ("error" in result) return <p className="hint">{result.error}</p>;
  const r = result.ok;
  return (
    <div className="stat-result">
      <p>
        <b>{r.equation}</b>
      </p>
      <p>
        R² = {num(r.r2, 4)} · R² ajusté = {num(r.adjustedR2, 4)} · RMSE = {num(r.rmse)} · MAE ={" "}
        {num(r.mae)} · {r.rowsUsed} observation(s){r.rowsSkipped ? `, ${r.rowsSkipped} ignorée(s)` : ""}.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Terme</th>
              <th className="num">Coefficient</th>
              <th className="num">Coef. standardisé</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Constante</td>
              <td className="num">{num(r.intercept)}</td>
              <td className="num">—</td>
            </tr>
            {r.coefficients.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="num">{num(c.coefficient)}</td>
                <td className="num">{c.standardized === undefined ? "—" : num(c.standardized, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DescribeView({ dataset, columns }: { dataset: Dataset; columns: string[] }) {
  const rows = useMemo(() => columns.map((c) => describe(dataset, c)), [dataset, columns]);
  if (columns.length === 0) return <p className="hint">Sélectionnez au moins une colonne numérique.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Variable</th>
            <th className="num">N</th>
            <th className="num">Manq.</th>
            <th className="num">Moyenne</th>
            <th className="num">Écart-type</th>
            <th className="num">Min</th>
            <th className="num">Q1</th>
            <th className="num">Médiane</th>
            <th className="num">Q3</th>
            <th className="num">Max</th>
            <th className="num">CV</th>
            <th className="num">Asymétrie</th>
            <th className="num">Aplat.</th>
            <th className="num">IC 95 % (moy.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.column}>
              <td>{s.column}</td>
              <td className="num">{s.n}</td>
              <td className="num">{s.missing}</td>
              <td className="num">{num(s.mean)}</td>
              <td className="num">{num(s.std)}</td>
              <td className="num">{num(s.min)}</td>
              <td className="num">{num(s.q1)}</td>
              <td className="num">{num(s.median)}</td>
              <td className="num">{num(s.q3)}</td>
              <td className="num">{num(s.max)}</td>
              <td className="num">{s.cv === null ? "—" : num(s.cv * 100, 1) + " %"}</td>
              <td className="num">{num(s.skewness)}</td>
              <td className="num">{num(s.kurtosis)}</td>
              <td className="num">
                {s.ci95Low === null ? "—" : `[${num(s.ci95Low)} ; ${num(s.ci95High)}]`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function corrColor(r: number | null): string | undefined {
  if (r === null) return undefined;
  const a = Math.abs(r);
  const alpha = (0.12 + a * 0.55).toFixed(2);
  return r >= 0 ? `rgba(37,99,235,${alpha})` : `rgba(220,38,38,${alpha})`;
}

function CorrelationView({
  dataset,
  columns,
  method,
}: {
  dataset: Dataset;
  columns: string[];
  method: "pearson" | "spearman";
}) {
  const m = useMemo(() => correlationMatrix(dataset, columns, method), [dataset, columns, method]);
  if (columns.length < 2) return <p className="hint">Sélectionnez au moins deux colonnes numériques.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th></th>
            {m.columns.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.columns.map((c, i) => (
            <tr key={c}>
              <th className="pivot-rowhead">{c}</th>
              {m.columns.map((_, j) => (
                <td key={j} className="num" style={{ background: corrColor(m.matrix[i][j]) }}>
                  {m.matrix[i][j] === null ? "—" : num(m.matrix[i][j], 3)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupView({ dataset, valueCol, groupCol }: { dataset: Dataset; valueCol: string; groupCol: string }) {
  const rows = useMemo(() => groupStats(dataset, groupCol, valueCol), [dataset, groupCol, valueCol]);
  if (!valueCol || !groupCol) return <p className="hint">Choisissez une variable numérique et une variable de groupe.</p>;
  return (
    <div className="table-wrap tall">
      <table className="data">
        <thead>
          <tr>
            <th>{groupCol}</th>
            <th className="num">N</th>
            <th className="num">Moyenne</th>
            <th className="num">Écart-type</th>
            <th className="num">Min</th>
            <th className="num">Max</th>
            <th className="num">Somme</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.group}>
              <td>{g.group}</td>
              <td className="num">{g.n}</td>
              <td className="num">{num(g.mean)}</td>
              <td className="num">{num(g.std)}</td>
              <td className="num">{num(g.min)}</td>
              <td className="num">{num(g.max)}</td>
              <td className="num">{num(g.sum, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FrequencyView({ dataset, column }: { dataset: Dataset; column: string }) {
  const t = useMemo(() => frequencies(dataset, column), [dataset, column]);
  if (!column) return <p className="hint">Choisissez une colonne.</p>;
  return (
    <>
      <p className="hint">
        {t.total} valeur(s) renseignée(s), {t.missing} manquante(s).
      </p>
      <div className="table-wrap tall">
        <table className="data">
          <thead>
            <tr>
              <th>{column}</th>
              <th className="num">Effectif</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.value}>
                <td>{r.value}</td>
                <td className="num">{r.count}</td>
                <td className="num">{num(r.pct, 1)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TTestView({ dataset, valueCol, groupCol }: { dataset: Dataset; valueCol: string; groupCol: string }) {
  const r = useMemo(() => welchTTest(dataset, valueCol, groupCol), [dataset, valueCol, groupCol]);
  if (!valueCol || !groupCol) return <p className="hint">Choisissez les variables.</p>;
  if (isStatError(r)) return <p className="hint">{r.error}</p>;
  return (
    <div className="stat-result">
      <p>
        Comparaison de <b>{valueCol}</b> entre <b>{r.group1}</b> (n={r.n1}, moyenne {num(r.mean1)}) et{" "}
        <b>{r.group2}</b> (n={r.n2}, moyenne {num(r.mean2)}).
      </p>
      <p>
        t = {num(r.t, 3)} · ddl = {num(r.df, 1)} · <b>p = {pval(r.p)}</b>
      </p>
      <p className={r.p < 0.05 ? "stat-sig" : "stat-nsig"}>{verdict(r.p)}</p>
    </div>
  );
}

function AnovaView({ dataset, valueCol, groupCol }: { dataset: Dataset; valueCol: string; groupCol: string }) {
  const r = useMemo(() => oneWayAnova(dataset, valueCol, groupCol), [dataset, valueCol, groupCol]);
  if (!valueCol || !groupCol) return <p className="hint">Choisissez les variables.</p>;
  if (isStatError(r)) return <p className="hint">{r.error}</p>;
  return (
    <div className="stat-result">
      <p>
        {r.k} groupes · N = {r.nTotal} · F({r.df1}, {r.df2}) = {num(r.fStat, 3)} ·{" "}
        <b>p = {pval(r.p)}</b>
      </p>
      <p className={r.p < 0.05 ? "stat-sig" : "stat-nsig"}>{verdict(r.p)}</p>
      <div className="table-wrap tall">
        <table className="data">
          <thead>
            <tr>
              <th>{groupCol}</th>
              <th className="num">N</th>
              <th className="num">Moyenne</th>
            </tr>
          </thead>
          <tbody>
            {r.groups.map((g) => (
              <tr key={g.group}>
                <td>{g.group}</td>
                <td className="num">{g.n}</td>
                <td className="num">{num(g.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChiView({ dataset, colA, colB }: { dataset: Dataset; colA: string; colB: string }) {
  const r = useMemo(() => chiSquareIndependence(dataset, colA, colB), [dataset, colA, colB]);
  if (!colA || !colB) return <p className="hint">Choisissez deux variables.</p>;
  if (colA === colB) return <p className="hint">Choisissez deux variables différentes.</p>;
  if (isStatError(r)) return <p className="hint">{r.error}</p>;
  return (
    <div className="stat-result">
      <p>
        χ² = {num(r.chi2, 3)} · ddl = {r.df} · <b>p = {pval(r.p)}</b>
      </p>
      <p className={r.p < 0.05 ? "stat-sig" : "stat-nsig"}>
        {r.p < 0.05 ? "Variables liées (p < 0,05)" : "Indépendance non rejetée (p ≥ 0,05)"}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>
                {colA} \ {colB}
              </th>
              {r.colLabels.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rowLabels.map((rl, i) => (
              <tr key={rl}>
                <th className="pivot-rowhead">{rl}</th>
                {r.colLabels.map((_, j) => (
                  <td key={j} className="num">
                    {r.observed[i][j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
