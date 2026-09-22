"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Analysis, Correlation } from "@/lib/types";

const PRIMARY = "#2563eb";

function corrColor(r: number): string {
  // Bleu (négatif) → gris (0) → rouge (positif), échelle divergente accessible.
  if (r >= 0) {
    const t = Math.min(Math.abs(r), 1);
    return `rgba(220, 38, 38, ${0.25 + t * 0.75})`;
  }
  const t = Math.min(Math.abs(r), 1);
  return `rgba(37, 99, 235, ${0.25 + t * 0.75})`;
}

export default function Charts({ analysis }: { analysis: Analysis }) {
  const charts = analysis.columnAnalyses.filter(
    (c) =>
      (c.histogram && c.histogram.length > 0) ||
      (c.categories && c.categories.length > 0),
  );

  return (
    <div>
      <div className="charts">
        {charts.map((c) => {
          const data =
            c.type === "number"
              ? (c.histogram ?? []).map((b) => ({ name: b.label, count: b.count }))
              : (c.categories ?? []).map((b) => ({
                  name: b.label,
                  count: b.count,
                }));
          if (data.length === 0) return null;
          return (
            <div className="chart-card" key={c.name}>
              <h4>
                {c.name}{" "}
                <span className="type">
                  {c.type === "number" ? "distribution" : "fréquences"}
                </span>
              </h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data}
                  margin={{ top: 4, right: 8, left: -18, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    cursor={{ fill: "var(--surface-2)" }}
                  />
                  <Bar dataKey="count" fill={PRIMARY} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>

      {analysis.correlations.length > 0 && (
        <>
          <div className="section-title">Corrélations (Pearson)</div>
          <CorrelationBars correlations={analysis.correlations.slice(0, 12)} />
        </>
      )}
    </div>
  );
}

function CorrelationBars({ correlations }: { correlations: Correlation[] }) {
  const data = correlations.map((c) => ({
    name: `${c.a} × ${c.b}`,
    r: c.r,
  }));
  return (
    <div className="chart-card">
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            domain={[-1, 1]}
            tick={{ fontSize: 10, fill: "var(--muted)" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={180}
            tick={{ fontSize: 10, fill: "var(--muted)" }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            cursor={{ fill: "var(--surface-2)" }}
          />
          <Bar dataKey="r" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={corrColor(d.r)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="hint">
        Rouge = corrélation positive, bleu = négative. Intensité ∝ force du lien.
      </p>
    </div>
  );
}
