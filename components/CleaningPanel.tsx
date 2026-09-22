"use client";

import type { CleaningOptions, MissingStrategy, OutlierStrategy } from "@/lib/types";

interface Props {
  options: CleaningOptions;
  onChange: (opts: CleaningOptions) => void;
}

export default function CleaningPanel({ options, onChange }: Props) {
  const set = <K extends keyof CleaningOptions>(
    key: K,
    value: CleaningOptions[K],
  ) => onChange({ ...options, [key]: value });

  const toggle = (
    key: keyof Pick<
      CleaningOptions,
      "trimStrings" | "removeDuplicates" | "standardizeEmpty" | "coerceNumbers"
    >,
    title: string,
    desc: string,
  ) => (
    <label className="check">
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
      <span>
        <span className="t">{title}</span>
        <br />
        <span className="d">{desc}</span>
      </span>
    </label>
  );

  return (
    <div>
      <div className="checks">
        {toggle(
          "trimStrings",
          "Supprimer les espaces superflus",
          "Nettoie le début et la fin de chaque valeur texte.",
        )}
        {toggle(
          "standardizeEmpty",
          "Harmoniser les valeurs vides",
          "NA, N/A, null, «-», ? … deviennent des vides standard.",
        )}
        {toggle(
          "coerceNumbers",
          "Typer les colonnes numériques",
          "Convertit «1 234,56», «45%», «12€» en nombres.",
        )}
        {toggle(
          "removeDuplicates",
          "Supprimer les doublons",
          "Retire les lignes strictement identiques.",
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Valeurs manquantes</label>
          <select
            value={options.missingStrategy}
            onChange={(e) =>
              set("missingStrategy", e.target.value as MissingStrategy)
            }
          >
            <option value="none">Ne rien faire</option>
            <option value="drop-rows">Supprimer les lignes incomplètes</option>
            <option value="mean">Imputer par la moyenne</option>
            <option value="median">Imputer par la médiane</option>
            <option value="mode">Imputer par la valeur la plus fréquente</option>
            <option value="zero">Remplacer par 0 / vide</option>
            <option value="constant">Remplacer par une constante…</option>
          </select>
          {options.missingStrategy === "constant" && (
            <input
              type="text"
              placeholder="Valeur de remplacement"
              value={options.missingConstant}
              onChange={(e) => set("missingConstant", e.target.value)}
              style={{ marginTop: 8 }}
            />
          )}
          <p className="hint" style={{ marginTop: 6 }}>
            Pour le texte, moyenne/médiane retombent sur le mode.
          </p>
        </div>

        <div className="field">
          <label>Valeurs atypiques (outliers)</label>
          <select
            value={options.outlierStrategy}
            onChange={(e) =>
              set("outlierStrategy", e.target.value as OutlierStrategy)
            }
          >
            <option value="none">Ne rien faire</option>
            <option value="cap">Plafonner aux bornes (winsorisation)</option>
            <option value="remove">Supprimer les lignes atypiques</option>
          </select>
          <p className="hint" style={{ marginTop: 6 }}>
            Détection par écart interquartile (IQR).
          </p>
        </div>

        <div className="field">
          <label>Seuil IQR (× écart interquartile)</label>
          <input
            type="number"
            step="0.1"
            min="1"
            max="5"
            value={options.outlierThreshold}
            onChange={(e) =>
              set("outlierThreshold", Number(e.target.value) || 1.5)
            }
            disabled={options.outlierStrategy === "none"}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            1.5 = standard, 3 = seulement les valeurs extrêmes.
          </p>
        </div>
      </div>
    </div>
  );
}
