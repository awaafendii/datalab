"use client";

import type { DatasetProfile } from "@/lib/types";

export default function ProfileView({ profile }: { profile: DatasetProfile }) {
  const cellsTotal = profile.rowCount * profile.columnCount;
  const missingPct = cellsTotal
    ? Math.round((profile.totalMissing / cellsTotal) * 1000) / 10
    : 0;

  return (
    <div>
      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="value">{profile.rowCount.toLocaleString("fr-FR")}</div>
          <div className="label">Lignes</div>
        </div>
        <div className="tile">
          <div className="value">{profile.columnCount}</div>
          <div className="label">Colonnes</div>
        </div>
        <div className={"tile" + (profile.duplicateRows > 0 ? " warn" : " good")}>
          <div className="value">{profile.duplicateRows}</div>
          <div className="label">Doublons</div>
        </div>
        <div className={"tile" + (missingPct > 0 ? " warn" : " good")}>
          <div className="value">{missingPct}%</div>
          <div className="label">Cellules manquantes</div>
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Colonne</th>
              <th>Type</th>
              <th>Rempli</th>
              <th>Manquantes</th>
              <th>% Manq.</th>
              <th>Uniques</th>
              <th>Moyenne</th>
              <th>Médiane</th>
              <th>Min</th>
              <th>Max</th>
              <th>Outliers</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>
                  <span className={"pill " + c.type}>{c.type}</span>
                </td>
                <td className="num">{c.count}</td>
                <td className="num">{c.missing}</td>
                <td className="num">{c.missingPct}</td>
                <td className="num">{c.unique}</td>
                <td className="num">{c.numeric ? c.numeric.mean : "—"}</td>
                <td className="num">{c.numeric ? c.numeric.median : "—"}</td>
                <td className="num">{c.numeric ? c.numeric.min : "—"}</td>
                <td className="num">{c.numeric ? c.numeric.max : "—"}</td>
                <td className="num">
                  {c.outliers != null ? c.outliers : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
