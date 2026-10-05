// Correspondance entre les valeurs d'une colonne (noms de régions, de
// préfectures, de pays, codes ISO) et les zones des fonds de carte.

import {
  AFRICA_ISO3,
  COUNTRY_CENTROIDS,
  GEO_SOURCE_GN,
  GN_PREFECTURES,
  GN_REGIONS,
  type GeoZone,
} from "./geo-data";

export type MapLevel = "gn-regions" | "gn-prefectures" | "africa" | "world";

export const MAP_LEVELS: { id: MapLevel; label: string }[] = [
  { id: "gn-regions", label: "Guinée — 8 régions" },
  { id: "gn-prefectures", label: "Guinée — 34 préfectures" },
  { id: "africa", label: "Afrique — pays" },
  { id: "world", label: "Monde — pays" },
];

export const GEOJSON_URL: Partial<Record<MapLevel, string>> = {
  "gn-regions": "/geo/guinee-regions.json",
  "gn-prefectures": "/geo/guinee-prefectures.json",
};

export const GEO_SOURCES: Record<MapLevel, string> = {
  "gn-regions": GEO_SOURCE_GN,
  "gn-prefectures": GEO_SOURCE_GN,
  africa: "Fond de carte : Nations Unies (Plotly)",
  world: "Fond de carte : Nations Unies (Plotly)",
};

