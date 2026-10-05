#!/usr/bin/env node
// Génère les fonds de carte du créateur de graphiques, servis par
// l'application elle-même (aucun appel à un service externe à l'affichage) :
//   - public/topojson/world_110m.json, africa_50m.json : fonds Plotly
//     (frontières des Nations Unies), téléchargés depuis cdn.plot.ly/un/ ;
//   - public/geo/guinee-regions.json, guinee-prefectures.json : contours des
//     8 régions et 34 préfectures de Guinée (geoBoundaries, d'après OCHA ROWCA
//     et le PAM, licence CC BY 3.0 IGO), simplifiés et allégés ;
//   - lib/charts/geo-data.ts : codes, noms, centroïdes et rattachements.
//
// Usage : node scripts/geo-referentiel.mjs
// À relancer seulement pour mettre à jour les contours (nouveau découpage).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLOTLY_CDN = "https://cdn.plot.ly/un/";
const GEOBOUNDARIES = "https://www.geoboundaries.org/api/current/gbOpen/GIN/";

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 4) throw new Error(`${url} : ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`${rel} : ${(Buffer.byteLength(content) / 1024).toFixed(0)} Ko`);
}

// --- Référentiel administratif (codes ISO 3166-2:GN) ---

const REGIONS = [
  ["GN-B", "Boké", "boke"],
  ["GN-C", "Conakry", "conakry"],
  ["GN-F", "Faranah", "faranah"],
  ["GN-K", "Kankan", "kankan"],
  ["GN-D", "Kindia", "kindia"],
  ["GN-L", "Labé", "labe"],
  ["GN-M", "Mamou", "mamou"],
  ["GN-N", "Nzérékoré", "nzerekore"],
];

// [code, nom, clé geoBoundaries, région]
const PREFECTURES = [
  ["GN-BE", "Beyla", "beyla", "GN-N"],
  ["GN-BF", "Boffa", "boffa", "GN-B"],
  ["GN-BK", "Boké", "boke", "GN-B"],
  ["GN-C", "Conakry", "conakry", "GN-C"],
  ["GN-CO", "Coyah", "coyah", "GN-D"],
  ["GN-DB", "Dabola", "dabola", "GN-F"],
  ["GN-DL", "Dalaba", "dalaba", "GN-M"],
  ["GN-DI", "Dinguiraye", "dinguiraye", "GN-F"],
  ["GN-DU", "Dubréka", "dubreka", "GN-D"],
  ["GN-FA", "Faranah", "faranah", "GN-F"],
  ["GN-FO", "Forécariah", "forecariah", "GN-D"],
  ["GN-FR", "Fria", "fria", "GN-B"],
  ["GN-GA", "Gaoual", "gaoual", "GN-B"],
  ["GN-GU", "Guéckédou", "gueckedou", "GN-N"],
  ["GN-KA", "Kankan", "kankan", "GN-K"],
  ["GN-KE", "Kérouané", "kerouane", "GN-K"],
  ["GN-KD", "Kindia", "kindia", "GN-D"],
  ["GN-KS", "Kissidougou", "kissidougou", "GN-F"],
  ["GN-KB", "Koubia", "koubia", "GN-L"],
  ["GN-KN", "Koundara", "koundara", "GN-B"],
  ["GN-KO", "Kouroussa", "kouroussa", "GN-K"],
  ["GN-LA", "Labé", "labe", "GN-L"],
  ["GN-LE", "Lélouma", "lelouma", "GN-L"],
  ["GN-LO", "Lola", "lola", "GN-N"],
  ["GN-MC", "Macenta", "macenta", "GN-N"],
  ["GN-ML", "Mali", "mali", "GN-L"],
  ["GN-MM", "Mamou", "mamou", "GN-M"],
  ["GN-MD", "Mandiana", "mandiana", "GN-K"],
  ["GN-NZ", "Nzérékoré", "nzerekore", "GN-N"],
  ["GN-PI", "Pita", "pita", "GN-M"],
  ["GN-SI", "Siguiri", "siguiri", "GN-K"],
  ["GN-TE", "Télimélé", "telimele", "GN-D"],
  ["GN-TO", "Tougué", "tougue", "GN-L"],
  ["GN-YO", "Yomou", "yomou", "GN-N"],
];

const key = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// --- Géométrie ---

const round = (n) => Math.round(n * 1000) / 1000; // ~110 m

// Douglas-Peucker (degrés) : enlève les points superflus des contours.
function simplify(ring, tol) {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // Anneau fermé : premier et dernier points confondus, le segment de
  // référence serait nul. On coupe d'abord au point le plus éloigné.
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  }
  keep[far] = 1;
  const stack = [
    [0, far],
    [far, ring.length - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

// Aire signée (formule du lacet, plan lon/lat) : > 0 = sens trigonométrique.
function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return s / 2;
}

// d3-geo (moteur des cartes Plotly) attend l'anneau extérieur dans le sens
// horaire et les trous dans le sens trigonométrique : sinon il colorie tout
// le globe sauf la zone.
function cleanPolygon(rings, tol) {
  return rings
    .map((ring, i) => {
      let r = simplify(ring, tol).map(([x, y]) => [round(x), round(y)]);
      r = r.filter((p, k) => k === 0 || p[0] !== r[k - 1][0] || p[1] !== r[k - 1][1]);
      if (r.length < 4) return null;
      const ccw = signedArea(r) > 0;
      if ((i === 0 && ccw) || (i > 0 && !ccw)) r.reverse();
      return r;
    })
    .filter(Boolean);
}

function polygons(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

// Centroïde du plus grand polygone (étiquettes, bulles).
function centroid(geometry) {
  let best = null;
  let bestArea = 0;
  for (const poly of polygons(geometry)) {
    const a = Math.abs(signedArea(poly[0]));
    if (a > bestArea) {
      bestArea = a;
      best = poly[0];
    }
  }
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    cx += (best[j][0] + best[i][0]) * f;
    cy += (best[j][1] + best[i][1]) * f;
    area += f;
  }
  area /= 2;
  return [round(cx / (6 * area)), round(cy / (6 * area))];
}

async function boundaries(level) {
  const meta = await getJson(`${GEOBOUNDARIES}${level}/`);
  const gj = await getJson(meta.simplifiedGeometryGeoJSON);
  return { meta, features: gj.features };
}

function buildLevel(features, table, tol, extraProps) {
  const byKey = new Map(features.map((f) => [key(f.properties.shapeName), f]));
  const out = [];
  const zones = [];
  for (const row of table) {
    const [code, name, srcKey] = row;
    const f = byKey.get(srcKey);
    if (!f) throw new Error(`Zone introuvable dans la source : ${name} (${srcKey})`);
    const polys = polygons(f.geometry)
      .map((p) => cleanPolygon(p, tol))
      .filter((p) => p.length > 0);
    const geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
    out.push({ type: "Feature", properties: { id: code, name, ...extraProps(row) }, geometry });
    const [lon, lat] = centroid(f.geometry);
    zones.push({ code, name, lat, lon, ...(row[3] ? { parent: row[3] } : {}) });
  }
  if (features.length !== table.length) {
    console.warn(`Attention : ${features.length} zones dans la source, ${table.length} dans le référentiel.`);
  }
  return { geojson: { type: "FeatureCollection", features: out }, zones };
}

// --- Exécution ---

console.log("Fonds Plotly (Nations Unies)…");
const topo = {};
for (const name of ["world_110m", "africa_50m"]) {
  topo[name] = await getJson(`${PLOTLY_CDN}${name}.json`);
  write(`public/topojson/${name}.json`, JSON.stringify(topo[name]));
}

console.log("Contours de la Guinée (geoBoundaries)…");
const adm1 = await boundaries("ADM1");
const adm2 = await boundaries("ADM2");
const regions = buildLevel(adm1.features, REGIONS, 0.008, () => ({}));
const prefectures = buildLevel(adm2.features, PREFECTURES, 0.006, (row) => ({ region: row[3] }));
write("public/geo/guinee-regions.json", JSON.stringify(regions.geojson));
write("public/geo/guinee-prefectures.json", JSON.stringify(prefectures.geojson));

const countries = topo.world_110m.objects.countries.geometries.filter((g) => g.id && !g.id.startsWith("X"));
const centroids = {};
for (const g of countries) if (g.properties?.ct) centroids[g.id] = g.properties.ct;
const africa = Array.from(new Set(topo.africa_50m.objects.countries.geometries.map((g) => g.id).filter((id) => id && !id.startsWith("X")))).sort();

const ts = `// Généré par scripts/geo-referentiel.mjs — ne pas modifier à la main.
//
// Sources : geoBoundaries ${adm1.meta.boundaryYearRepresented} (${adm1.meta.boundarySource},
// ${adm1.meta.boundaryLicense}) pour la Guinée ; fonds Plotly (Nations Unies)
// pour les pays.

export interface GeoZone {
  code: string;
  name: string;
  lat: number;
  lon: number;
  parent?: string;
}

export const GN_REGIONS: GeoZone[] = ${JSON.stringify(regions.zones, null, 2)};

export const GN_PREFECTURES: GeoZone[] = ${JSON.stringify(prefectures.zones, null, 2)};

// Centroïde [longitude, latitude] de chaque pays du fond de carte (ISO 3166-1 alpha-3).
export const COUNTRY_CENTROIDS: Record<string, [number, number]> = ${JSON.stringify(centroids)};

// Pays du fond « Afrique ».
export const AFRICA_ISO3: string[] = ${JSON.stringify(africa)};

// Mention courte affichée sous les cartes (attribution exigée par la licence).
export const GEO_SOURCE_GN = "Limites : OCHA ROWCA / PAM — geoBoundaries (CC BY 3.0 IGO)";
`;
write("lib/charts/geo-data.ts", ts);
console.log("Terminé.");
