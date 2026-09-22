"use client";

import type { Dataset } from "@/lib/types";

interface Props {
  dataset: Dataset;
  maxRows?: number;
}

export default function DataTable({ dataset, maxRows = 50 }: Props) {
  const rows = dataset.rows.slice(0, maxRows);
  return (
    <div>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              {dataset.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="num" style={{ color: "var(--muted)" }}>
                  {i + 1}
                </td>
                {dataset.columns.map((c) => {
                  const v = r[c];
                  const isNum = typeof v === "number";
                  return (
                    <td key={c} className={isNum ? "num" : undefined}>
                      {v === null || v === "" ? (
                        <span className="cell-empty">vide</span>
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Aperçu de {rows.length} ligne(s) sur {dataset.rows.length.toLocaleString("fr-FR")}.
      </p>
    </div>
  );
}