// ISO3 | ISO2 | nom français | nom anglais | autres graphies (séparées par ;)
const COUNTRY_TABLE = `
AFG|AF|Afghanistan|Afghanistan|
AGO|AO|Angola|Angola|
ALA|AX|Îles Åland|Åland Islands|
ALB|AL|Albanie|Albania|
ARE|AE|Émirats arabes unis|United Arab Emirates|EAU;UAE;Emirats
ARG|AR|Argentine|Argentina|
ARM|AM|Arménie|Armenia|
ATA|AQ|Antarctique|Antarctica|
ATF|TF|Terres australes et antarctiques françaises|French Southern Territories|TAAF
AUS|AU|Australie|Australia|
AUT|AT|Autriche|Austria|
AZE|AZ|Azerbaïdjan|Azerbaijan|
BDI|BI|Burundi|Burundi|
BEL|BE|Belgique|Belgium|
BEN|BJ|Bénin|Benin|
BFA|BF|Burkina Faso|Burkina Faso|Burkina
BGD|BD|Bangladesh|Bangladesh|
BGR|BG|Bulgarie|Bulgaria|
BHS|BS|Bahamas|Bahamas|
BIH|BA|Bosnie-Herzégovine|Bosnia and Herzegovina|Bosnie
BLR|BY|Biélorussie|Belarus|Bélarus
BLZ|BZ|Belize|Belize|
BOL|BO|Bolivie|Bolivia|
BRA|BR|Brésil|Brazil|
BRN|BN|Brunei|Brunei|Brunéi Darussalam
BTN|BT|Bhoutan|Bhutan|
BWA|BW|Botswana|Botswana|
CAF|CF|République centrafricaine|Central African Republic|Centrafrique;RCA
CAN|CA|Canada|Canada|
CHE|CH|Suisse|Switzerland|
CHL|CL|Chili|Chile|
CHN|CN|Chine|China|République populaire de Chine
CIV|CI|Côte d'Ivoire|Ivory Coast|Cote d'Ivoire;RCI
CMR|CM|Cameroun|Cameroon|
COD|CD|République démocratique du Congo|Democratic Republic of the Congo|RDC;RD Congo;Congo-Kinshasa;DR Congo;DRC
COG|CG|Congo|Republic of the Congo|Congo-Brazzaville;République du Congo
COL|CO|Colombie|Colombia|
COM|KM|Comores|Comoros|
CPV|CV|Cap-Vert|Cape Verde|Cabo Verde
CRI|CR|Costa Rica|Costa Rica|
CUB|CU|Cuba|Cuba|
CYP|CY|Chypre|Cyprus|
CZE|CZ|Tchéquie|Czechia|République tchèque;Czech Republic
DEU|DE|Allemagne|Germany|
DJI|DJ|Djibouti|Djibouti|
DMA|DM|Dominique|Dominica|
DNK|DK|Danemark|Denmark|
DOM|DO|République dominicaine|Dominican Republic|
DZA|DZ|Algérie|Algeria|
ECU|EC|Équateur|Ecuador|
EGY|EG|Égypte|Egypt|
ERI|ER|Érythrée|Eritrea|
ESH|EH|Sahara occidental|Western Sahara|
ESP|ES|Espagne|Spain|
EST|EE|Estonie|Estonia|
ETH|ET|Éthiopie|Ethiopia|
FIN|FI|Finlande|Finland|
FJI|FJ|Fidji|Fiji|
FLK|FK|Îles Malouines|Falkland Islands|Malouines
FRA|FR|France|France|
GAB|GA|Gabon|Gabon|
GBR|GB|Royaume-Uni|United Kingdom|UK;Grande-Bretagne;Angleterre;Great Britain
GEO|GE|Géorgie|Georgia|
GHA|GH|Ghana|Ghana|
GIN|GN|Guinée|Guinea|Guinée Conakry;République de Guinée
GLP|GP|Guadeloupe|Guadeloupe|
GMB|GM|Gambie|Gambia|The Gambia
GNB|GW|Guinée-Bissau|Guinea-Bissau|Guinée Bissau
GNQ|GQ|Guinée équatoriale|Equatorial Guinea|
GRC|GR|Grèce|Greece|
GRL|GL|Groenland|Greenland|
GTM|GT|Guatemala|Guatemala|
GUF|GF|Guyane|French Guiana|Guyane française
GUM|GU|Guam|Guam|
GUY|GY|Guyana|Guyana|
HND|HN|Honduras|Honduras|
HRV|HR|Croatie|Croatia|
HTI|HT|Haïti|Haiti|
HUN|HU|Hongrie|Hungary|
IDN|ID|Indonésie|Indonesia|
IND|IN|Inde|India|
IRL|IE|Irlande|Ireland|
IRN|IR|Iran|Iran|
IRQ|IQ|Irak|Iraq|
ISL|IS|Islande|Iceland|
ISR|IL|Israël|Israel|
ITA|IT|Italie|Italy|
JAM|JM|Jamaïque|Jamaica|
JOR|JO|Jordanie|Jordan|
JPN|JP|Japon|Japan|
KAZ|KZ|Kazakhstan|Kazakhstan|
KEN|KE|Kenya|Kenya|
KGZ|KG|Kirghizistan|Kyrgyzstan|
KHM|KH|Cambodge|Cambodia|
KOR|KR|Corée du Sud|South Korea|République de Corée;Corée
KWT|KW|Koweït|Kuwait|
LAO|LA|Laos|Laos|
LBN|LB|Liban|Lebanon|
LBR|LR|Liberia|Liberia|Libéria
LBY|LY|Libye|Libya|
LKA|LK|Sri Lanka|Sri Lanka|
LSO|LS|Lesotho|Lesotho|
LTU|LT|Lituanie|Lithuania|
LUX|LU|Luxembourg|Luxembourg|
LVA|LV|Lettonie|Latvia|
MAR|MA|Maroc|Morocco|
MDA|MD|Moldavie|Moldova|
MDG|MG|Madagascar|Madagascar|
MEX|MX|Mexique|Mexico|
MKD|MK|Macédoine du Nord|North Macedonia|Macédoine
MLI|ML|Mali|Mali|
MMR|MM|Birmanie|Myanmar|Myanmar
MNE|ME|Monténégro|Montenegro|
MNG|MN|Mongolie|Mongolia|
MOZ|MZ|Mozambique|Mozambique|
MRT|MR|Mauritanie|Mauritania|
MTQ|MQ|Martinique|Martinique|
MUS|MU|Maurice|Mauritius|Île Maurice
MWI|MW|Malawi|Malawi|
MYS|MY|Malaisie|Malaysia|
NAM|NA|Namibie|Namibia|
NCL|NC|Nouvelle-Calédonie|New Caledonia|
NER|NE|Niger|Niger|
NGA|NG|Nigeria|Nigeria|Nigéria
NIC|NI|Nicaragua|Nicaragua|
NLD|NL|Pays-Bas|Netherlands|Hollande
NOR|NO|Norvège|Norway|
NPL|NP|Népal|Nepal|
NZL|NZ|Nouvelle-Zélande|New Zealand|
OMN|OM|Oman|Oman|
PAK|PK|Pakistan|Pakistan|
PAN|PA|Panama|Panama|
PER|PE|Pérou|Peru|
PHL|PH|Philippines|Philippines|
PNG|PG|Papouasie-Nouvelle-Guinée|Papua New Guinea|
POL|PL|Pologne|Poland|
PRI|PR|Porto Rico|Puerto Rico|
PRK|KP|Corée du Nord|North Korea|
PRT|PT|Portugal|Portugal|
PRY|PY|Paraguay|Paraguay|
PSE|PS|Palestine|Palestine|
PYF|PF|Polynésie française|French Polynesia|
QAT|QA|Qatar|Qatar|
REU|RE|La Réunion|Réunion|Réunion
ROU|RO|Roumanie|Romania|
RUS|RU|Russie|Russia|Fédération de Russie
RWA|RW|Rwanda|Rwanda|
SAU|SA|Arabie saoudite|Saudi Arabia|
SDN|SD|Soudan|Sudan|
SEN|SN|Sénégal|Senegal|
SGS|GS|Géorgie du Sud-et-les îles Sandwich du Sud|South Georgia and the South Sandwich Islands|
SJM|SJ|Svalbard et Jan Mayen|Svalbard and Jan Mayen|
SLB|SB|Îles Salomon|Solomon Islands|
SLE|SL|Sierra Leone|Sierra Leone|
SLV|SV|Salvador|El Salvador|
SOM|SO|Somalie|Somalia|
SRB|RS|Serbie|Serbia|
SSD|SS|Soudan du Sud|South Sudan|
STP|ST|Sao Tomé-et-Principe|São Tomé and Príncipe|Sao Tome
SUR|SR|Suriname|Suriname|
SVK|SK|Slovaquie|Slovakia|
SVN|SI|Slovénie|Slovenia|
SWE|SE|Suède|Sweden|
SWZ|SZ|Eswatini|Eswatini|Swaziland
SYR|SY|Syrie|Syria|
TCD|TD|Tchad|Chad|
TGO|TG|Togo|Togo|
THA|TH|Thaïlande|Thailand|
TJK|TJ|Tadjikistan|Tajikistan|
TKM|TM|Turkménistan|Turkmenistan|
TLS|TL|Timor oriental|Timor-Leste|
TTO|TT|Trinité-et-Tobago|Trinidad and Tobago|
TUN|TN|Tunisie|Tunisia|
TUR|TR|Turquie|Türkiye|Turkey
TWN|TW|Taïwan|Taiwan|
TZA|TZ|Tanzanie|Tanzania|
UGA|UG|Ouganda|Uganda|
UKR|UA|Ukraine|Ukraine|
URY|UY|Uruguay|Uruguay|
USA|US|États-Unis|United States|Etats-Unis d'Amérique;United States of America
UZB|UZ|Ouzbékistan|Uzbekistan|
VEN|VE|Venezuela|Venezuela|
VNM|VN|Viêt Nam|Vietnam|Vietnam
VUT|VU|Vanuatu|Vanuatu|
WSM|WS|Samoa|Samoa|
YEM|YE|Yémen|Yemen|
ZAF|ZA|Afrique du Sud|South Africa|
ZMB|ZM|Zambie|Zambia|
ZWE|ZW|Zimbabwe|Zimbabwe|
`;

interface CountryRow {
  iso3: string;
  iso2: string;
  fr: string;
  names: string[];
}

const COUNTRIES: CountryRow[] = COUNTRY_TABLE.trim()
  .split("\n")
  .map((line) => {
    const [iso3, iso2, fr, en, aliases = ""] = line.split("|");
    return { iso3, iso2, fr, names: [fr, en, ...aliases.split(";").filter(Boolean)] };
  });

// « Région de Kindia », « N'Zérékoré », « KINDIA » → « kindia ».
export function normalizePlace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/^(la |le |les |l')/, "")
    .replace(/^(region|prefecture|province|pays|republique)\s+(de la |de l'|de |du |des |d')?/, "")
    .replace(/[^a-z0-9]/g, "");
}

export interface MapZone extends GeoZone {
  level: MapLevel;
}

function buildIndex(level: MapLevel): { zones: Map<string, MapZone>; byKey: Map<string, MapZone> } {
  const zones = new Map<string, MapZone>();
  const byKey = new Map<string, MapZone>();
  const add = (k: string, z: MapZone) => {
    const n = normalizePlace(k);
    if (n && !byKey.has(n)) byKey.set(n, z);
  };
  if (level === "gn-regions" || level === "gn-prefectures") {
    const list = level === "gn-regions" ? GN_REGIONS : GN_PREFECTURES;
    for (const z of list) {
      const zone = { ...z, level };
      zones.set(z.code, zone);
      add(z.name, zone);
      add(z.code, zone);
      // Graphies courantes
      if (z.name === "Guéckédou") add("Guékédou", zone);
      if (z.name === "Nzérékoré") add("N'Zérékoré", zone);
      if (z.name === "Forécariah") add("Forékariah", zone);
      if (z.name === "Conakry") add("Zone spéciale de Conakry", zone);
    }
  } else {
    const allowed = level === "africa" ? new Set(AFRICA_ISO3) : null;
    for (const c of COUNTRIES) {
      if (allowed && !allowed.has(c.iso3)) continue;
      const ct = COUNTRY_CENTROIDS[c.iso3];
      const zone: MapZone = { code: c.iso3, name: c.fr, lon: ct?.[0] ?? NaN, lat: ct?.[1] ?? NaN, level };
      zones.set(c.iso3, zone);
      for (const n of c.names) add(n, zone);
      add(c.iso3, zone);
      add(c.iso2, zone);
    }
  }
  return { zones, byKey };
}

const INDEX = new Map<MapLevel, ReturnType<typeof buildIndex>>();
function index(level: MapLevel) {
  let i = INDEX.get(level);
  if (!i) INDEX.set(level, (i = buildIndex(level)));
  return i;
}

export function matchZone(level: MapLevel, value: unknown): MapZone | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s.trim()) return null;
  return index(level).byKey.get(normalizePlace(s)) ?? null;
}

export function zonesOf(level: MapLevel): MapZone[] {
  return Array.from(index(level).zones.values());
}

// Fond de carte le plus adapté à une liste de valeurs : celui qui en
// reconnaît la plus grande part. À égalité, le plus simple (régions avant
// préfectures). Des pays tous africains donnent la carte de l'Afrique.
export function detectMapLevel(values: unknown[]): { level: MapLevel; rate: number } | null {
  const distinct = Array.from(new Set(values.map((v) => (v === null || v === undefined ? "" : String(v).trim())).filter(Boolean)));
  if (distinct.length === 0) return null;
  let best: { level: MapLevel; rate: number } | null = null;
  for (const level of ["gn-regions", "gn-prefectures", "world"] as MapLevel[]) {
    const hits = distinct.filter((v) => matchZone(level, v)).length;
    const rate = hits / distinct.length;
    if (hits > 0 && (!best || rate > best.rate)) best = { level, rate };
  }
  if (best?.level === "world") {
    const african = new Set(AFRICA_ISO3);
    const matched = distinct.map((v) => matchZone("world", v)).filter((z): z is MapZone => z !== null);
    if (matched.length > 0 && matched.every((z) => african.has(z.code))) best = { level: "africa", rate: best.rate };
  }
  return best;
}

// Emprise de la Guinée (pour choisir le fond d'un nuage de coordonnées).
export const GUINEA_BOUNDS = { latMin: 7, latMax: 12.8, lonMin: -15.2, lonMax: -7.5 };
export const AFRICA_BOUNDS = { latMin: -36, latMax: 38, lonMin: -26, lonMax: 53 };
